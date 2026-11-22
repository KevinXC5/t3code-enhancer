/**
 * 配置管理、T3 Code 应用探测与 macOS 代码签名工具
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readPlistAsarIntegrity } from './asar-lib.mjs';

export const ENHANCER_HOME = path.join(os.homedir(), '.t3', 'enhancer');
export const CONFIG_PATH = path.join(ENHANCER_HOME, 'config.json');
export const BACKUPS_DIR = path.join(ENHANCER_HOME, 'backups');
export const LOGS_DIR = path.join(ENHANCER_HOME, 'logs');
export const OFFICIAL_TEAM_ID = 'ARK85ZXQ4Z';
export const DEFAULT_LOCAL_CERT_NAME = 'T3 Code Local Patch';

export const DEFAULT_CONFIG = {
  version: 1,
  repoDir: '',
  appPath: '',
  autoPullOnUpdate: false,
  signingIdentity: 'auto',
  features: {
    composerStatus: true,
    liveExpand: true,
    macUpdaterHook: true,
  },
  composerStatus: {
    enabled: true,
    density: 'compact',
    rateMode: 'hybrid',
  },
  liveExpand: {
    enabled: true,
    fixedHeightPx: 300,
    onlyLatestEntry: true,
    showToggleButton: true,
  },
};

function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

export function deepMerge(base, override) {
  if (!isPlainObject(base)) return override;
  const out = { ...base };
  if (!isPlainObject(override)) return out;
  for (const [k, v] of Object.entries(override)) {
    if (isPlainObject(v) && isPlainObject(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

export function ensureEnhancerDirs() {
  fs.mkdirSync(ENHANCER_HOME, { recursive: true });
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return deepMerge(DEFAULT_CONFIG, raw);
    }
  } catch {
    // 配置文件损坏时回退默认配置，避免阻断补丁流程
  }
  return structuredClone(DEFAULT_CONFIG);
}

export function saveConfig(partial) {
  ensureEnhancerDirs();
  const merged = deepMerge(loadConfig(), partial);
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  return merged;
}

/**
 * 自动探测本机 T3 Code .app 路径
 */
export function detectT3AppPath(explicitPath) {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`指定的应用路径不存在：${resolved}`);
    }
    return resolved;
  }

  const candidates = [
    '/Applications/T3 Code (Nightly).app',
    '/Applications/T3 Code.app',
    path.join(os.homedir(), 'Applications', 'T3 Code (Nightly).app'),
    path.join(os.homedir(), 'Applications', 'T3 Code.app'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'Contents', 'Resources', 'app.asar'))) {
      return candidate;
    }
  }

  throw new Error(
    `未在常见目录找到 T3 Code.app，请通过 --app 参数指定路径。已检查：${candidates.join(', ')}`
  );
}

/**
 * 读取 .app 的基础信息与代码签名状态
 */
export function readAppInfo(appPath) {
  const infoPlistPath = path.join(appPath, 'Contents', 'Info.plist');
  const asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  if (!fs.existsSync(infoPlistPath) || !fs.existsSync(asarPath)) {
    throw new Error(`目标不是有效的 Electron 应用包：${appPath}`);
  }

  const readKey = (key) => {
    try {
      return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, infoPlistPath], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    } catch {
      return null;
    }
  };

  let codesignSummary = '';
  let isOfficialSigned = false;
  let teamId = null;
  try {
    // codesign -dv 输出在 stderr
    execFileSync('codesign', ['-dv', '--verbose=2', appPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    codesignSummary = String(err.stderr || err.stdout || '');
  }
  if (!codesignSummary) {
    try {
      const res = execFileSync('sh', ['-c', `codesign -dv --verbose=2 "$1" 2>&1`, '_', appPath], {
        encoding: 'utf8',
      });
      codesignSummary = res;
    } catch (err) {
      codesignSummary = String(err.stdout || err.stderr || '');
    }
  }

  const teamMatch = codesignSummary.match(/^TeamIdentifier=(.+)$/m);
  if (teamMatch) teamId = teamMatch[1].trim();
  isOfficialSigned = teamId === OFFICIAL_TEAM_ID;

  return {
    appPath,
    infoPlistPath,
    asarPath,
    name: readKey('CFBundleName') || path.basename(appPath, '.app'),
    bundleId: readKey('CFBundleIdentifier'),
    version: readKey('CFBundleShortVersionString') || readKey('CFBundleVersion') || 'unknown',
    asarIntegrityHash: readPlistAsarIntegrity(infoPlistPath),
    teamId,
    isOfficialSigned,
  };
}

/**
 * 检测可用的本地代码签名证书；优先使用用户配置或默认本地证书，否则回退 ad-hoc ("-")
 */
export function detectSigningIdentity(preferred = 'auto') {
  if (preferred && preferred !== 'auto' && preferred !== '-') {
    return { identity: preferred, mode: 'explicit' };
  }
  if (preferred === '-') {
    return { identity: '-', mode: 'ad-hoc' };
  }

  try {
    const out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (out.includes(`"${DEFAULT_LOCAL_CERT_NAME}"`)) {
      return { identity: DEFAULT_LOCAL_CERT_NAME, mode: 'local-cert' };
    }
  } catch {
    // 钥匙串不可用时静默回退 ad-hoc
  }
  return { identity: '-', mode: 'ad-hoc' };
}

/**
 * 对修改后的 .app 重新签名并校验
 */
export function codesignApp(appPath, preferredIdentity = 'auto') {
  const resolved = detectSigningIdentity(preferredIdentity);
  // 移除可能存在的扩展隔离属性，避免重新签名报错
  try {
    execFileSync('xattr', ['-cr', appPath], { stdio: 'ignore' });
  } catch {}

  execFileSync('codesign', ['--force', '--deep', '--sign', resolved.identity, appPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return resolved;
}
