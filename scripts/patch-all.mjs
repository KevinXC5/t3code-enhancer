#!/usr/bin/env node
/**
 * t3code-enhancer 主补丁编排器
 * 支持：
 *   --app <path>        指定 T3 Code.app 路径（默认自动探测）
 *   --dry-run           仅执行只读锚点扫描与体检，不修改任何文件
 *   --features <csv>    指定启用的补丁模块（默认启用配置中的全部模块）
 *   --no-sign           跳过 codesign 重签名（调试用）
 *   --strict-updater    若 mac-updater-hook 失配则以非 0 退出码终止（自动升级保护）
 *   --json              以 JSON 格式输出执行报告
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (typeof process !== 'undefined' && process.versions?.electron) {
  process.noAsar = true;
}
import { AsarArchive, updatePlistAsarIntegrity, verifyAsar } from './asar-lib.mjs';
import {
  codesignApp,
  detectSigningIdentity,
  detectT3AppPath,
  loadConfig,
  readAppInfo,
} from './config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_DIR = path.resolve(__dirname, '..');

/**
 * 动态加载已实现的补丁模块（便于按 Phase 渐进接入且保持单一编排入口）
 */
async function loadAvailablePatches() {
  const candidates = [
    { id: 'head-runtime', file: './patches/head-runtime.mjs', featureKey: null, critical: false },
    { id: 'live-expand', file: './patches/live-expand.mjs', featureKey: 'liveExpand', critical: false },
    { id: 'composer-status', file: './patches/composer-status.mjs', featureKey: 'composerStatus', critical: false },
    { id: 'step-usage-bridge', file: './patches/step-usage-bridge.mjs', featureKey: 'composerStatus', critical: false },
    { id: 'mac-updater-hook', file: './patches/mac-updater-hook.mjs', featureKey: 'macUpdaterHook', critical: true },
  ];

  const loaded = [];
  for (const item of candidates) {
    const absPath = path.resolve(__dirname, item.file);
    if (!fs.existsSync(absPath)) continue;
    const mod = await import(absPath);
    loaded.push({
      id: mod.id || item.id,
      description: mod.description || item.id,
      featureKey: mod.featureKey ?? item.featureKey,
      critical: mod.critical ?? item.critical,
      apply: mod.apply,
    });
  }
  return loaded;
}

export function parseArgs(argv) {
  const opts = {
    app: null,
    dryRun: false,
    features: null,
    noSign: false,
    strictUpdater: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--app' && argv[i + 1]) {
      opts.app = argv[++i];
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--features' && argv[i + 1]) {
      opts.features = new Set(
        argv[++i]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      );
    } else if (arg === '--no-sign') {
      opts.noSign = true;
    } else if (arg === '--strict-updater') {
      opts.strictUpdater = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return opts;
}

/**
 * 执行补丁流程（可供 CLI 或测试脚本直接调用）
 */
export async function runPatch(opts = {}) {
  const config = loadConfig();
  const appPath = detectT3AppPath(opts.app || config.appPath || undefined);
  const appInfo = readAppInfo(appPath);
  const patches = await loadAvailablePatches();
  const signingPreview = detectSigningIdentity(config.signingIdentity);

  const report = {
    ok: true,
    dryRun: Boolean(opts.dryRun),
    repoDir: REPO_DIR,
    app: {
      path: appInfo.appPath,
      name: appInfo.name,
      version: appInfo.version,
      bundleId: appInfo.bundleId,
      teamId: appInfo.teamId,
      isOfficialSigned: appInfo.isOfficialSigned,
      plistIntegrityHash: appInfo.asarIntegrityHash,
    },
    asar: {
      originalHeaderHash: null,
      plistHashMatches: null,
      newHeaderHash: null,
      modifiedFiles: [],
    },
    signing: {
      mode: signingPreview.mode,
      identity: signingPreview.identity,
      applied: false,
    },
    modules: [],
    warnings: [],
    errors: [],
  };

  const archive = new AsarArchive(appInfo.asarPath);
  try {
    report.asar.originalHeaderHash = archive.headerHash;
    report.asar.plistHashMatches =
      !appInfo.asarIntegrityHash || appInfo.asarIntegrityHash === archive.headerHash;

    if (!report.asar.plistHashMatches) {
      report.warnings.push(
        `当前 Info.plist 的 ASAR 哈希 (${appInfo.asarIntegrityHash}) 与 app.asar 实际哈希 (${archive.headerHash}) 不一致`
      );
    }

    // 虚拟工作区：允许多个补丁模块链式修改同一个文件（例如多个模块都往 index.html 或同一 JS 注入）
    const stagedFiles = new Map();
    const ctx = {
      archive,
      config,
      appInfo,
      repoDir: REPO_DIR,
      dryRun: Boolean(opts.dryRun),
      readText(relPath) {
        const key = relPath.replace(/^\/+/, '');
        if (stagedFiles.has(key)) {
          const val = stagedFiles.get(key);
          return Buffer.isBuffer(val) ? val.toString('utf8') : String(val);
        }
        return archive.readText(key);
      },
      writeText(relPath, text) {
        const key = relPath.replace(/^\/+/, '');
        stagedFiles.set(key, Buffer.from(String(text), 'utf8'));
      },
      findAssetJs(predicate) {
        return archive.findFiles(
          (f) => f.path.startsWith('apps/server/dist/client/assets/') && f.path.endsWith('.js') && predicate(f)
        );
      },
    };

    for (const mod of patches) {
      const enabledByCli = !opts.features || opts.features.has(mod.id);
      const enabledByConfig =
        !mod.featureKey || config.features?.[mod.featureKey] !== false;

      if (!enabledByCli || !enabledByConfig) {
        report.modules.push({
          id: mod.id,
          description: mod.description,
          status: 'disabled',
        });
        continue;
      }

      // 记录快照以便单模块失败时自动回滚其局部写入，实现分模块独立降级
      const snapshotBefore = new Map(stagedFiles);
      try {
        const result = await mod.apply(ctx);
        report.modules.push({
          id: mod.id,
          description: mod.description,
          status: result?.skipped ? 'skipped' : 'ok',
          details: result ?? {},
        });
      } catch (err) {
        stagedFiles.clear();
        for (const [k, v] of snapshotBefore.entries()) stagedFiles.set(k, v);
        const msg = err instanceof Error ? err.message : String(err);
        report.modules.push({
          id: mod.id,
          description: mod.description,
          status: 'failed',
          critical: mod.critical,
          error: msg,
        });
        if (mod.critical && opts.strictUpdater) {
          report.ok = false;
          report.errors.push(`核心模块 ${mod.id} 锚点失配：${msg}`);
        } else {
          report.warnings.push(`模块 ${mod.id} 已跳过（独立降级）：${msg}`);
        }
      }
    }

    report.asar.modifiedFiles = [...stagedFiles.keys()];

    if (!opts.dryRun && report.ok && stagedFiles.size > 0) {
      const writeRes = archive.writePatched(appInfo.asarPath, stagedFiles);
      report.asar.newHeaderHash = writeRes.headerHash;
      // 关闭旧 fd 后再校验新文件
      archive.close();

      verifyAsar(appInfo.asarPath, {
        expectedHeaderHash: writeRes.headerHash,
        verifyPaths: writeRes.modifiedFiles,
      });

      updatePlistAsarIntegrity(appInfo.infoPlistPath, writeRes.headerHash);

      if (!opts.noSign) {
        const signed = codesignApp(appInfo.appPath, config.signingIdentity);
        report.signing = { ...signed, applied: true };
      }
    }
  } finally {
    archive.close();
  }

  return report;
}

function printHumanReport(report) {
  const modeLabel = report.dryRun ? '只读体检 (--dry-run)' : '补丁写入';
  console.log(`[t3code-enhancer] ${modeLabel}`);
  console.log(`  应用路径: ${report.app.path}`);
  console.log(`  应用版本: ${report.app.version} (TeamID: ${report.app.teamId || 'none'})`);
  console.log(
    `  ASAR 校验: ${report.asar.originalHeaderHash?.slice(0, 16)}... (Info.plist 匹配: ${report.asar.plistHashMatches ? '是' : '否'})`
  );
  console.log(`  签名策略: ${report.signing.mode} (${report.signing.identity})`);

  if (report.modules.length === 0) {
    console.log('  补丁模块: （尚未注册功能模块，当前为 Phase 1 底座模式）');
  } else {
    console.log('  补丁模块:');
    for (const m of report.modules) {
      const extra = m.error ? ` — ${m.error}` : m.details?.summary ? ` — ${m.details.summary}` : '';
      console.log(`    - [${m.status.toUpperCase()}] ${m.id}${extra}`);
    }
  }

  if (report.asar.modifiedFiles.length > 0) {
    console.log(`  涉及文件 (${report.asar.modifiedFiles.length}):`);
    for (const f of report.asar.modifiedFiles) {
      console.log(`    * ${f}`);
    }
  }

  for (const w of report.warnings) console.warn(`  [WARN] ${w}`);
  for (const e of report.errors) console.error(`  [ERROR] ${e}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      console.log(`用法: node scripts/patch-all.mjs [--app <path>] [--dry-run] [--features <csv>] [--no-sign] [--strict-updater] [--json]`);
      process.exit(0);
    }
    const report = await runPatch(opts);
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printHumanReport(report);
    }
    process.exit(report.ok ? 0 : 1);
  } catch (err) {
    console.error(`[t3code-enhancer] 执行失败: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
