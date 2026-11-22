/**
 * 模块 D（服务端增强）：Antigravity ACP 步级缓存与用量实时桥接
 * 背景：
 *  - Claude Code / Codex / OpenCode 每步结束后 T3 服务端都会通过 provider_turn.updated 刷新 tokenUsage；
 *  - Antigravity 走 ACP 协议，usage_update 通知仅含 used/size，不含 cachedReadTokens，默认只在回合结束返回 turnTokenUsage；
 *  - 但 Antigravity 每完成一步 PLANNER_RESPONSE / CHECKPOINT 就会实时将精确的 input_tokens / cache_read_tokens / output_tokens
 *    追加写入本地 transcript.jsonl（与回合最终 turnTokenUsage 逐个 token 完全一致）。
 * 实现：
 *  - 仅修补 apps/server/dist/runtimeLayer-*.mjs 的 makeAcpAdapterV2；
 *  - 按字节偏移增量读取 transcript.jsonl 新增行（单次 stat 微秒级、零 SQLite 锁竞争）；
 *  - 每发现新步骤即复用 T3 原生 provider_turn.updated（tokenUsage 字段）实时推给前端，零新协议字段；
 *  - 本模块 critical: false，若上游重构可独立降级，不影响客户端启动、升级闭环与其他模块。
 */

export const id = 'step-usage-bridge';
export const description = 'Antigravity 步级 transcript.jsonl 增量桥接至原生 provider_turn.updated.tokenUsage';
export const featureKey = 'composerStatus';
export const critical = false;

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
  const candidates = ctx.archive.findFiles(
    (f) => f.path.startsWith('apps/server/dist/') && f.path.endsWith('.mjs')
  ).filter((f) => {
    const txt = ctx.readText(f.path);
    return (
      txt.includes('const makeAcpAdapterV2 =') &&
      txt.includes('acpPerTurnPromptUsage') &&
      txt.includes('const handleSessionUpdate =')
    );
  });

  if (candidates.length !== 1) {
    throw new Error(
      `无法唯一定位 runtimeLayer chunk（期望 1 个，找到 ${candidates.length} 个）`
    );
  }

  const targetPath = candidates[0].path;
  let code = ctx.readText(targetPath);

  if (code.includes('__t3EnhancerSyncAgStepUsage')) {
    return { file: targetPath, skipped: true, summary: '已打过 step-usage-bridge 补丁' };
  }

  // 从文件顶部动态提取已导入的 node:fs / node:path / node:os 标识符，避免硬编码捆绑器变量名
  const headerSlice = code.slice(0, 80000);
  const fsMatch = headerSlice.match(/import\s+\*\s+as\s+([$\w]+)\s+from\s+["']node:fs["']/);
  const pathMatch = headerSlice.match(/import\s+\*\s+as\s+([$\w]+)\s+from\s+["']node:path["']/);
  const osMatch = headerSlice.match(/import\s+\*\s+as\s+([$\w]+)\s+from\s+["']node:os["']/);
  if (!fsMatch || !pathMatch || !osMatch) {
    throw new Error('未在 runtimeLayer 顶部找到 node:fs / node:path / node:os 命名空间导入');
  }
  const FS = fsMatch[1];
  const PATH = pathMatch[1];
  const OS = osMatch[1];

  // S1：在 makeAcpAdapterV2 内部（driver 声明之后）注入 Antigravity transcript.jsonl 增量读取引擎
  const helperCode = `
	const __t3AgPathCache = new Map();
	const __t3AgMaxTokensCache = new Map();
	const __t3AgFindTranscript = (sessionId) => {
		if (!sessionId || typeof sessionId !== "string" || /[\\/\\\\]/.test(sessionId) || sessionId.includes("..")) return null;
		const cached = __t3AgPathCache.get(sessionId);
		if (cached && ${FS}.existsSync(cached)) return cached;
		const suffix = ${PATH}.join("brain", sessionId, ".system_generated", "logs", "transcript.jsonl");
		const candidates = [];
		try {
			const agRoot = ${PATH}.join(host.paths.stateDir, "providers", "antigravity");
			if (${FS}.existsSync(agRoot)) {
				for (const entry of ${FS}.readdirSync(agRoot)) {
					candidates.push(${PATH}.join(agRoot, entry, "antigravity-acp", suffix));
				}
			}
		} catch {}
		try {
			const home = ${OS}.homedir();
			for (const name of ["antigravity", "antigravity-cli", "antigravity-ide"]) {
				candidates.push(${PATH}.join(home, ".gemini", name, suffix));
			}
		} catch {}
		for (const p of candidates) {
			try {
				if (${FS}.existsSync(p)) {
					if (__t3AgPathCache.size > 64) {
						const first = __t3AgPathCache.keys().next().value;
						if (first) __t3AgPathCache.delete(first);
					}
					__t3AgPathCache.set(sessionId, p);
					return p;
				}
			} catch {}
		}
		return null;
	};
	const __t3AgReadChunk = (filePath, startOffset, maxBytes) => {
		const st = ${FS}.statSync(filePath);
		if (st.size <= startOffset) return { size: st.size, nextOffset: startOffset, lines: [] };
		let from = startOffset;
		let dropFirst = false;
		if (st.size - from > maxBytes) {
			from = st.size - maxBytes;
			dropFirst = true;
		}
		const len = st.size - from;
		const buf = Buffer.allocUnsafe(len);
		const fd = ${FS}.openSync(filePath, "r");
		try {
			const read = ${FS}.readSync(fd, buf, 0, len, from);
			const slice = buf.subarray(0, read);
			const lastNl = slice.lastIndexOf(10);
			if (lastNl < 0) return { size: st.size, nextOffset: from, lines: [] };
			const text = slice.subarray(0, lastNl).toString("utf8");
			const lines = text.split("\\n");
			if (dropFirst && lines.length > 0) lines.shift();
			return { size: st.size, nextOffset: from + lastNl + 1, lines };
		} finally {
			${FS}.closeSync(fd);
		}
	};
	const __t3AgInitBaseline = (context) => {
		if (driver !== "antigravity" || !context || context.__t3AgStepState) return;
		const sessionId = context.nativeThreadId;
		const startedMs = typeof context.startedAt === "string"
			? Date.parse(context.startedAt)
			: (context.startedAt?.epochMilliseconds ?? context.startedAt?.epochMillis ?? Date.now());
		const state = {
			filePath: null,
			offset: 0,
			lastStepIndex: -1,
			lastProbeAt: 0,
			lastCheckAt: 0,
			lastEmitMs: 0,
			startedMs: Number.isFinite(startedMs) ? startedMs : Date.now(),
			initialized: false
		};
		try {
			const p = __t3AgFindTranscript(sessionId);
			if (p) {
				state.filePath = p;
				const st = ${FS}.statSync(p);
				state.offset = st.size;
				// 扫描末尾至多 32KB 获取当前最大 step_index 作为基线，避免重算历史回合
				const tailFrom = Math.max(0, st.size - 32768);
				const chunk = __t3AgReadChunk(p, tailFrom, 32768);
				for (let i = 0; i < chunk.lines.length; i++) {
					const line = chunk.lines[i];
					if (!line.includes("step_index")) continue;
					try {
						const o = JSON.parse(line);
						if (typeof o.step_index === "number" && o.step_index > state.lastStepIndex) {
							state.lastStepIndex = o.step_index;
						}
					} catch {}
				}
				state.initialized = true;
			}
		} catch {}
		context.__t3AgStepState = state;
	};
	const __t3EnhancerSyncAgStepUsage = (context, force) => {
		if (driver !== "antigravity" || !context || !context.nativeThreadId) return null;
		const sessionId = context.nativeThreadId;
		if (context.contextUsage?.maxTokens > 0) {
			__t3AgMaxTokensCache.set(sessionId, context.contextUsage.maxTokens);
		}
		if (!context.__t3AgStepState) __t3AgInitBaseline(context);
		const state = context.__t3AgStepState;
		const nowMs = Date.now();
		if (!force && nowMs - state.lastCheckAt < 350) return null;
		state.lastCheckAt = nowMs;
		try {
			if (!state.filePath) {
				if (!force && nowMs - state.lastProbeAt < 800) return null;
				state.lastProbeAt = nowMs;
				const p = __t3AgFindTranscript(sessionId);
				if (!p) return null;
				state.filePath = p;
				const st = ${FS}.statSync(p);
				state.offset = Math.max(0, st.size - 65536);
			}
			const chunk = __t3AgReadChunk(state.filePath, state.offset, 524288);
			if (chunk.nextOffset > state.offset) state.offset = chunk.nextOffset;
			if (chunk.lines.length === 0) return null;
			const maxTokens = context.contextUsage?.maxTokens ?? __t3AgMaxTokensCache.get(sessionId) ?? null;
			const steps = [];
			for (let i = 0; i < chunk.lines.length; i++) {
				const line = chunk.lines[i];
				if (!line || (!line.includes("input_tokens") && !line.includes("cache_read_tokens"))) continue;
				let o;
				try { o = JSON.parse(line); } catch { continue; }
				if (!o || (o.input_tokens == null && o.cache_read_tokens == null)) continue;
				if (typeof o.step_index === "number") {
					if (o.step_index <= state.lastStepIndex) continue;
				}
				const createdMs = typeof o.created_at === "string" ? Date.parse(o.created_at) : NaN;
				if (!state.initialized && Number.isFinite(createdMs) && createdMs < state.startedMs - 2000) {
					if (typeof o.step_index === "number" && o.step_index > state.lastStepIndex) state.lastStepIndex = o.step_index;
					continue;
				}
				if (typeof o.step_index === "number") state.lastStepIndex = o.step_index;
				const uncached = Math.max(0, Math.round(Number(o.input_tokens) || 0));
				const cached = Math.max(0, Math.round(Number(o.cache_read_tokens) || 0));
				const output = Math.max(0, Math.round(Number(o.output_tokens) || 0));
				const totalInput = uncached + cached;
				if (totalInput <= 0 && output <= 0) continue;
				const rawTs = Number.isFinite(createdMs) ? createdMs : nowMs;
				const emitMs = Math.max(rawTs, state.lastEmitMs + 1);
				state.lastEmitMs = emitMs;
				const stepUsage = {
					usedTokens: totalInput + output,
					maxTokens,
					inputTokens: totalInput,
					cachedInputTokens: cached,
					outputTokens: output,
					reasoningOutputTokens: 0,
					updatedAt: new Date(emitMs).toISOString()
				};
				context.__t3EnhancerLastTokenUsage = stepUsage;
				steps.push(stepUsage);
			}
			state.initialized = true;
			return steps.length > 0 ? steps : null;
		} catch {
			return null;
		}
	};`;

  code = replaceOnce(
    code,
    /(const makeAcpAdapterV2 = fn\("makeAcpAdapterV2"\)\(function\* \(options\) \{[\s\S]{1,1400}?const driver = flavor\.driver;)/,
    (_, head) => `${head}${helperCode}`,
    'S1(makeAcpAdapterV2 step usage helper)'
  );

  // S2：在 providerTurnPayload 中附带最新一步的原生 tokenUsage（若有）
  code = replaceOnce(
    code,
    /(const providerTurnPayload = \(context, status, completedAt\) => \(\{[\s\S]{1,700}?completedAt,)(\s*\.\.\.status === "running" \|\| status === "pending" \? \{\} : \{ turnTokenUsage: acpPerTurnPromptUsage\()/,
    (_, head, tail) =>
      `${head}\n\t\t\t\t...context.__t3EnhancerLastTokenUsage === void 0 ? {} : { tokenUsage: context.__t3EnhancerLastTokenUsage },${tail}`,
    'S2(providerTurnPayload tokenUsage)'
  );

  // S3：在 runningTurn 初始化时建立本轮文件尾基线
  code = replaceOnce(
    code,
    /(const runningTurn = providerTurnPayload\(context, "running", null\);)/,
    (_, match) => `__t3AgInitBaseline(context);\n\t\t\t\t${match}`,
    'S3(runningTurn baseline init)'
  );

  // S4：在 handleSessionUpdate 收到 ACP 通知时增量推送每一步的 tokenUsage
  // 动态捕获 providerTurns 的 update helper 变量名（如 update$5）
  const updateFnMatch = code.match(
    /yield\*\s+([$\w]+)\(providerTurns,\s*\(current\)\s*=>\s*\{\s*const updated = new Map\(current\);/
  );
  if (!updateFnMatch) {
    throw new Error('未在 runtimeLayer 中找到 providerTurns 的 Ref.update 辅助函数名');
  }
  const UPDATE_FN = updateFnMatch[1];

  code = replaceOnce(
    code,
    /(const handleSessionUpdate = fnUntraced\(function\* \(notification\) \{\s*const context = yield\* [$\w]+\(activeTurn\);\s*const update = notification\.update;)/,
    (_, head) =>
      `${head}
				if (driver === "antigravity" && context !== null && !context.finalized && context.nativeThreadId === notification.sessionId) {
					const __t3Force = update?.sessionUpdate === "usage_update" || update?.sessionUpdate === "tool_call" || update?.sessionUpdate === "tool_call_update";
					const __t3Steps = __t3EnhancerSyncAgStepUsage(context, __t3Force);
					if (__t3Steps !== null) {
						for (let __i = 0; __i < __t3Steps.length; __i++) {
							const __t3Turn = { ...providerTurnPayload(context, "running", null), tokenUsage: __t3Steps[__i] };
							yield* ${UPDATE_FN}(providerTurns, (current) => {
								const updated = new Map(current);
								updated.set(String(__t3Turn.id), __t3Turn);
								return updated;
							});
							yield* emitProviderEvent({
								type: "provider_turn.updated",
								driver,
								threadId: context.input.threadId,
								providerTurn: __t3Turn
							});
						}
					}
				}`,
    'S4(handleSessionUpdate per-step emit)'
  );

  // S5：在 finalizeTurn 开始时补采一次尾步，确保单步回合也能立刻更新 tokenUsage
  code = replaceOnce(
    code,
    /(const finalizeTurn = fnUntraced\(function\* \(context, status, failure, options\) \{\s*if \(context\.finalized\) return;)/,
    (_, head) =>
      `${head}\n\t\t\t\tif (driver === "antigravity") __t3EnhancerSyncAgStepUsage(context, true);`,
    'S5(finalizeTurn final step sync)'
  );

  ctx.writeText(targetPath, code);
  return {
    file: targetPath,
    summary: `已修补 ${targetPath.split('/').pop()}（Antigravity transcript.jsonl 步级实时桥接）`,
  };
}
