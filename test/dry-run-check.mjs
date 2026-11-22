#!/usr/bin/env node
/**
 * 端到端无侵入自测套件（绝不修改 /Applications 下的原厂应用）
 * 覆盖：
 *  1. 零依赖 ASAR 引擎（Chromium Pickle 4 字节对齐、分块 SHA-256、原厂哈希校验）
 *  2. 全部 4 个补丁模块在隔离副本中完整打包 + 语法级 AST 校验（JS / CJS / ESM / 内联脚本）
 *  3. window.__t3Enhancer 运行时单元测试（自动展开、手动覆盖、最新条目联动、缓存命中与速率）
 *  4. 模拟 update.zip 自动升级闭环测试（正常升级重打补丁 + 核心锚点失配安全降级）
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  AsarArchive,
  computeFileIntegrity,
  createAsarHeaderPickle,
  readPlistAsarIntegrity,
  verifyAsar,
} from '../scripts/asar-lib.mjs';
import { detectT3AppPath, readAppInfo } from '../scripts/config.mjs';
import { runPatch } from '../scripts/patch-all.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_DIR = path.resolve(__dirname, '..');

function checkJsSyntax(code, filename, isModule) {
  if (isModule) {
    // 利用 node --check 通过临时 .mjs 文件验证 ESM 语法（兼容 top-level import/export）
    const tmp = path.join(os.tmpdir(), `t3-syntax-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);
    fs.writeFileSync(tmp, code, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    } finally {
      fs.unlinkSync(tmp);
    }
  } else {
    new vm.Script(code, { filename });
  }
}

function testRuntimeLogic(inlineScript) {
  // 构造最小浏览器沙箱测试 window.__t3Enhancer 核心状态机
  const store = new Map();
  const sandbox = {
    window: null,
    document: {
      readyState: 'complete',
      visibilityState: 'visible',
      documentElement: { style: { setProperty() {} } },
      body: null,
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener: () => {},
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    requestAnimationFrame: (fn) => fn(),
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    queueMicrotask: (fn) => fn(),
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    Date,
    Math,
    Number,
    String,
    Array,
    Map,
    WeakMap,
    Set,
    Object,
    JSON,
    Boolean,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(inlineScript, sandbox, { filename: 't3-enhancer-runtime.js' });

  const api = sandbox.window.__t3Enhancer;
  assert.ok(api && api.__version === 1, '运行时应正确挂载 window.__t3Enhancer');
  assert.equal(api.isLiveExpandEnabled(), true);

  // 1) 活跃工作组自动展开 + 用户手动收起优先
  assert.equal(api.resolveLiveExpanded('work-group:1', false), true);
  assert.equal(api.isLiveAnchor('work-group:1:details'), true);
  api.toggleLiveGroup('work-group:1', false);
  assert.equal(api.resolveLiveExpanded('work-group:1', false), false);
  // 再次点开恢复
  api.toggleLiveGroup('work-group:1', false);
  assert.equal(api.resolveLiveExpanded('work-group:1', false), true);

  // 2) 最新条目自动展开，新条目到来时旧条目自动收起，但尊重用户手动展开的旧条目
  const expanded = new Set();
  const states = new Map();
  api.subscribeEntryState('e1', (v) => states.set('e1', v));
  api.subscribeEntryState('e2', (v) => states.set('e2', v));
  api.subscribeEntryState('e3', (v) => states.set('e3', v));

  api.syncLiveEntries('work-group:1:details', [{ id: 'e1' }], expanded);
  assert.equal(expanded.has('e1'), true);
  assert.equal(states.get('e1'), true);

  api.syncLiveEntries('work-group:1:details', [{ id: 'e1' }, { id: 'e2' }], expanded);
  assert.equal(expanded.has('e1'), false, '旧条目 e1 应自动收起');
  assert.equal(expanded.has('e2'), true, '最新条目 e2 应自动展开');

  // 用户手动点开 e1，再追加 e3 时 e1 必须保持展开，e2 自动收起，e3 自动展开
  api.onManualEntryToggle('e1', true);
  expanded.add('e1');
  api.syncLiveEntries('work-group:1:details', [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }], expanded);
  assert.equal(expanded.has('e1'), true, '用户手动展开的 e1 不得被自动收起');
  assert.equal(expanded.has('e2'), false, '自动展开的 e2 应随 e3 到来自动收起');
  assert.equal(expanded.has('e3'), true, '最新条目 e3 应自动展开');

  // 3) 关闭开关后回退原生行为
  let refreshed = 0;
  api.registerTimelineRefresher(() => {
    refreshed += 1;
  });
  assert.equal(api.toggleLiveExpand(), false);
  assert.equal(refreshed, 1, '切换开关应立即触发 Timeline 刷新');
  assert.equal(api.resolveLiveExpanded('work-group:1', false), false);
  assert.equal(api.resolveLiveExpanded('work-group:1', true), true);
  assert.equal(api.toggleLiveExpand(), true);

  // 4) 回归测试：使用真实 Effect DateTime.Utc 结构（epochMilliseconds + toJSON + DateTime.Utc(...) toString）
  //    验证模型用时、工具调用用时（含并行区间合并）、TTFT、步级实时累计/去重/均值与内联 Diff
  const makeEffectUtc = (iso) => {
    const ms = Date.parse(iso);
    return {
      _tag: 'Utc',
      epochMilliseconds: ms,
      toJSON: () => new Date(ms).toISOString(),
      toString: () => `DateTime.Utc(${new Date(ms).toISOString()})`,
    };
  };
  api.reportUsage({
    threadKey: 'thread-step-test',
    model: 'gemini-4-neon',
    contextWindow: { usedTokens: 120000, maxTokens: 1000000 },
  });
  const turn1 = {
    id: 'pt-1',
    startedAt: makeEffectUtc('2026-11-22T14:00:00.000Z'),
    completedAt: makeEffectUtc('2026-11-22T14:00:20.000Z'),
    turnTokenUsage: { inputTokens: 100000, cachedInputTokens: 80000, cacheCreationTokens: 0, outputTokens: 1000, reasoningTokens: 200 },
  };
  const turn2Step1 = {
    id: 'pt-2',
    status: 'running',
    startedAt: makeEffectUtc('2026-11-22T14:01:00.000Z'),
    completedAt: null,
    tokenUsage: { usedTokens: 100500, maxTokens: 1000000, inputTokens: 100000, cachedInputTokens: 0, outputTokens: 500, updatedAt: '2026-11-22T14:01:05.000Z' },
  };
  const turn2Step2 = {
    id: 'pt-2',
    status: 'running',
    startedAt: makeEffectUtc('2026-11-22T14:01:00.000Z'),
    completedAt: null,
    tokenUsage: { usedTokens: 110600, maxTokens: 1000000, inputTokens: 110000, cachedInputTokens: 99000, outputTokens: 600, updatedAt: '2026-11-22T14:01:12.000Z' },
  };
  const commonRuns = [{ id: 'r1', startedAt: makeEffectUtc('2026-11-22T14:00:00.000Z'), completedAt: makeEffectUtc('2026-11-22T14:00:20.000Z') }];
  const commonItems = [
    { item: { type: 'reasoning', runId: 'r1', startedAt: makeEffectUtc('2026-11-22T14:00:02.000Z'), completedAt: makeEffectUtc('2026-11-22T14:00:10.000Z') } },
    // 两个并行重叠的工具调用（10..15 与 11..16），合并后应为 6 秒而非 10 秒
    { item: { type: 'command_execution', runId: 'r1', startedAt: makeEffectUtc('2026-11-22T14:00:10.000Z'), completedAt: makeEffectUtc('2026-11-22T14:00:15.000Z') } },
    { item: { type: 'file_read', runId: 'r1', startedAt: makeEffectUtc('2026-11-22T14:00:11.000Z'), completedAt: makeEffectUtc('2026-11-22T14:00:16.000Z') } },
    { item: { type: 'assistant_message', runId: 'r1', startedAt: makeEffectUtc('2026-11-22T14:00:16.000Z'), completedAt: makeEffectUtc('2026-11-22T14:00:20.000Z') } },
  ];
  api.reportActivity(
    { isWorking: true },
    {
      threadId: 'thread-step-test',
      phase: 'running',
      runs: commonRuns,
      providerTurns: [turn1, turn2Step1],
      nodes: [{ kind: 'tool_call' }, { kind: 'tool_call' }],
      items: commonItems,
    }
  );
  // 重复传同一 step 不得重复计数
  api.reportActivity(
    { isWorking: true },
    {
      threadId: 'thread-step-test',
      phase: 'running',
      runs: commonRuns,
      providerTurns: [turn1, { ...turn2Step1 }],
      nodes: [{ kind: 'tool_call' }, { kind: 'tool_call' }],
      items: commonItems,
    }
  );
  // 第 2 步完成
  api.reportActivity(
    { isWorking: true },
    {
      threadId: 'thread-step-test',
      phase: 'running',
      runs: commonRuns,
      providerTurns: [turn1, turn2Step2],
      nodes: [{ kind: 'tool_call' }, { kind: 'tool_call' }],
      items: commonItems,
    }
  );
  const midDebug = api._debugTelemetry?.('thread-step-test');
  assert.ok(midDebug && midDebug.agg, '应能读取遥测聚合快照');
  assert.equal(midDebug.agg.modelDurationMs, 12000, '模型用时应正确解析 Effect DateTime.Utc（8s + 4s = 12s）');
  assert.equal(midDebug.agg.toolDurationMs, 6000, '并行工具用时应按重叠区间合并（6s 而非 10s）');
  assert.equal(midDebug.agg.avgTtftMs, 2000, '首字平均 TTFT 应为 2000ms');
  assert.equal(midDebug.agg.lastStepCachedPct, 90, '本步命中应为 99000/110000 = 90%');
  assert.equal(midDebug.agg.avgStepCachedPct, 45, '两步均值应为 (0% + 90%) / 2 = 45%');
  assert.equal(midDebug.agg.stepSampleCount, 2, '重复 step 必须被去重，总样本数应为 2');
  assert.equal(midDebug.agg.totalInput, 310000, '运行中累计输入应实时包含已完成回合 + 活跃回合 2 步');
  assert.equal(midDebug.agg.totalCachedRead, 179000, '运行中累计缓存读取应为 80000 + 0 + 99000');

  // 回合 2 最终结算，切回权威 turnTokenUsage
  api.reportActivity(
    { isWorking: false },
    {
      threadId: 'thread-step-test',
      phase: 'idle',
      runs: commonRuns,
      providerTurns: [
        turn1,
        {
          ...turn2Step2,
          status: 'completed',
          completedAt: makeEffectUtc('2026-11-22T14:01:15.000Z'),
          turnTokenUsage: { inputTokens: 210000, cachedInputTokens: 99000, cacheCreationTokens: 0, outputTokens: 1100, reasoningTokens: 100 },
        },
      ],
      nodes: [{ kind: 'tool_call' }, { kind: 'tool_call' }],
      items: commonItems,
    }
  );
  const endDebug = api._debugTelemetry?.('thread-step-test');
  assert.equal(endDebug.agg.totalInput, 310000, '回合结算后不得重复累加活跃步级缓存');
  assert.equal(endDebug.agg.totalCachedRead, 179000, '回合结算后缓存读取应与权威值一致');
  const fakeJsx = { jsx: (type, props, key) => ({ type, props, key }) };
  const diffNode = api.renderInlineDiff(fakeJsx, { diffStr: '@@ -1,2 +1,2 @@\n-old\n+new' });
  assert.ok(diffNode && diffNode.props.children.length === 3, 'renderInlineDiff 应正确解析 hunk / del / add 行');
}

async function main() {
  let appPath = detectT3AppPath(process.argv[2]);
  let info = readAppInfo(appPath);
  // 若本机 /Applications 中的应用已打过补丁，自动读取同版本原厂 APFS 备份作为干净测试基准
  if (!process.argv[2] && !info.isOfficialSigned) {
    const latestMeta = path.join(os.homedir(), '.t3', 'enhancer', 'backups', 'latest-backup.json');
    if (fs.existsSync(latestMeta)) {
      const meta = JSON.parse(fs.readFileSync(latestMeta, 'utf8'));
      if (meta.backupPath && fs.existsSync(meta.backupPath)) {
        appPath = meta.backupPath;
        info = readAppInfo(appPath);
        console.log(`[check] 本机应用已打补丁，自动使用原厂备份作为基准: ${appPath}`);
      }
    }
  }
  console.log(`[check] 目标应用: ${info.name} ${info.version} (${info.appPath})`);

  // 1. Bash 脚本语法检查
  for (const sh of ['install.sh', 'uninstall.sh', 'scripts/apply-update-helper.sh', 'scripts/setup-signing-cert.sh']) {
    execFileSync('bash', ['-n', path.join(REPO_DIR, sh)], { stdio: 'pipe' });
  }
  console.log('[check] ✓ Shell 脚本语法校验通过');

  // 2. Chromium Pickle 4 字节对齐与 SHA-256 分块校验
  for (let pad = 0; pad < 4; pad += 1) {
    const obj = { files: { ['a'.repeat(pad + 1)]: { size: 0, offset: '0' } } };
    const { prefixBuf, headerPickleSize, headerString } = createAsarHeaderPickle(obj);
    assert.equal(prefixBuf.length % 4, 0);
    assert.equal(prefixBuf.length, 8 + headerPickleSize);
    assert.equal(prefixBuf.readUInt32LE(12), Buffer.byteLength(headerString, 'utf8'));
  }
  const emptyIntegrity = computeFileIntegrity(Buffer.alloc(0));
  assert.equal(emptyIntegrity.blocks.length, 1);
  assert.equal(
    emptyIntegrity.hash,
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
  console.log('[check] ✓ ASAR Pickle 对齐与分块 SHA-256 自测通过');

  // 3. 原厂 app.asar 与 Info.plist 一致性核验
  const origVerify = verifyAsar(info.asarPath, {
    expectedHeaderHash: info.asarIntegrityHash || undefined,
    verifyPaths: ['apps/server/dist/client/index.html', 'apps/desktop/dist-electron/main.cjs'],
  });
  assert.equal(origVerify.ok, true);
  console.log(`[check] ✓ 本机原厂 app.asar 核验通过 (files=${origVerify.totalFiles})`);

  // 4. dry-run 全模块体检
  const dryReport = await runPatch({ app: appPath, dryRun: true, strictUpdater: true });
  assert.equal(dryReport.ok, true);
  assert.equal(dryReport.modules.length, 5);
  for (const m of dryReport.modules) {
    assert.equal(m.status, 'ok', `模块 ${m.id} dry-run 必须为 ok`);
  }
  console.log('[check] ✓ 全部 5 个模块 dry-run 锚点体检通过');

  // 5. 在隔离临时目录中用 APFS cp -c -R 克隆完整 .app 执行真实补丁、语法校验与重签名校验
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't3code-enhancer-e2e-'));
  const clonedApp = path.join(tmpRoot, path.basename(appPath));
  try {
    try {
      execFileSync('cp', ['-c', '-R', appPath, clonedApp], { stdio: 'pipe' });
    } catch {
      execFileSync('cp', ['-R', appPath, clonedApp], { stdio: 'pipe' });
    }

    const t0 = Date.now();
    const patchReport = await runPatch({
      app: clonedApp,
      dryRun: false,
      strictUpdater: true,
      noSign: false,
    });
    assert.equal(patchReport.ok, true);
    assert.equal(patchReport.signing.applied, true);
    assert.equal(
      readPlistAsarIntegrity(path.join(clonedApp, 'Contents', 'Info.plist')),
      patchReport.asar.newHeaderHash,
      'Info.plist 中的 ElectronAsarIntegrity 必须与新 ASAR Header 哈希一致'
    );

    // 验证所有被修补的 JS/HTML 均零语法错误，且运行 window.__t3Enhancer 沙箱单元测试
    const patchedArchive = new AsarArchive(path.join(clonedApp, 'Contents', 'Resources', 'app.asar'));
    try {
      for (const relPath of patchReport.asar.modifiedFiles) {
        const content = patchedArchive.readText(relPath);
        if (relPath.endsWith('.cjs')) {
          checkJsSyntax(content, relPath, false);
        } else if (relPath.endsWith('.js') || relPath.endsWith('.mjs')) {
          checkJsSyntax(content, relPath, true);
          // 回归防线：禁止出现 useEffect(...), 破坏原 comma-let 声明链导致 Assignment to constant variable
          assert.equal(
            /subscribeEntryState\?\.\([^)]+\),\[[^\]]+\]\),/.test(content),
            false,
            `${relPath} 不得在 subscribeEntryState useEffect 后遗留未衔接的逗号`
          );
          if (relPath.includes('ReadOnlyThreadTimeline')) {
            assert.match(
              content,
              /subscribeEntryState\?\.\([^)]+\),\[[^\]]+\]\);let /,
              'zh 中 subscribeEntryState 后必须正确以 ;let 衔接后续变量声明'
            );
          }
        } else if (relPath.endsWith('.html')) {
          const m = content.match(/<script id="t3-enhancer-runtime">([\s\S]*?)<\/script>/);
          assert.ok(m && m[1], 'index.html 必须包含内联运行时脚本');
          checkJsSyntax(m[1], 't3-enhancer-runtime.js', false);
          testRuntimeLogic(m[1]);
        }
      }
    } finally {
      patchedArchive.close();
    }

    // 验证重打补丁的幂等性（在已打补丁的副本上再运行一次 --dry-run）
    const idempotentReport = await runPatch({ app: clonedApp, dryRun: true, strictUpdater: true });
    assert.equal(idempotentReport.ok, true);
    console.log(
      `[check] ✓ 隔离副本完整打补丁 + Info.plist 更新 + codesign --verify + 全量语法与运行时自测通过 (${Date.now() - t0}ms)`
    );

    // 6. 验证核心更新器锚点失配时的安全降级逻辑（--strict-updater 必须返回 ok=false）
    const brokenApp = path.join(tmpRoot, 'BrokenUpdater.app');
    try {
      execFileSync('cp', ['-c', '-R', appPath, brokenApp], { stdio: 'pipe' });
    } catch {
      execFileSync('cp', ['-R', appPath, brokenApp], { stdio: 'pipe' });
    }
    const brokenArchive = new AsarArchive(path.join(brokenApp, 'Contents', 'Resources', 'app.asar'));
    const origMain = brokenArchive.readText('apps/desktop/dist-electron/main.cjs');
    const mutatedMain = origMain.replace('exports.MacUpdater = class MacUpdater', 'exports.MacUpdaterMoved = class MacUpdaterMoved');
    brokenArchive.writePatched(
      path.join(brokenApp, 'Contents', 'Resources', 'app.asar'),
      new Map([['apps/desktop/dist-electron/main.cjs', mutatedMain]])
    );
    brokenArchive.close();

    const failReport = await runPatch({ app: brokenApp, dryRun: true, strictUpdater: true });
    assert.equal(failReport.ok, false, '核心更新器锚点失配在 --strict-updater 模式下必须触发降级退出');
    const updaterMod = failReport.modules.find((m) => m.id === 'mac-updater-hook');
    assert.equal(updaterMod?.status, 'failed');
    console.log('[check] ✓ 核心锚点失配安全降级保护校验通过');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log('\n[check] 全部端到端无侵入测试通过（未改动 /Applications 下任何文件）。');
}

main().catch((err) => {
  console.error('[check] 失败:', err);
  process.exit(1);
});
