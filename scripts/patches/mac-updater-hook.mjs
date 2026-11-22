/**
 * 模块 C：MacUpdater 客户端内一键升级拦截 Hook
 * 原理：
 *  1. 完整保留官方检查更新、架构筛选、update.zip 下载与 SHA-512 校验；
 *  2. 拦截 MacUpdater.updateDownloaded，跳过原生 Squirrel.Mac 签名校验并通知 UI 已就绪；
 *  3. 拦截 MacUpdater.quitAndInstall，detached 拉起 apply-update-helper.sh 完成
 *     “解压新版 -> APFS 备份原厂新版 -> 重打补丁（失配降级干净版）-> 原子替换 -> 重启”。
 */

export const id = 'mac-updater-hook';
export const description = '拦截 MacUpdater 跳过 Squirrel 签名拒装并触发自动重打补丁闭环';
export const featureKey = 'macUpdaterHook';
export const critical = true;

function replaceOnce(source, regex, replacer, label) {
  let count = 0;
  const out = source.replace(regex, (...args) => {
    count += 1;
    return typeof replacer === 'function' ? replacer(...args) : replacer;
  });
  if (count !== 1) {
    throw new Error(`锚点 ${label} 期望匹配 1 次，实际匹配 ${count} 次`);
  }
  return out;
}

export function apply(ctx) {
  const relPath = 'apps/desktop/dist-electron/main.cjs';
  let code = ctx.readText(relPath);

  if (code.includes('__t3EnhancerHandleQuitAndInstall')) {
    return { file: relPath, skipped: true, summary: '已打过 mac-updater-hook 补丁' };
  }

  // 确认目标位于 exports.MacUpdater 类中
  if (!code.includes('exports.MacUpdater = class MacUpdater')) {
    throw new Error('未在 main.cjs 中找到 exports.MacUpdater 类定义');
  }

  // C1：在 MacUpdater.updateDownloaded 开头拦截，记录已校验的 update.zip 路径并直接通知 UI 就绪
  code = replaceOnce(
    code,
    /(async updateDownloaded\(zipFileInfo, event\) \{\s*\n)/g,
    (_, header) => `${header}\t\t\ttry {
				const __t3fs = require("fs");
				const __t3os = require("os");
				const __t3path = require("path");
				const __t3cfgPath = __t3path.join(__t3os.homedir(), ".t3", "enhancer", "config.json");
				if (__t3fs.existsSync(__t3cfgPath) && event && event.downloadedFile && __t3fs.existsSync(event.downloadedFile)) {
					this._t3EnhancerDownloadedFile = event.downloadedFile;
					this._t3EnhancerUpdateEvent = event;
					this.squirrelDownloadedUpdate = true;
					this._logger.info(\`[t3code-enhancer] Intercepted updateDownloaded (bypass Squirrel.Mac): \${event.downloadedFile}\`);
					this.dispatchUpdateDownloaded(event);
					return [];
				}
			} catch (__t3err) {
				this._logger.warn(\`[t3code-enhancer] updateDownloaded hook fallback to native: \${__t3err && __t3err.message ? __t3err.message : __t3err}\`);
			}
`,
    'C1(MacUpdater.updateDownloaded)'
  );

  // C2：在 MacUpdater.quitAndInstall 开头拦截，拉起 detached 后台升级脚本并优雅退出应用
  code = replaceOnce(
    code,
    /(handleUpdateDownloaded\(\) \{\s*\n[\s\S]{0,220}?\}\s*\n\s*quitAndInstall\(\) \{\s*\n)/g,
    (_, prefix) => `${prefix}\t\t\tif (this.__t3EnhancerHandleQuitAndInstall && this.__t3EnhancerHandleQuitAndInstall()) return;
`,
    'C2-1(MacUpdater.quitAndInstall entry)'
  );

  // C2-2：紧接在 handleUpdateDownloaded() 前注入 __t3EnhancerHandleQuitAndInstall 辅助方法
  code = replaceOnce(
    code,
    /(\n\t\thandleUpdateDownloaded\(\) \{)/g,
    (_, anchor) => `
		__t3EnhancerHandleQuitAndInstall() {
			if (!this._t3EnhancerDownloadedFile) return false;
			const __t3fs = require("fs");
			const __t3os = require("os");
			const __t3path = require("path");
			const __t3cp = require("child_process");
			try {
				const cfgPath = __t3path.join(__t3os.homedir(), ".t3", "enhancer", "config.json");
				const cfg = JSON.parse(__t3fs.readFileSync(cfgPath, "utf8"));
				const repoDir = cfg && cfg.repoDir;
				const helperPath = repoDir ? __t3path.join(repoDir, "scripts", "apply-update-helper.sh") : null;
				if (!helperPath || !__t3fs.existsSync(helperPath)) {
					this._logger.warn(\`[t3code-enhancer] Helper script missing: \${helperPath}\`);
					return false;
				}
				const zipPath = this._t3EnhancerDownloadedFile;
				if (!__t3fs.existsSync(zipPath)) {
					this._logger.warn(\`[t3code-enhancer] Downloaded zip missing: \${zipPath}\`);
					return false;
				}
				// 从 Contents/MacOS/<binary> 向上三级推导当前 .app 包路径
				const currentAppPath = __t3path.resolve(process.execPath, "..", "..", "..");
				const relaunch = this.autoRunAppAfterInstall ? "1" : "0";
				const logsDir = __t3path.join(__t3os.homedir(), ".t3", "enhancer", "logs");
				__t3fs.mkdirSync(logsDir, { recursive: true });
				const jobId = \`\${Date.now()}-\${process.pid}\`;
				const jobLabel = \`com.t3code.enhancer.update.\${jobId}\`;
				const plistPath = __t3path.join(logsDir, \`\${jobLabel}.plist\`);
				const helperArgs = [
					"/bin/bash",
					helperPath,
					"--zip", zipPath,
					"--app", currentAppPath,
					"--pid", String(process.pid),
					"--relaunch", relaunch,
					"--launchd-label", jobLabel,
					"--launchd-plist", plistPath
				];
				let launchedViaLaunchd = false;
				if (typeof process.getuid === "function") {
					try {
						const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
						const progXml = helperArgs.map((a) => \`\\t\\t<string>\${xmlEsc(a)}</string>\`).join("\\n");
						const envPairs = [];
						for (const k of ["PATH", "HOME", "USER", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]) {
							if (process.env[k]) {
								envPairs.push(\`\\t\\t<key>\${xmlEsc(k)}</key>\\n\\t\\t<string>\${xmlEsc(process.env[k])}</string>\`);
							}
						}
						const envXml = envPairs.length > 0 ? \`\\n\\t<key>EnvironmentVariables</key>\\n\\t<dict>\\n\${envPairs.join("\\n")}\\n\\t</dict>\` : "";
						const plistXml = \`<?xml version="1.0" encoding="UTF-8"?>\\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\\n<plist version="1.0">\\n<dict>\\n\\t<key>Label</key>\\n\\t<string>\${xmlEsc(jobLabel)}</string>\\n\\t<key>ProgramArguments</key>\\n\\t<array>\\n\${progXml}\\n\\t</array>\${envXml}\\n\\t<key>RunAtLoad</key>\\n\\t<true/>\\n\\t<key>AbandonProcessGroup</key>\\n\\t<true/>\\n</dict>\\n</plist>\\n\`;
						__t3fs.writeFileSync(plistPath, plistXml, "utf8");
						const uid = process.getuid();
						__t3cp.execFileSync("/bin/launchctl", ["bootstrap", \`gui/\${uid}\`, plistPath], { stdio: "ignore", timeout: 5000 });
						launchedViaLaunchd = true;
						this._logger.info(\`[t3code-enhancer] Submitted isolated launchd update job: \${jobLabel}\`);
					} catch (ldErr) {
						try { __t3fs.unlinkSync(plistPath); } catch {}
						this._logger.warn(\`[t3code-enhancer] launchctl bootstrap failed, fallback to detached spawn: \${ldErr && ldErr.message ? ldErr.message : ldErr}\`);
					}
				}
				if (!launchedViaLaunchd) {
					this._logger.info(\`[t3code-enhancer] Spawning detached update helper: \${helperPath}\`);
					const child = __t3cp.spawn("/bin/bash", helperArgs.slice(1), {
						detached: true,
						stdio: "ignore",
						env: { ...process.env }
					});
					child.unref();
				}
				this.closeServerIfExists();
				this.app.quit();
				return true;
			} catch (err) {
				this._logger.warn(\`[t3code-enhancer] quitAndInstall hook failed, fallback to native: \${err && err.message ? err.message : err}\`);
				return false;
			}
		}${anchor}`,
    'C2-2(MacUpdater.__t3EnhancerHandleQuitAndInstall)'
  );

  ctx.writeText(relPath, code);
  return {
    file: relPath,
    summary: '已注入 MacUpdater.updateDownloaded 与 quitAndInstall 自动升级闭环 Hook',
  };
}
