/**
 * 全局运行时注入模块（index.html）
 * 提供：
 *  1. DeepSeek Harness 风格三段式独立指标栏（嵌入原生 composer-context-strip 中间空位）
 *     - 芯片 1（仪表盘）：轮数/步数 · 输出速率 (tok/s) + 专属“会话统计”悬停卡片
 *     - 芯片 2（数据库）：总用量 · 缓存命中率 + 专属“用量统计”悬停卡片
 *     - 芯片 3（圆环进度）：上下文占用百分比 + 专属“上下文已用”分段进度条卡片
 *     - 芯片 4（轻量开关）：一键切换流式自动展开
 *  2. 极致性能设计：零常驻 MutationObserver、零空闲轮询、末尾增量采样、DOM Diff 缓存、Hover 懒渲染
 *  3. window.__t3Enhancer 状态总线（模块 A 遥测 + 模块 B 流式自动展开）
 */

export const id = 'head-runtime';
export const description = '全局运行时总线、DeepSeek Harness 风格底栏遥测与流式展开样式';
export const featureKey = null;
export const critical = false;

const MARKER_BEGIN = '<!-- t3code-enhancer:begin -->';
const MARKER_END = '<!-- t3code-enhancer:end -->';

function buildInjectedBlock(config) {
  const initConfig = {
    composerStatus: {
      enabled: config.features?.composerStatus !== false && config.composerStatus?.enabled !== false,
      density: config.composerStatus?.density || 'compact',
      rateMode: config.composerStatus?.rateMode || 'hybrid',
    },
    liveExpand: {
      enabled: config.features?.liveExpand !== false && config.liveExpand?.enabled !== false,
      fixedHeightPx: Number(config.liveExpand?.fixedHeightPx) || 300,
      onlyLatestEntry: config.liveExpand?.onlyLatestEntry !== false,
      showToggleButton: config.liveExpand?.showToggleButton !== false,
    },
  };

  const css = `
:root {
  --t3-enhancer-live-height: ${initConfig.liveExpand.fixedHeightPx}px;
}

/* 模块 B：保留分组原生展示，统一给思考与工具展开内容区（含纯思考组 Ih 与工具组 Jh）对齐缩进、固定最大高度与柔和边框 */
html[data-t3-enhancer-live-expand="true"] [data-t3-enhancer-entry-panel="text"] {
  max-height: var(--t3-enhancer-live-height, 300px) !important;
  overflow-y: auto !important;
  overscroll-behavior: contain;
  border: 1px solid color-mix(in srgb, var(--border, currentColor) 55%, transparent);
  border-radius: var(--radius, 8px);
  background: color-mix(in srgb, var(--muted, transparent) 18%, transparent);
  padding: 8px 10px !important;
  margin-top: 4px;
  margin-bottom: 6px;
}

html[data-t3-enhancer-live-expand="true"] [data-t3-enhancer-entry-panel="panel"] {
  margin-inline-start: 1.75rem;
  max-height: var(--t3-enhancer-live-height, 300px) !important;
  overflow-y: auto !important;
  overscroll-behavior: contain;
  border: 1px solid color-mix(in srgb, var(--border, currentColor) 55%, transparent);
  border-radius: var(--radius, 8px);
  padding: 6px 8px !important;
}

/* 文件编辑内联红绿 Diff 样式 */
.t3-enhancer-inline-diff {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  font-size: 11.5px;
  line-height: 1.48;
  border-radius: calc(var(--radius, 8px) - 2px);
  border: 1px solid color-mix(in srgb, var(--border, currentColor) 65%, transparent);
  background: var(--code-background, color-mix(in srgb, var(--muted, transparent) 24%, transparent));
  overflow-x: auto;
  padding: 4px 0;
  margin-top: 4px;
  user-select: text;
}

.t3-enhancer-diff-line {
  display: block;
  padding: 0 10px;
  white-space: pre;
  min-width: max-content;
}

.t3-enhancer-diff-line[data-kind="add"] {
  background: color-mix(in srgb, var(--success, #22c55e) 15%, transparent);
  color: color-mix(in srgb, var(--success, #4ade80) 78%, var(--foreground, #e6edf3));
}

.t3-enhancer-diff-line[data-kind="del"] {
  background: color-mix(in srgb, var(--destructive, #ef4444) 15%, transparent);
  color: color-mix(in srgb, var(--destructive, #f87171) 78%, var(--foreground, #e6edf3));
}

.t3-enhancer-diff-line[data-kind="hunk"] {
  background: var(--app-theme-accent-surface, var(--accent-surface, color-mix(in srgb, var(--accent, var(--muted, currentColor)) 18%, transparent)));
  color: var(--app-theme-accent-surface-foreground, var(--accent-surface-foreground, var(--muted-foreground, #8b949e)));
  padding-top: 2px;
  padding-bottom: 2px;
  margin: 2px 0;
}

.t3-enhancer-diff-line[data-kind="ctx"] {
  color: var(--muted-foreground, #9ca3af);
}

.t3-enhancer-diff-more {
  padding: 4px 10px 2px;
  font-size: 11px;
  color: var(--muted-foreground, #9ca3af);
  font-style: italic;
}

/* 模块 A：通过 Flexbox order 精准嵌入原生底部上下文条（左侧设备/工作副本与右侧分支/权限之间） */
[data-slot="composer-context-strip"] > .flex-1 {
  order: 1;
}

[data-slot="composer-context-strip"] > .flex-1 ~ :not([data-t3-enhancer-statusbar="true"]) {
  order: 3;
}

.t3-enhancer-statusbar {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 0.75rem;
  line-height: 1rem;
  font-family: inherit;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  color: inherit;
  user-select: none;
  min-width: 0;
}

.t3-enhancer-statusbar[data-layout="strip"] {
  order: 2;
  margin-left: auto;
  margin-right: 2px;
  height: 1.5rem;
  flex: 0 1 auto;
  max-width: 62%;
}

.t3-enhancer-statusbar[data-layout="fallback"] {
  display: flex;
  justify-content: flex-end;
  width: 100%;
  padding: 6px 8px 0;
  min-height: 1.5rem;
}

.t3-enhancer-chip,
.t3-enhancer-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  height: 1.5rem;
  padding: 0 0.4375rem;
  border-radius: var(--radius, 0.5rem);
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: 1rem;
  white-space: nowrap;
  cursor: default;
  transition: background-color 140ms ease, color 140ms ease, opacity 140ms ease;
}

.t3-enhancer-toggle {
  cursor: pointer;
}

.t3-enhancer-chip:hover,
.t3-enhancer-chip[data-hovered="true"],
.t3-enhancer-toggle:hover {
  background: var(--app-theme-accent-surface, var(--accent-surface, color-mix(in srgb, var(--app-theme-accent, var(--accent, var(--muted, currentColor))) 22%, transparent)));
  color: var(--app-theme-text, var(--foreground, inherit));
}

.t3-enhancer-chip:hover .t3-enhancer-chip-icon,
.t3-enhancer-chip[data-hovered="true"] .t3-enhancer-chip-icon,
.t3-enhancer-toggle:hover .t3-enhancer-chip-icon {
  color: var(--app-theme-accent-surface-foreground, var(--accent-surface-foreground, var(--foreground, inherit)));
  opacity: 1;
}

.t3-enhancer-chip-icon {
  width: 0.75rem;
  height: 0.75rem;
  flex-shrink: 0;
  opacity: 0.85;
  transition: color 140ms ease, opacity 140ms ease;
}

.t3-enhancer-ring {
  width: 0.75rem;
  height: 0.75rem;
  flex-shrink: 0;
  transform: rotate(-90deg);
}

.t3-enhancer-ring-track {
  stroke: color-mix(in srgb, currentColor 32%, transparent);
}

.t3-enhancer-ring-fill {
  stroke: currentColor;
  transition: stroke-dashoffset 220ms ease, stroke 180ms ease;
}

.t3-enhancer-chip:hover .t3-enhancer-ring-fill,
.t3-enhancer-chip[data-hovered="true"] .t3-enhancer-ring-fill {
  stroke: var(--app-theme-accent-surface-foreground, var(--accent-surface-foreground, var(--foreground, currentColor)));
}

.t3-enhancer-ring-fill[data-tone="warn"] {
  stroke: var(--warning, #f59e0b);
}

.t3-enhancer-ring-fill[data-tone="danger"] {
  stroke: var(--destructive, #ef4444);
}

.t3-enhancer-sep {
  opacity: 0.45;
  margin: 0 1px;
}

.t3-enhancer-num {
  font-variant-numeric: tabular-nums;
}

.t3-enhancer-live-rate {
  color: var(--foreground, inherit);
}

.t3-enhancer-tone-warn {
  color: var(--warning, #f59e0b);
}

.t3-enhancer-tone-danger {
  color: var(--destructive, #ef4444);
}

.t3-enhancer-cache-warm {
  color: var(--success, #22c55e);
}

.t3-enhancer-cache-cold {
  color: var(--warning, #f59e0b);
}

.t3-enhancer-toggle[data-active="false"] {
  opacity: 0.5;
}

.t3-enhancer-toggle[data-active="false"]:hover {
  opacity: 1;
}

/* DeepSeek Harness 风格独立悬停卡片（挂在 body 下使用 fixed 定位，永不被裁切） */
.t3-enhancer-popover {
  position: fixed;
  z-index: 9999;
  width: 286px;
  padding: 13px 15px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--border, rgba(255, 255, 255, 0.14)) 90%, transparent);
  background: color-mix(in srgb, var(--popover, var(--card, #23252a)) 96%, transparent);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  color: var(--popover-foreground, var(--foreground, #f4f4f5));
  box-shadow: 0 16px 38px -10px rgba(0, 0, 0, 0.55);
  font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  line-height: 1.45;
  pointer-events: none;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 120ms ease, transform 120ms ease;
}

.t3-enhancer-popover[data-open="true"] {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.t3-enhancer-pop-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 28px;
  margin-top: 2px;
  padding: 0 10px;
  border-radius: 7px;
  border: 1px solid color-mix(in srgb, var(--border, rgba(255, 255, 255, 0.14)) 90%, transparent);
  background: color-mix(in srgb, var(--muted, rgba(255, 255, 255, 0.08)) 55%, transparent);
  color: var(--foreground, #f4f4f5);
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, opacity 120ms ease;
}

.t3-enhancer-pop-btn:hover:not(:disabled) {
  background: var(--app-theme-accent-surface, var(--accent-surface, color-mix(in srgb, var(--app-theme-accent, var(--accent, var(--muted, currentColor))) 25%, transparent)));
  border-color: color-mix(in srgb, var(--app-theme-accent, var(--accent, var(--border, currentColor))) 50%, transparent);
  color: var(--app-theme-accent-surface-foreground, var(--accent-surface-foreground, var(--foreground, inherit)));
}

.t3-enhancer-pop-btn:active:not(:disabled) {
  transform: scale(0.99);
}

.t3-enhancer-pop-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.t3-enhancer-pop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--foreground, #f4f4f5);
}

.t3-enhancer-pop-head-left {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.t3-enhancer-pop-head-val {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  font-weight: 500;
  color: var(--foreground, #f4f4f5);
}

.t3-enhancer-pop-divider {
  height: 1px;
  margin: 10px 0;
  background: color-mix(in srgb, var(--border, rgba(255, 255, 255, 0.12)) 75%, transparent);
}

.t3-enhancer-pop-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 7px 0;
}

.t3-enhancer-pop-row:last-child {
  margin-bottom: 0;
}

.t3-enhancer-pop-k {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--muted-foreground, #9ca3af);
}

.t3-enhancer-pop-v {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11.5px;
  color: var(--foreground, #e5e7eb);
  text-align: right;
  white-space: nowrap;
}

.t3-enhancer-pop-bar {
  display: flex;
  width: 100%;
  height: 5px;
  border-radius: 9999px;
  overflow: hidden;
  background: color-mix(in srgb, var(--muted-foreground, #8b949e) 22%, transparent);
  margin: 11px 0 12px;
  gap: 1.5px;
}

.t3-enhancer-pop-bar-seg {
  height: 100%;
  border-radius: 9999px;
  min-width: 2px;
}

.t3-enhancer-legend-sq {
  width: 8px;
  height: 8px;
  border-radius: 2.5px;
  flex-shrink: 0;
}

@media (max-width: 820px) {
  .t3-enhancer-statusbar[data-layout="strip"] {
    max-width: 50%;
  }
  .t3-enhancer-hide-sm {
    display: none;
  }
}
`.trim();

  const runtimeJs = `
(() => {
  if (window.__t3Enhancer && window.__t3Enhancer.__version === 1) return;

  const STORAGE_KEY = 't3-enhancer:settings:v1';
  const INIT_CONFIG = ${JSON.stringify(initConfig)};

  const ICON_GAUGE =
    '<svg class="t3-enhancer-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>' +
    '</svg>';

  const ICON_DB =
    '<svg class="t3-enhancer-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>' +
    '</svg>';

  const ICON_EXPAND =
    '<svg class="t3-enhancer-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>' +
    '</svg>';

  const ICON_COLLAPSE =
    '<svg class="t3-enhancer-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/>' +
    '</svg>';

  const ICON_COMPACT =
    '<svg class="t3-enhancer-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="m4 14 6-6"/><path d="M10 14V8H4"/><path d="m20 10-6 6"/><path d="M14 10v6h6"/>' +
    '</svg>';

  function buildRingSvg(pct, tone) {
    const r = 5.2;
    const c = 2 * Math.PI * r;
    const clamped = pct == null ? 0 : Math.max(0, Math.min(100, pct));
    const offset = c * (1 - clamped / 100);
    return (
      '<svg class="t3-enhancer-ring" viewBox="0 0 14 14" fill="none">' +
      '<circle class="t3-enhancer-ring-track" cx="7" cy="7" r="' + r + '" stroke-width="1.8"/>' +
      '<circle class="t3-enhancer-ring-fill" data-tone="' + (tone || '') + '" cx="7" cy="7" r="' + r + '" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + offset.toFixed(2) + '"/>' +
      '</svg>'
    );
  }

  function loadSettings() {
    const base = {
      composerStatusEnabled: INIT_CONFIG.composerStatus.enabled,
      rateMode: INIT_CONFIG.composerStatus.rateMode,
      liveExpandEnabled: INIT_CONFIG.liveExpand.enabled,
      fixedHeightPx: INIT_CONFIG.liveExpand.fixedHeightPx,
      onlyLatestEntry: INIT_CONFIG.liveExpand.onlyLatestEntry,
      showToggleButton: INIT_CONFIG.liveExpand.showToggleButton,
    };
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          // 界面可切换开关走 localStorage 持久化，fixedHeightPx 始终遵循 config.json 注入值
          const { fixedHeightPx: _ignoredHeight, ...rest } = parsed;
          Object.assign(base, rest);
        }
      }
    } catch {}
    return base;
  }

  const settings = loadSettings();
  function applyCssVars() {
    const h = Math.max(120, Math.min(640, Number(settings.fixedHeightPx) || 300));
    document.documentElement.style.setProperty('--t3-enhancer-live-height', h + 'px');
    if (document.documentElement.setAttribute) {
      document.documentElement.setAttribute(
        'data-t3-enhancer-live-expand',
        settings.liveExpandEnabled ? 'true' : 'false'
      );
    }
  }
  applyCssVars();

  function persistSettings() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {}
    applyCssVars();
  }

  // ==================== 模块 B：流式自动展开状态总线 ====================
  const activeGroupIds = new Set();
  const manuallyCollapsedGroups = new Set();
  const manualEntryStates = new Map();
  const autoExpandedEntries = new Set();
  const entryListeners = new Map();
  const timelineRefreshers = new Set();

  function trimSet(set, maxSize) {
    if (set.size <= maxSize) return;
    const excess = set.size - maxSize;
    let i = 0;
    for (const v of set) {
      set.delete(v);
      if (++i >= excess) break;
    }
  }

  function trimMap(map, maxSize) {
    if (map.size <= maxSize) return;
    const excess = map.size - maxSize;
    let i = 0;
    for (const k of map.keys()) {
      map.delete(k);
      if (++i >= excess) break;
    }
  }

  function notifyEntryListeners(entryId, nextExpanded) {
    queueMicrotask(() => {
      const set = entryListeners.get(entryId);
      if (!set) return;
      for (const fn of set) {
        try {
          fn(nextExpanded);
        } catch {}
      }
      followAllLiveScrolls();
    });
  }

  // ==================== 活跃工作组固定视口自动滚底控制器 ====================
  const liveScrollStates = new WeakMap();

  function getOrAttachScrollState(el) {
    let st = liveScrollStates.get(el);
    if (st) return st;
    st = {
      paused: false,
      programmaticAt: 0,
      rafId: 0,
    };
    liveScrollStates.set(el, st);

    // 用户向上滚动滚轮立即暂停自动跟底，绝不与用户抢滚动条
    el.addEventListener(
      'wheel',
      (ev) => {
        if (ev.deltaY < 0) {
          st.paused = true;
        } else if (ev.deltaY > 0) {
          const dist = el.scrollHeight - el.clientHeight - el.scrollTop;
          if (dist <= 24) st.paused = false;
        }
      },
      { passive: true }
    );

    el.addEventListener(
      'scroll',
      () => {
        if (Date.now() - st.programmaticAt < 140) return;
        const dist = el.scrollHeight - el.clientHeight - el.scrollTop;
        if (dist > 32) {
          st.paused = true;
        } else if (dist <= 18) {
          st.paused = false;
        }
      },
      { passive: true }
    );
    return st;
  }

  function followElementBottom(el) {
    if (!el) return;
    const st = getOrAttachScrollState(el);
    if (st.paused) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 1 || maxScroll - el.scrollTop <= 2) return;
    if (st.rafId) return;
    st.rafId = window.requestAnimationFrame(() => {
      st.rafId = 0;
      if (st.paused || !el.isConnected) return;
      const target = el.scrollHeight - el.clientHeight;
      if (target > 1 && target - el.scrollTop > 1) {
        st.programmaticAt = Date.now();
        el.scrollTop = target;
      }
    });
  }

  function followLiveScroll(el) {
    if (!el || !settings.liveExpandEnabled) return;
    if (el.getAttribute && el.getAttribute('data-t3-enhancer-live-group') !== 'true') return;
    // 1. 若分组本身超高，保持最新命令标题在可视底端
    followElementBottom(el);
    // 2. 同时对当前展开的命令/思考详情面板及其内部可滚动代码块执行滚底
    const panels = el.querySelectorAll('[data-t3-enhancer-entry-panel]');
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];
      followElementBottom(panel);
      const innerScrolls = panel.querySelectorAll('pre, [class*="overflow-y-auto"], [class*="overflow-auto"]');
      for (let j = 0; j < innerScrolls.length; j++) {
        followElementBottom(innerScrolls[j]);
      }
    }
  }

  function followAllLiveScrolls() {
    if (!settings.liveExpandEnabled) return;
    const nodes = document.querySelectorAll('[data-tool-group-scroll="true"][data-t3-enhancer-live-group="true"]');
    for (const el of nodes) {
      followLiveScroll(el);
    }
  }

  function syncMountedLiveGroupAttrs() {
    const enabled = Boolean(settings.liveExpandEnabled);
    const nodes = document.querySelectorAll('[data-tool-group-scroll="true"]');
    for (const el of nodes) {
      if (!enabled && el.getAttribute('data-t3-enhancer-live-group') === 'true') {
        el.removeAttribute('data-t3-enhancer-live-group');
      }
    }
  }

  function triggerTimelineRefresh() {
    syncMountedLiveGroupAttrs();
    for (const fn of timelineRefreshers) {
      try {
        fn();
      } catch {}
    }
  }

  // ==================== 模块 A：遥测与混合速率引擎 ====================
  const threadTelemetry = new Map();
  let currentThreadKey = '__default__';
  let currentActivity = { isWorking: false, phase: 'idle', runlessWorkStartedAt: null };
  let lastActivityMeta = null;
  let compactHandlerFn = null;
  let compactHandlerDisabled = false;

  function toEpochMs(val) {
    if (val == null) return NaN;
    if (typeof val === 'number') return Number.isFinite(val) ? val : NaN;
    if (typeof val === 'string') return Date.parse(val);
    if (typeof val === 'object') {
      // Effect DateTime.Utc / DateTime.Zoned 使用 epochMilliseconds 字段与 toJSON()
      if (typeof val.epochMilliseconds === 'number' && Number.isFinite(val.epochMilliseconds)) return val.epochMilliseconds;
      if (typeof val.epochMillis === 'number' && Number.isFinite(val.epochMillis)) return val.epochMillis;
      if (typeof val.getTime === 'function') return val.getTime();
      if (typeof val.toJSON === 'function') {
        const j = val.toJSON();
        if (typeof j === 'string') {
          const parsed = Date.parse(j);
          if (Number.isFinite(parsed)) return parsed;
        }
      }
      if (typeof val.toISOString === 'function') return Date.parse(val.toISOString());
      if (typeof val.toString === 'function') {
        const s = val.toString();
        if (s && s !== '[object Object]') {
          const unwrapped = s.replace(/^DateTime\.(?:Utc|Zoned)\((.+)\)$/, '$1');
          return Date.parse(unwrapped);
        }
      }
    }
    return NaN;
  }

  // 合并重叠时间区间，避免并行工具调用被重复累加耗时
  function sumMergedIntervals(intervals) {
    if (!intervals || intervals.length === 0) return 0;
    if (intervals.length === 1) return Math.max(0, intervals[0][1] - intervals[0][0]);
    intervals.sort((a, b) => a[0] - b[0]);
    let total = 0;
    let curStart = intervals[0][0];
    let curEnd = intervals[0][1];
    for (let i = 1; i < intervals.length; i++) {
      const [s, e] = intervals[i];
      if (s <= curEnd) {
        if (e > curEnd) curEnd = e;
      } else {
        total += curEnd - curStart;
        curStart = s;
        curEnd = e;
      }
    }
    total += curEnd - curStart;
    return total;
  }

  function getOrCreateTelemetry(key) {
    const k = key || '__default__';
    let st = threadTelemetry.get(k);
    if (!st) {
      st = {
        contextWindow: null,
        model: null,
        providerInstanceId: null,
        turnCount: null,
        lastKnownMaxTokens: null,
        lastRunsRef: null,
        lastTurnsRef: null,
        lastNodesRef: null,
        lastItemsRef: null,
        agg: null, // 由 providerTurns / nodes / runs / items 聚合出的真实明细
        stepTracker: {
          seen: new Set(),
          samples: [], // [{ turnId, input, cached, output, pct, at }]
          liveByTurn: new Map(), // turnId -> { input, cached, output, lastPct, lastUsage }
        },
        prevOutputTokens: null,
        prevUpdatedAtMs: null,
        exactRate: null,
        exactRateAt: 0,
        estRate: null,
        estRateAt: 0,
        lastSampleNode: null,
        lastSampleTextLen: 0,
        lastSampleAt: 0,
      };
      threadTelemetry.set(k, st);
      if (threadTelemetry.size > 48) {
        const firstKey = threadTelemetry.keys().next().value;
        if (firstKey && firstKey !== k) threadTelemetry.delete(firstKey);
      }
    }
    return st;
  }

  function formatCompact(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    if (abs >= 1_000_000) {
      const v = (n / 1_000_000).toFixed(1).replace(/\\.0$/, '');
      return v + 'M';
    }
    if (abs >= 1_000) {
      const v = (n / 1_000).toFixed(abs >= 100_000 ? 0 : 1).replace(/\\.0$/, '');
      return v + 'K';
    }
    return String(Math.round(n));
  }

  function formatDurationZh(ms) {
    if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—';
    if (ms < 1000) return Math.round(ms) + '毫秒';
    const s = ms / 1000;
    if (s < 60) return s.toFixed(1) + '秒';
    const m = Math.floor(s / 60);
    const rem = Math.round(s % 60);
    return rem > 0 ? m + '分' + rem + '秒' : m + '分';
  }

  function formatCost(cost) {
    if (cost == null) return null;
    if (typeof cost === 'number' && Number.isFinite(cost)) {
      return '$' + (cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3));
    }
    if (typeof cost === 'object') {
      const val = cost.totalUsd ?? cost.usd ?? cost.total ?? cost.amount;
      if (typeof val === 'number' && Number.isFinite(val)) {
        return '$' + (val < 0.01 ? val.toFixed(4) : val.toFixed(3));
      }
    }
    return null;
  }

  function aggregateThreadData(st, meta) {
    if (!meta) return;
    const runs = Array.isArray(meta.runs) ? meta.runs : null;
    const turns = Array.isArray(meta.providerTurns) ? meta.providerTurns : null;
    const nodes = Array.isArray(meta.nodes) ? meta.nodes : null;
    const items = Array.isArray(meta.items) ? meta.items : null;

    if (
      runs === st.lastRunsRef &&
      turns === st.lastTurnsRef &&
      nodes === st.lastNodesRef &&
      items === st.lastItemsRef
    ) {
      return;
    }
    st.lastRunsRef = runs;
    st.lastTurnsRef = turns;
    st.lastNodesRef = nodes;
    st.lastItemsRef = items;

    if (runs) st.turnCount = runs.length;

    let toolSteps = null;
    if (nodes) {
      let count = 0;
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i] && nodes[i].kind === 'tool_call') count++;
      }
      toolSteps = count;
    }

    let hasTurnUsage = false;
    let totalInput = 0;
    let totalCachedRead = 0;
    let totalCacheWrite = 0;
    let totalOutput = 0;
    let totalReasoning = 0;
    let totalTurnDurationMs = 0;
    let lastCompletedAtMs = 0;
    let lastTurnCachedPct = null;
    let latestStepTokenUsage = null;
    let latestStepAtMs = 0;
    let latestTurnTokenUsagePct = null;

    const tracker = st.stepTracker;

    if (turns && turns.length > 0) {
      for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        if (!turn || turn.promptDropped === true) continue;
        const turnId = String(turn.id || ('idx:' + i));
        const sMs = toEpochMs(turn.startedAt);
        const eMs = toEpochMs(turn.completedAt);
        const dur = Number.isFinite(sMs) && Number.isFinite(eMs) && eMs > sMs ? eMs - sMs : 0;
        if (dur > 0) totalTurnDurationMs += dur;
        if (Number.isFinite(eMs) && eMs > lastCompletedAtMs) lastCompletedAtMs = eMs;

        // 1. 捕获步级原生 tokenUsage（Claude / Codex / OpenCode 原生每步更新，Antigravity 由服务端 step-usage-bridge 实时桥接）
        const stepTu = turn.tokenUsage;
        const hasFinalTu =
          turn.turnTokenUsage &&
          typeof turn.turnTokenUsage === 'object' &&
          ((Number.isFinite(turn.turnTokenUsage.inputTokens) && turn.turnTokenUsage.inputTokens > 0) ||
            (Number.isFinite(turn.turnTokenUsage.outputTokens) && turn.turnTokenUsage.outputTokens > 0) ||
            (Number.isFinite(turn.turnTokenUsage.cachedInputTokens) && turn.turnTokenUsage.cachedInputTokens > 0));

        if (stepTu && typeof stepTu === 'object') {
          const stepAt = toEpochMs(stepTu.updatedAt);
          if (Number.isFinite(stepTu.maxTokens) && stepTu.maxTokens > 0) {
            st.lastKnownMaxTokens = stepTu.maxTokens;
          }
          if (!latestStepTokenUsage || (Number.isFinite(stepAt) && stepAt >= latestStepAtMs)) {
            latestStepTokenUsage = stepTu;
            if (Number.isFinite(stepAt)) latestStepAtMs = stepAt;
          }
          const sInp = Number.isFinite(stepTu.inputTokens) ? stepTu.inputTokens : 0;
          const sCached = Number.isFinite(stepTu.cachedInputTokens) ? stepTu.cachedInputTokens : 0;
          const sOut = Number.isFinite(stepTu.outputTokens) ? stepTu.outputTokens : 0;
          if (sInp > 0) {
            const sPct = Math.max(0, Math.min(100, Math.round((sCached / sInp) * 100)));
            latestTurnTokenUsagePct = sPct;
            const dedupKey = turnId + '|' + (stepTu.updatedAt || '') + '|' + sInp + '|' + sCached + '|' + sOut;
            if (!tracker.seen.has(dedupKey)) {
              tracker.seen.add(dedupKey);
              trimSet(tracker.seen, 1024);
              tracker.samples.push({
                turnId,
                input: sInp,
                cached: sCached,
                output: sOut,
                pct: sPct,
                at: Number.isFinite(stepAt) ? stepAt : Date.now(),
              });
              if (tracker.samples.length > 512) tracker.samples.shift();

              if (!hasFinalTu) {
                let live = tracker.liveByTurn.get(turnId);
                if (!live) {
                  live = { input: 0, cached: 0, output: 0, lastPct: sPct };
                  tracker.liveByTurn.set(turnId, live);
                }
                live.input += sInp;
                live.cached += sCached;
                live.output += sOut;
                live.lastPct = sPct;
              }
            }
          }
        }

        // 2. 汇总已完成回合的权威 turnTokenUsage；仍在运行中的回合用步级实时累计值补齐
        if (hasFinalTu) {
          // 回合已结算，清理运行期步级临时累计避免重复计数
          tracker.liveByTurn.delete(turnId);
          const tu = turn.turnTokenUsage;
          const inp = Number.isFinite(tu.inputTokens) ? tu.inputTokens : 0;
          const out = Number.isFinite(tu.outputTokens) ? tu.outputTokens : 0;
          const cRead = Number.isFinite(tu.cachedInputTokens) ? tu.cachedInputTokens : 0;
          const cWrite = Number.isFinite(tu.cacheCreationTokens) ? tu.cacheCreationTokens : 0;
          const reas = Number.isFinite(tu.reasoningTokens) ? tu.reasoningTokens : 0;
          hasTurnUsage = true;
          totalInput += inp;
          totalOutput += out;
          totalCachedRead += cRead;
          totalCacheWrite += cWrite;
          totalReasoning += reas;
          if (inp > 0 && cRead >= 0) {
            lastTurnCachedPct = Math.max(0, Math.min(100, Math.round((cRead / inp) * 100)));
          }
        } else {
          const live = tracker.liveByTurn.get(turnId);
          if (live && (live.input > 0 || live.output > 0)) {
            hasTurnUsage = true;
            totalInput += live.input;
            totalCachedRead += live.cached;
            totalOutput += live.output;
          }
        }
      }
    }

    if (latestStepAtMs > lastCompletedAtMs) {
      lastCompletedAtMs = latestStepAtMs;
    }

    let lastStepCachedPct = latestTurnTokenUsagePct;
    let avgStepCachedPct = null;
    let stepSampleCount = tracker.samples.length;
    if (stepSampleCount > 0) {
      lastStepCachedPct = tracker.samples[stepSampleCount - 1].pct;
      let pctSum = 0;
      for (let i = 0; i < stepSampleCount; i++) {
        pctSum += tracker.samples[i].pct;
      }
      avgStepCachedPct = Math.round(pctSum / stepSampleCount);
    }

    // 收集每轮 run 的开始时间，用于精准计算首字延迟 (TTFT) 及兜底总耗时
    const runStartMap = new Map();
    let totalRunDurationMs = 0;
    if (runs && runs.length > 0) {
      for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        if (!run) continue;
        const sMs = toEpochMs(run.startedAt ?? run.requestedAt ?? run.createdAt);
        const eMs = toEpochMs(run.completedAt);
        if (run.id && Number.isFinite(sMs)) runStartMap.set(run.id, sMs);
        if (Number.isFinite(sMs) && Number.isFinite(eMs) && eMs > sMs) {
          totalRunDurationMs += eMs - sMs;
        }
      }
    }

    // 从 visibleTurnItems 精确拆分「模型用时」「工具调用用时」（区间去重防并行重复计）和「首 token 平均 (TTFT)」
    const modelIntervals = [];
    const toolIntervals = [];
    const firstModelStartByRun = new Map();
    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const raw = items[i];
        const it = raw && raw.item ? raw.item : raw;
        if (!it || !it.type) continue;
        const sMs = toEpochMs(it.startedAt ?? it.createdAt);
        const eMs = toEpochMs(it.completedAt);
        const dur = Number.isFinite(sMs) && Number.isFinite(eMs) && eMs > sMs ? eMs - sMs : 0;

        if (it.type === 'reasoning' || it.type === 'assistant_message') {
          if (dur > 0 && dur < 3600_000) modelIntervals.push([sMs, eMs]);
          if (it.runId && Number.isFinite(sMs)) {
            const prev = firstModelStartByRun.get(it.runId);
            if (prev === undefined || sMs < prev) firstModelStartByRun.set(it.runId, sMs);
          }
        } else if (
          it.type === 'command_execution' ||
          it.type === 'file_change' ||
          it.type === 'file_read' ||
          it.type === 'file_search' ||
          it.type === 'dynamic_tool' ||
          it.type === 'mcp_tool_call' ||
          it.type === 'web_search' ||
          it.type === 'subagent'
        ) {
          if (dur > 0 && dur < 3600_000) toolIntervals.push([sMs, eMs]);
        }
      }
    }
    let modelDurationMs = sumMergedIntervals(modelIntervals);
    const toolDurationMs = sumMergedIntervals(toolIntervals);

    const totalWallMs = totalTurnDurationMs > 0 ? totalTurnDurationMs : totalRunDurationMs;
    if (modelDurationMs === 0 && totalWallMs > 0) {
      modelDurationMs = Math.max(0, totalWallMs - toolDurationMs);
    }

    let ttftSumMs = 0;
    let ttftCount = 0;
    for (const [runId, firstMs] of firstModelStartByRun.entries()) {
      const startMs = runStartMap.get(runId);
      if (Number.isFinite(startMs) && firstMs >= startMs) {
        const diff = firstMs - startMs;
        if (diff >= 50 && diff <= 120_000) {
          ttftSumMs += diff;
          ttftCount++;
        }
      }
    }
    const avgTtftMs = ttftCount > 0 ? ttftSumMs / ttftCount : null;

    // 精确输出速率 (TPS)：总输出（含思考输出） / 模型推理生成用时
    let computedRate = null;
    if (hasTurnUsage && totalOutput > 0 && modelDurationMs >= 400) {
      const rate = totalOutput / (modelDurationMs / 1000);
      if (Number.isFinite(rate) && rate > 0.2 && rate < 5000) {
        computedRate = rate;
      }
    } else if (hasTurnUsage && totalOutput > 0 && totalWallMs >= 400) {
      const rate = totalOutput / (totalWallMs / 1000);
      if (Number.isFinite(rate) && rate > 0.2 && rate < 5000) {
        computedRate = rate;
      }
    }

    const totalUncachedInput = hasTurnUsage
      ? Math.max(0, totalInput - totalCachedRead - totalCacheWrite)
      : null;

    st.agg = {
      toolSteps,
      hasTurnUsage,
      totalInput: hasTurnUsage ? totalInput : null,
      totalCachedRead: hasTurnUsage ? totalCachedRead : null,
      totalCacheWrite: hasTurnUsage ? totalCacheWrite : null,
      totalUncachedInput,
      totalOutput: hasTurnUsage ? totalOutput : null,
      totalReasoning: hasTurnUsage && totalReasoning > 0 ? totalReasoning : null,
      totalTokens: hasTurnUsage ? totalInput + totalOutput : null,
      cachePct: hasTurnUsage && totalInput > 0 ? Math.round((totalCachedRead / totalInput) * 100) : null,
      lastTurnCachedPct,
      lastStepCachedPct,
      avgStepCachedPct,
      stepSampleCount,
      latestStepTokenUsage,
      modelDurationMs: modelDurationMs > 0 ? modelDurationMs : null,
      toolDurationMs: toolDurationMs > 0 ? toolDurationMs : null,
      avgTtftMs,
      totalDurationMs: totalWallMs > 0 ? totalWallMs : null,
      lastCompletedAtMs: lastCompletedAtMs > 0 ? lastCompletedAtMs : null,
      computedRate,
    };

    if (computedRate != null) {
      st.exactRate = computedRate;
      st.exactRateAt = lastCompletedAtMs || Date.now();
    }
  }

  function computeCacheInfo(cw, agg) {
    // 优先使用 providerTurns 聚合出的真实全量明细（覆盖 Antigravity / Claude / Codex），不足时回退 contextWindow
    const cached =
      agg && agg.hasTurnUsage && agg.totalCachedRead != null
        ? agg.totalCachedRead
        : (cw?.cachedInputTokens ?? cw?.lastCachedInputTokens ?? null);
    const cacheWrite = agg && agg.hasTurnUsage ? agg.totalCacheWrite : null;
    const uncachedInput =
      agg && agg.hasTurnUsage && agg.totalUncachedInput != null
        ? agg.totalUncachedInput
        : (() => {
            const totalInput = cw?.inputTokens ?? cw?.lastInputTokens ?? null;
            if (totalInput == null) return null;
            if (cached != null && cached > 0) {
              return totalInput >= cached ? totalInput - cached : totalInput;
            }
            return totalInput;
          })();
    const outputTokens =
      agg && agg.hasTurnUsage && agg.totalOutput != null
        ? agg.totalOutput
        : (cw?.outputTokens ?? cw?.lastOutputTokens ?? null);
    const reasoningTokens =
      agg && agg.hasTurnUsage && agg.totalReasoning != null
        ? agg.totalReasoning
        : (cw?.reasoningOutputTokens ?? cw?.lastReasoningOutputTokens ?? null);

    let pct = agg && agg.hasTurnUsage && agg.cachePct != null ? agg.cachePct : null;
    if (pct === null && cw) {
      const lastCached = cw.lastCachedInputTokens ?? cw.cachedInputTokens ?? null;
      const rawInput = cw.lastInputTokens ?? cw.inputTokens ?? null;
      if (lastCached != null && lastCached > 0) {
        let denom = null;
        if (rawInput != null && rawInput > 0) {
          denom = lastCached > rawInput ? rawInput + lastCached : rawInput;
        } else if (cw.usedTokens > 0) {
          denom = Math.max(cw.usedTokens, lastCached);
        }
        if (denom && denom > 0) {
          pct = Math.max(0, Math.min(100, Math.round((lastCached / denom) * 100)));
        }
      } else if (lastCached === 0 && rawInput != null && rawInput > 0) {
        pct = 0;
      }
    }

    let totalTokens = agg && agg.hasTurnUsage && agg.totalTokens != null ? agg.totalTokens : (cw?.totalProcessedTokens ?? null);
    if (totalTokens == null && cw) {
      const totalInput = cw.inputTokens ?? cw.lastInputTokens ?? null;
      if (totalInput != null || cw.outputTokens != null) {
        const inPart =
          totalInput != null && cached != null && cached > totalInput
            ? totalInput + cached
            : (totalInput ?? 0);
        totalTokens = inPart + (cw.outputTokens ?? 0);
      } else if (Number.isFinite(cw.usedTokens)) {
        totalTokens = cw.usedTokens;
      }
    }

    // 仅当上游显式上报了 promptCacheExpiresAt / promptCacheTtlMs（如 Claude Code 5m/1h）时才计算精确热/冷倒计时；
    // Antigravity 等隐式缓存不返回固定 TTL，避免误导性地显示伪造的 5 分钟倒计时
    let ttlRemainMs = null;
    const now = Date.now();
    const expiresAtMs = cw?.promptCacheExpiresAt ? Date.parse(cw.promptCacheExpiresAt) : NaN;
    const explicitTtlMs = Number.isFinite(cw?.promptCacheTtlMs) && cw.promptCacheTtlMs > 0 ? cw.promptCacheTtlMs : null;
    const updatedAtMs =
      (cw?.updatedAt ? Date.parse(cw.updatedAt) : NaN) ||
      (agg?.lastCompletedAtMs ? agg.lastCompletedAtMs : NaN);

    if (Number.isFinite(expiresAtMs)) {
      ttlRemainMs = expiresAtMs - now;
    } else if (explicitTtlMs !== null && Number.isFinite(updatedAtMs) && ((cached != null && cached > 0) || (cw && cw.usedTokens > 0))) {
      ttlRemainMs = updatedAtMs + explicitTtlMs - now;
    }

    let state = 'idle';
    if (ttlRemainMs !== null) {
      state = ttlRemainMs > 0 ? 'warm' : 'cold';
    } else if (cached != null && cached > 0) {
      state = 'active';
    }

    return { state, pct, cached, cacheWrite, uncachedInput, outputTokens, reasoningTokens, totalTokens, ttlRemainMs };
  }

  function sampleStreamingDelta(st) {
    if (document.visibilityState === 'hidden') return null;
    const nodes = document.querySelectorAll(
      '[data-tool-group-scroll="true"][data-t3-enhancer-live-group="true"], article, [data-message-role="assistant"]'
    );
    if (nodes.length === 0) return null;
    const target = nodes[nodes.length - 1];
    const text = target.textContent || '';
    const len = text.length;

    if (st.lastSampleNode !== target || len < st.lastSampleTextLen) {
      st.lastSampleNode = target;
      st.lastSampleTextLen = len;
      st.lastSampleAt = Date.now();
      return null;
    }

    const dTotal = len - st.lastSampleTextLen;
    if (dTotal <= 0) return null;

    // 仅扫描新增末尾至多 2048 字符估算中英文比例，避免长文本全量遍历
    const scanLen = Math.min(dTotal, 2048);
    const start = len - scanLen;
    let cjk = 0;
    for (let i = start; i < len; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0x4e00 && code <= 0x9fff) cjk++;
    }
    const cjkRatio = cjk / scanLen;
    const estTokens = dTotal * (cjkRatio * 0.65 + (1 - cjkRatio) * 0.25);
    st.lastSampleTextLen = len;
    return { dTotal, estTokens };
  }

  let statusbarEl = null;
  let chipSpeedEl = null;
  let chipUsageEl = null;
  let chipContextEl = null;
  let toggleBtnRef = null;
  let popoverElRef = null;
  let activePopoverKind = null; // 'speed' | 'usage' | 'context' | null
  let activePopoverAnchor = null;

  let lastSpeedHtml = '';
  let lastUsageHtml = '';
  let lastContextHtml = '';
  let lastToggleActive = null;
  let lastPopoverHtml = '';

  let renderQueued = false;
  let streamTimerId = null;
  let ttlTimerId = null;
  let mountObserver = null;

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(() => {
      renderQueued = false;
      renderStatusBar();
    });
  }

  function disconnectMountObserver() {
    if (mountObserver) {
      mountObserver.disconnect();
      mountObserver = null;
    }
  }

  function findStatusBarHost() {
    // 第一优先：原生编辑框下方上下文条（设备 / 工作副本 ··· [状态栏] ··· 分支 / 权限）
    const strips = document.querySelectorAll('[data-slot="composer-context-strip"]');
    for (let i = strips.length - 1; i >= 0; i--) {
      const el = strips[i];
      if (el.offsetParent !== null) return { host: el, layout: 'strip' };
    }
    // 兜底：若当前会话未显示原生上下文条，则挂在编辑框外层父容器末尾（绝不钻入输入框黑框内部）
    const forms = document.querySelectorAll('[data-chat-composer-form="true"]');
    for (let i = forms.length - 1; i >= 0; i--) {
      const el = forms[i];
      if (el.offsetParent !== null && el.parentElement) {
        return { host: el.parentElement, layout: 'fallback' };
      }
    }
    return null;
  }

  function ensureMountObserver() {
    if (mountObserver || !document.body) return;
    mountObserver = new MutationObserver(() => {
      if (findStatusBarHost()) {
        disconnectMountObserver();
        scheduleRender();
      }
    });
    mountObserver.observe(document.body, { childList: true, subtree: true });
  }

  function syncStreamTimer() {
    const shouldRun = Boolean(currentActivity.isWorking && settings.rateMode === 'hybrid');
    if (shouldRun && streamTimerId === null) {
      streamTimerId = window.setInterval(() => {
        const st = getOrCreateTelemetry(currentThreadKey);
        const now = Date.now();
        const prevAt = st.lastSampleAt;
        const delta = sampleStreamingDelta(st);
        if (delta && prevAt > 0 && now - prevAt >= 400 && delta.dTotal < 25000) {
          const dtSec = (now - prevAt) / 1000;
          const instRate = delta.estTokens / dtSec;
          if (instRate > 0.2 && instRate < 1500) {
            st.estRate = st.estRate == null ? instRate : st.estRate * 0.65 + instRate * 0.35;
            st.estRateAt = now;
            scheduleRender();
          }
        }
        if (delta) st.lastSampleAt = now;
      }, 800);
    } else if (!shouldRun && streamTimerId !== null) {
      window.clearInterval(streamTimerId);
      streamTimerId = null;
    }
  }

  function scheduleCacheExpiryRefresh(cache) {
    if (ttlTimerId !== null) {
      window.clearTimeout(ttlTimerId);
      ttlTimerId = null;
    }
    if (cache.state === 'warm' && cache.ttlRemainMs != null && cache.ttlRemainMs > 0 && cache.ttlRemainMs < 3600_000) {
      ttlTimerId = window.setTimeout(() => {
        ttlTimerId = null;
        scheduleRender();
      }, cache.ttlRemainMs + 300);
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  let popoverCloseTimer = null;

  function cancelPopoverClose() {
    if (popoverCloseTimer !== null) {
      window.clearTimeout(popoverCloseTimer);
      popoverCloseTimer = null;
    }
  }

  function ensurePopoverMounted() {
    if (popoverElRef && popoverElRef.isConnected) return popoverElRef;
    if (!document.body) return null;
    const el = document.createElement('div');
    el.className = 't3-enhancer-popover';
    el.setAttribute('data-t3-enhancer-popover', 'true');
    el.setAttribute('data-open', 'false');
    el.addEventListener('mouseenter', () => {
      cancelPopoverClose();
    });
    el.addEventListener('mouseleave', () => {
      schedulePopoverClose(activePopoverKind);
    });
    el.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('[data-action="compact-context"]') : null;
      if (!btn || btn.disabled) return;
      ev.preventDefault();
      ev.stopPropagation();
      forceClosePopover();
      if (typeof compactHandlerFn === 'function') {
        try {
          compactHandlerFn();
        } catch {}
      }
    });
    document.body.appendChild(el);
    popoverElRef = el;
    lastPopoverHtml = '';
    return el;
  }

  function positionPopover(anchorEl) {
    if (!popoverElRef || !anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const popW = 286;
    const left = Math.max(12, Math.min(window.innerWidth - popW - 12, rect.left + rect.width / 2 - popW / 2));
    const bottom = Math.max(12, window.innerHeight - rect.top + 6);
    popoverElRef.style.left = Math.round(left) + 'px';
    popoverElRef.style.bottom = Math.round(bottom) + 'px';
  }

  function forceClosePopover() {
    cancelPopoverClose();
    if (activePopoverAnchor) {
      activePopoverAnchor.removeAttribute('data-hovered');
    }
    activePopoverKind = null;
    activePopoverAnchor = null;
    if (popoverElRef) popoverElRef.setAttribute('data-open', 'false');
  }

  function openPopover(kind, anchorEl) {
    cancelPopoverClose();
    if (activePopoverAnchor && activePopoverAnchor !== anchorEl) {
      activePopoverAnchor.removeAttribute('data-hovered');
    }
    activePopoverKind = kind;
    activePopoverAnchor = anchorEl;
    if (anchorEl) anchorEl.setAttribute('data-hovered', 'true');
    const pop = ensurePopoverMounted();
    renderPopover();
    positionPopover(anchorEl);
    if (pop) pop.setAttribute('data-open', 'true');
  }

  function schedulePopoverClose(kind) {
    cancelPopoverClose();
    popoverCloseTimer = window.setTimeout(() => {
      popoverCloseTimer = null;
      if (activePopoverKind === kind) {
        forceClosePopover();
      }
    }, 180);
  }

  function resolveRateDisplay(st) {
    const now = Date.now();
    const useEstimated =
      settings.rateMode === 'hybrid' &&
      currentActivity.isWorking &&
      st.estRate != null &&
      now - st.estRateAt < 5000 &&
      now - st.exactRateAt > 2000;

    let rateText = '— tok/s';
    let rateCls = '';
    if (useEstimated) {
      rateText = '~' + (st.estRate >= 100 ? Math.round(st.estRate) : st.estRate.toFixed(1)) + ' tok/s';
      rateCls = 't3-enhancer-live-rate';
    } else if (st.exactRate != null && Number.isFinite(st.exactRate) && st.exactRate > 0) {
      rateText = (st.exactRate >= 100 ? Math.round(st.exactRate) : st.exactRate.toFixed(1)) + ' tok/s';
    } else if (settings.rateMode === 'hybrid' && st.estRate != null && st.estRate > 0) {
      rateText = '~' + (st.estRate >= 100 ? Math.round(st.estRate) : st.estRate.toFixed(1)) + ' tok/s';
    }
    return { rateText, rateCls, useEstimated };
  }

  function buildTurnStepText(st, cw) {
    const parts = [];
    if (st.turnCount != null && st.turnCount > 0) parts.push(st.turnCount + ' 轮');
    const steps = st.agg?.toolSteps != null && st.agg.toolSteps > 0 ? st.agg.toolSteps : cw?.toolUses;
    if (steps != null && steps > 0) parts.push(steps + ' 步');
    return parts.join(' ');
  }

  function renderPopover() {
    if (!popoverElRef || !activePopoverKind || !settings.composerStatusEnabled) return;
    const st = getOrCreateTelemetry(currentThreadKey);
    const cw = st.contextWindow;
    const agg = st.agg;
    const cache = computeCacheInfo(cw, agg);
    const { rateText, useEstimated } = resolveRateDisplay(st);

    const row = (k, v, extraCls) =>
      '<div class="t3-enhancer-pop-row"><span class="t3-enhancer-pop-k">' +
      k +
      '</span><span class="t3-enhancer-pop-v ' + (extraCls || '') + '">' +
      escapeHtml(v) +
      '</span></div>';

    let html = '';

    if (activePopoverKind === 'speed') {
      const turnStep = buildTurnStepText(st, cw) || '当前会话';
      const modelDur = agg?.modelDurationMs ?? cw?.durationMs ?? null;
      const toolDur = agg?.toolDurationMs ?? null;
      const ttftMs = agg?.avgTtftMs ?? null;
      html =
        '<div class="t3-enhancer-pop-head">' +
          '<span class="t3-enhancer-pop-head-left">' + ICON_GAUGE + '<span>会话统计</span></span>' +
          '<span class="t3-enhancer-pop-head-val">' + escapeHtml(turnStep) + '</span>' +
        '</div>' +
        '<div class="t3-enhancer-pop-divider"></div>' +
        row('模型用时', formatDurationZh(modelDur)) +
        row('工具调用用时', formatDurationZh(toolDur)) +
        row('首字平均 (TTFT)', formatDurationZh(ttftMs)) +
        row('输出速度 (TPS)', rateText) +
        (st.model ? row('当前模型', st.model) : '');
    } else if (activePopoverKind === 'usage') {
      const totalStr = cache.totalTokens != null ? cache.totalTokens.toLocaleString() : '—';
      const cachePctStr =
        cache.pct !== null
          ? cache.pct + '%' + (cache.state === 'warm' && cache.ttlRemainMs > 0 ? ' (热 ' + formatDurationZh(cache.ttlRemainMs) + ')' : cache.state === 'cold' ? ' (已冷)' : '')
          : cache.state === 'cold'
            ? '已冷'
            : '—';
      const cacheCls = cache.state === 'warm' ? 't3-enhancer-cache-warm' : cache.state === 'cold' ? 't3-enhancer-cache-cold' : '';
      const costStr = formatCost(cw?.cost);
      html =
        '<div class="t3-enhancer-pop-head">' +
          '<span class="t3-enhancer-pop-head-left">' + ICON_DB + '<span>用量统计</span></span>' +
          '<span class="t3-enhancer-pop-head-val">' + escapeHtml(totalStr) + '</span>' +
        '</div>' +
        '<div class="t3-enhancer-pop-divider"></div>' +
        row('累计命中', cachePctStr, cacheCls) +
        (agg?.lastStepCachedPct != null ? row('本步命中', agg.lastStepCachedPct + '%') : '') +
        (agg?.avgStepCachedPct != null && agg.stepSampleCount >= 2 ? row('步均命中', agg.avgStepCachedPct + '% (' + agg.stepSampleCount + '步)') : '') +
        (agg?.lastTurnCachedPct != null ? row('上轮命中', agg.lastTurnCachedPct + '%') : '') +
        row('未缓存输入', cache.uncachedInput != null ? cache.uncachedInput.toLocaleString() : '—') +
        row('缓存读取', cache.cached != null ? cache.cached.toLocaleString() : '—') +
        (cache.cacheWrite != null && cache.cacheWrite > 0 ? row('缓存写入', cache.cacheWrite.toLocaleString()) : '') +
        row('输出', cache.outputTokens != null ? cache.outputTokens.toLocaleString() : '—') +
        (cache.reasoningTokens != null && cache.reasoningTokens > 0 ? row('思考输出', cache.reasoningTokens.toLocaleString()) : '') +
        (costStr ? row('估算费用', costStr) : '');
    } else if (activePopoverKind === 'context') {
      const stepTu = agg?.latestStepTokenUsage ?? null;
      const maxTokens =
        (cw?.maxTokens && cw.maxTokens > 0 ? cw.maxTokens : null) ||
        (stepTu?.maxTokens && stepTu.maxTokens > 0 ? stepTu.maxTokens : null) ||
        (st.lastKnownMaxTokens && st.lastKnownMaxTokens > 0 ? st.lastKnownMaxTokens : null);
      const usedTokens =
        cw && Number.isFinite(cw.usedTokens)
          ? cw.usedTokens
          : (stepTu && Number.isFinite(stepTu.usedTokens) ? stepTu.usedTokens : null);
      const pct = maxTokens && usedTokens != null ? Math.round(cw?.usedPercentage ?? (usedTokens / maxTokens) * 100) : null;
      const rightSummary =
        usedTokens != null
          ? formatCompact(usedTokens) + (maxTokens ? ' / ' + formatCompact(maxTokens) : '')
          : '—';

      // 分段进度条：优先按最新一步缓存命中率（否则最近一轮 / 累计）估算上下文中的缓存占比（柔和紫） + 非缓存已用段（柔和蓝/告警色）
      const segs = [];
      const lastHitPct = agg?.lastStepCachedPct ?? agg?.lastTurnCachedPct ?? cache.pct;
      const cachedInCtxVal =
        usedTokens != null && lastHitPct != null
          ? Math.round((usedTokens * lastHitPct) / 100)
          : (cache.cached != null && usedTokens != null ? Math.min(usedTokens, cache.cached) : null);
      const otherInCtxVal =
        usedTokens != null && cachedInCtxVal != null ? Math.max(0, usedTokens - cachedInCtxVal) : usedTokens;

      if (maxTokens && usedTokens != null && usedTokens > 0) {
        const cachedPct = cachedInCtxVal ? Math.min(100, (cachedInCtxVal / maxTokens) * 100) : 0;
        const otherPct = otherInCtxVal ? Math.min(100 - cachedPct, (otherInCtxVal / maxTokens) * 100) : 0;
        const mainColor = pct >= 90 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#3b82f6';
        if (cachedPct > 0.4) {
          segs.push('<div class="t3-enhancer-pop-bar-seg" style="width:' + cachedPct.toFixed(2) + '%;background:#a78bfa"></div>');
        }
        if (otherPct > 0.4) {
          segs.push('<div class="t3-enhancer-pop-bar-seg" style="width:' + otherPct.toFixed(2) + '%;background:' + mainColor + '"></div>');
        }
      }

      const remainVal = cw?.remainingTokens != null ? cw.remainingTokens : (maxTokens && usedTokens != null ? Math.max(0, maxTokens - usedTokens) : null);
      const canCompact = typeof compactHandlerFn === 'function' && !compactHandlerDisabled && !currentActivity.isWorking;
      const compactBtnLabel = compactHandlerDisabled
        ? '当前不可压缩'
        : currentActivity.isWorking
          ? '运行中暂不可压缩'
          : '压缩上下文';

      html =
        '<div class="t3-enhancer-pop-head">' +
          '<span class="t3-enhancer-pop-head-left"><span>上下文已用 ' + (pct != null ? pct + '%' : '—') + '</span></span>' +
          '<span class="t3-enhancer-pop-head-val">' + escapeHtml(rightSummary) + '</span>' +
        '</div>' +
        '<div class="t3-enhancer-pop-bar">' + segs.join('') + '</div>' +
        (cachedInCtxVal != null && cachedInCtxVal > 0
          ? row('<span class="t3-enhancer-legend-sq" style="background:#a78bfa"></span><span>缓存命中</span>', formatCompact(cachedInCtxVal))
          : '') +
        row('<span class="t3-enhancer-legend-sq" style="background:#3b82f6"></span><span>非缓存上下文</span>', otherInCtxVal != null ? formatCompact(otherInCtxVal) : '—') +
        row('<span class="t3-enhancer-legend-sq" style="background:rgba(156,163,175,0.45)"></span><span>剩余可用</span>', remainVal != null ? formatCompact(remainVal) : '—') +
        (cw?.autoCompactThreshold ? row('自动压缩阈值', formatCompact(cw.autoCompactThreshold)) : '') +
        (typeof compactHandlerFn === 'function'
          ? '<div class="t3-enhancer-pop-divider"></div>' +
            '<button type="button" class="t3-enhancer-pop-btn" data-action="compact-context"' +
            (canCompact ? '' : ' disabled') +
            '>' + ICON_COMPACT + '<span>' + escapeHtml(compactBtnLabel) + '</span></button>'
          : '');
    }

    if (html !== lastPopoverHtml) {
      popoverElRef.innerHTML = html;
      lastPopoverHtml = html;
    }
  }

  function ensureStatusBarMounted() {
    if (!settings.composerStatusEnabled && !settings.showToggleButton) {
      disconnectMountObserver();
      if (statusbarEl && statusbarEl.parentElement) statusbarEl.remove();
      if (popoverElRef && popoverElRef.parentElement) popoverElRef.remove();
      statusbarEl = null;
      popoverElRef = null;
      return null;
    }

    const found = findStatusBarHost();
    if (!found) {
      ensureMountObserver();
      return null;
    }
    disconnectMountObserver();

    if (statusbarEl && statusbarEl.parentElement === found.host && statusbarEl.isConnected) {
      if (statusbarEl.getAttribute('data-layout') !== found.layout) {
        statusbarEl.setAttribute('data-layout', found.layout);
      }
      return statusbarEl;
    }
    if (statusbarEl && statusbarEl.parentElement) statusbarEl.remove();

    const bar = document.createElement('div');
    bar.className = 't3-enhancer-statusbar';
    bar.setAttribute('data-t3-enhancer-statusbar', 'true');
    bar.setAttribute('data-layout', found.layout);

    chipSpeedEl = null;
    chipUsageEl = null;
    chipContextEl = null;
    toggleBtnRef = null;
    lastSpeedHtml = '';
    lastUsageHtml = '';
    lastContextHtml = '';
    lastToggleActive = null;

    if (settings.composerStatusEnabled) {
      const makeChip = (kind, extraCls) => {
        const el = document.createElement('div');
        el.className = 't3-enhancer-chip' + (extraCls ? ' ' + extraCls : '');
        el.setAttribute('data-chip', kind);
        el.setAttribute('data-composer-context-control', 'true');
        el.addEventListener('mouseenter', () => openPopover(kind, el));
        el.addEventListener('mouseleave', () => schedulePopoverClose(kind));
        bar.appendChild(el);
        return el;
      };
      chipSpeedEl = makeChip('speed', 't3-enhancer-hide-sm');
      chipUsageEl = makeChip('usage', '');
      chipContextEl = makeChip('context', '');
    }

    if (settings.showToggleButton) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 't3-enhancer-toggle';
      btn.setAttribute('data-role', 'live-expand-btn');
      btn.setAttribute('data-composer-context-control', 'true');
      btn.title = '切换流式自动展开工作组与最新工具条（固定高度 ' + settings.fixedHeightPx + 'px）';
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        api.toggleLiveExpand();
      });
      bar.appendChild(btn);
      toggleBtnRef = btn;
    }

    found.host.appendChild(bar);
    statusbarEl = bar;
    return bar;
  }

  function renderStatusBar() {
    const bar = ensureStatusBarMounted();
    if (!bar) return;

    const st = getOrCreateTelemetry(currentThreadKey);
    const cw = st.contextWindow;

    if (toggleBtnRef) {
      const on = Boolean(settings.liveExpandEnabled);
      if (lastToggleActive !== on) {
        lastToggleActive = on;
        toggleBtnRef.setAttribute('data-active', on ? 'true' : 'false');
        toggleBtnRef.title = on
          ? '流式自动展开：已开启（固定 ' + settings.fixedHeightPx + 'px，点击关闭）'
          : '流式自动展开：已关闭（点击开启）';
        toggleBtnRef.innerHTML =
          (on ? ICON_EXPAND : ICON_COLLAPSE) +
          '<span>' + (on ? '自动展开' : '自动折叠') + '</span>';
      }
    }

    if (!settings.composerStatusEnabled) return;

    const cache = computeCacheInfo(cw, st.agg);
    scheduleCacheExpiryRefresh(cache);
    const { rateText, rateCls } = resolveRateDisplay(st);

    // 芯片 1：轮数/步数 · 速率 (tok/s)
    if (chipSpeedEl) {
      const turnStep = buildTurnStepText(st, cw);
      const nextSpeedHtml =
        ICON_GAUGE +
        (turnStep ? '<span>' + escapeHtml(turnStep) + '</span><span class="t3-enhancer-sep">·</span>' : '') +
        '<span class="t3-enhancer-num ' + rateCls + '">' + escapeHtml(rateText) + '</span>';
      if (nextSpeedHtml !== lastSpeedHtml) {
        chipSpeedEl.innerHTML = nextSpeedHtml;
        lastSpeedHtml = nextSpeedHtml;
      }
    }

    // 芯片 2：总用量 · 缓存命中率（未上报缓存字段时只显示简洁用量）
    if (chipUsageEl) {
      const totalPart = cache.totalTokens != null ? formatCompact(cache.totalTokens) : '—';
      let cachePart = '';
      if (cache.pct !== null) {
        cachePart = '缓存命中 ' + cache.pct + '%';
      } else if (cache.cached != null && cache.cached > 0) {
        cachePart = '缓存 ' + formatCompact(cache.cached);
      } else if (cache.state === 'cold') {
        cachePart = '缓存已冷';
      }
      const nextUsageHtml =
        ICON_DB +
        '<span class="t3-enhancer-num">' + escapeHtml(totalPart) + '</span>' +
        (cachePart ? '<span class="t3-enhancer-sep">·</span><span>' + escapeHtml(cachePart) + '</span>' : '');
      if (nextUsageHtml !== lastUsageHtml) {
        chipUsageEl.innerHTML = nextUsageHtml;
        lastUsageHtml = nextUsageHtml;
      }
    }

    // 芯片 3：上下文占用圆环 + 百分比（cw 缺失 usedTokens 时回退至最新一步 tokenUsage）
    if (chipContextEl) {
      const stepTu = st.agg?.latestStepTokenUsage ?? null;
      const effMax =
        (cw?.maxTokens && cw.maxTokens > 0 ? cw.maxTokens : null) ||
        (stepTu?.maxTokens && stepTu.maxTokens > 0 ? stepTu.maxTokens : null) ||
        (st.lastKnownMaxTokens && st.lastKnownMaxTokens > 0 ? st.lastKnownMaxTokens : null);
      const effUsed =
        cw && Number.isFinite(cw.usedTokens)
          ? cw.usedTokens
          : (stepTu && Number.isFinite(stepTu.usedTokens) ? stepTu.usedTokens : null);
      let pct = null;
      let tone = '';
      if (effUsed != null && effMax && effMax > 0) {
        pct = Math.round(cw?.usedPercentage ?? (effUsed / effMax) * 100);
        if (pct >= 90) tone = 'danger';
        else if (pct >= 80) tone = 'warn';
      }
      const pctCls = tone === 'danger' ? 't3-enhancer-tone-danger' : tone === 'warn' ? 't3-enhancer-tone-warn' : '';
      const nextContextHtml =
        buildRingSvg(pct, tone) +
        '<span class="t3-enhancer-num ' + pctCls + '">' + (pct != null ? pct + '%' : '—%') + '</span>';
      if (nextContextHtml !== lastContextHtml) {
        chipContextEl.innerHTML = nextContextHtml;
        lastContextHtml = nextContextHtml;
      }
    }

    if (activePopoverKind && activePopoverAnchor) {
      renderPopover();
    }
  }

  function bootstrapMount() {
    scheduleRender();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduleRender();
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapMount, { once: true });
  } else {
    bootstrapMount();
  }

  const api = {
    __version: 1,
    getSettings() {
      return { ...settings };
    },
    setSetting(key, value) {
      settings[key] = value;
      persistSettings();
      syncStreamTimer();
      triggerTimelineRefresh();
      scheduleRender();
    },
    isLiveExpandEnabled() {
      return Boolean(settings.liveExpandEnabled);
    },
    toggleLiveExpand() {
      settings.liveExpandEnabled = !settings.liveExpandEnabled;
      persistSettings();
      triggerTimelineRefresh();
      scheduleRender();
      return settings.liveExpandEnabled;
    },
    resolveLiveExpanded(groupId, nativeExpanded) {
      if (groupId) {
        activeGroupIds.add(groupId);
        trimSet(activeGroupIds, 64);
      }
      if (!settings.liveExpandEnabled) return Boolean(nativeExpanded);
      return !manuallyCollapsedGroups.has(groupId);
    },
    isLiveGroup(groupId) {
      return Boolean(groupId && activeGroupIds.has(groupId));
    },
    isLiveAnchor(anchorKey) {
      if (!anchorKey || typeof anchorKey !== 'string') return false;
      if (anchorKey.endsWith(':details')) {
        return activeGroupIds.has(anchorKey.slice(0, -':details'.length));
      }
      return activeGroupIds.has(anchorKey);
    },
    toggleLiveGroup(groupId, nativeHasExpanded) {
      if (!groupId) return;
      if (settings.liveExpandEnabled && activeGroupIds.has(groupId)) {
        if (manuallyCollapsedGroups.has(groupId)) {
          manuallyCollapsedGroups.delete(groupId);
        } else {
          manuallyCollapsedGroups.add(groupId);
          trimSet(manuallyCollapsedGroups, 64);
        }
      } else if (nativeHasExpanded) {
        manuallyCollapsedGroups.add(groupId);
        trimSet(manuallyCollapsedGroups, 64);
      } else {
        manuallyCollapsedGroups.delete(groupId);
      }
    },
    syncLiveEntries(anchorKey, entries, expandedEntriesSet) {
      if (!settings.liveExpandEnabled || !api.isLiveAnchor(anchorKey)) return;
      if (!Array.isArray(entries) || entries.length === 0 || !expandedEntriesSet) return;

      const latest = entries[entries.length - 1];
      const latestId = latest && latest.id;
      if (!latestId) return;

      if (settings.onlyLatestEntry) {
        for (let i = 0; i < entries.length - 1; i++) {
          const oldId = entries[i] && entries[i].id;
          if (!oldId) continue;
          if (manualEntryStates.get(oldId) !== true && autoExpandedEntries.has(oldId)) {
            autoExpandedEntries.delete(oldId);
            if (expandedEntriesSet.has(oldId)) {
              expandedEntriesSet.delete(oldId);
              notifyEntryListeners(oldId, false);
            }
          }
        }
      }

      if (manualEntryStates.get(latestId) !== false) {
        autoExpandedEntries.add(latestId);
        trimSet(autoExpandedEntries, 128);
        if (!expandedEntriesSet.has(latestId)) {
          expandedEntriesSet.add(latestId);
          notifyEntryListeners(latestId, true);
        }
      }
    },
    onManualEntryToggle(entryId, nextExpanded) {
      if (!entryId) return;
      manualEntryStates.set(entryId, Boolean(nextExpanded));
      trimMap(manualEntryStates, 128);
      autoExpandedEntries.delete(entryId);
    },
    subscribeEntryState(entryId, setter) {
      if (!entryId || typeof setter !== 'function') return () => {};
      let set = entryListeners.get(entryId);
      if (!set) {
        set = new Set();
        entryListeners.set(entryId, set);
      }
      set.add(setter);
      return () => {
        set.delete(setter);
        if (set.size === 0) entryListeners.delete(entryId);
      };
    },
    registerTimelineRefresher(fn) {
      if (typeof fn !== 'function') return () => {};
      timelineRefreshers.add(fn);
      return () => {
        timelineRefreshers.delete(fn);
      };
    },
    followLiveScroll(el) {
      followLiveScroll(el);
    },
    renderInlineDiff(jsxRuntime, item) {
      if (!jsxRuntime || !jsxRuntime.jsx || !item) return null;
      const MAX_LINES = 240;
      const rawDiff = typeof item.diffStr === 'string' ? item.diffStr.replace(/\\r\\n/g, '\\n') : '';
      const lines = [];

      if (rawDiff.trim()) {
        const rawLines = rawDiff.split('\\n');
        for (let i = 0; i < rawLines.length; i++) {
          const line = rawLines[i];
          // 过滤冗长的文件头元信息，直接聚焦变更区块与代码行
          if (
            line.startsWith('diff --git ') ||
            line.startsWith('index ') ||
            line.startsWith('--- ') ||
            line.startsWith('+++ ') ||
            line.startsWith('new file mode ') ||
            line.startsWith('deleted file mode ')
          ) {
            continue;
          }
          let kind = 'ctx';
          if (line.startsWith('@@')) kind = 'hunk';
          else if (line.startsWith('+')) kind = 'add';
          else if (line.startsWith('-')) kind = 'del';
          lines.push({ kind, text: line });
        }
      } else {
        if (typeof item.oldStr === 'string' && item.oldStr.length > 0) {
          const oldLines = item.oldStr.replace(/\\r\\n/g, '\\n').split('\\n');
          for (let i = 0; i < oldLines.length; i++) {
            lines.push({ kind: 'del', text: '-' + oldLines[i] });
          }
        }
        if (typeof item.newStr === 'string' && item.newStr.length > 0) {
          const newLines = item.newStr.replace(/\\r\\n/g, '\\n').split('\\n');
          for (let i = 0; i < newLines.length; i++) {
            lines.push({ kind: 'add', text: '+' + newLines[i] });
          }
        }
      }

      if (lines.length === 0) return null;
      const truncated = lines.length > MAX_LINES;
      const shown = truncated ? lines.slice(0, MAX_LINES) : lines;
      const children = shown.map((entry, idx) =>
        jsxRuntime.jsx(
          'span',
          {
            className: 't3-enhancer-diff-line',
            'data-kind': entry.kind,
            children: entry.text || ' ',
          },
          String(idx)
        )
      );
      if (truncated) {
        children.push(
          jsxRuntime.jsx(
            'div',
            {
              className: 't3-enhancer-diff-more',
              children: '… 其余 ' + (lines.length - MAX_LINES) + ' 行已省略，点击上方「打开差异」查看完整对比',
            },
            'more'
          )
        );
      }
      return jsxRuntime.jsx('div', {
        className: 't3-enhancer-inline-diff',
        children,
      });
    },
    registerCompactHandler(fn, disabled) {
      compactHandlerFn = typeof fn === 'function' ? fn : null;
      compactHandlerDisabled = Boolean(disabled);
    },
    _debugTelemetry(key) {
      const st = threadTelemetry.get(key || currentThreadKey);
      return st ? { agg: st.agg, exactRate: st.exactRate, model: st.model } : null;
    },
    reportThread(threadKey) {
      if (!threadKey || threadKey === currentThreadKey) return;
      currentThreadKey = threadKey;
      const st = getOrCreateTelemetry(currentThreadKey);
      st.lastSampleNode = null;
      st.lastSampleAt = 0;
      st.lastSampleTextLen = 0;
      if (lastActivityMeta) aggregateThreadData(st, lastActivityMeta);
      scheduleRender();
    },
    reportActivity(activityResult, meta) {
      const wasWorking = currentActivity.isWorking;
      const isWorking = Boolean(
        activityResult &&
          (activityResult.isWorking ||
            activityResult.showWorkingIndicator ||
            activityResult.phase === 'running' ||
            meta?.phase === 'running' ||
            meta?.isSendBusy)
      );
      currentActivity = {
        isWorking,
        phase: meta?.phase || (isWorking ? 'running' : 'idle'),
        runlessWorkStartedAt: meta?.runlessWorkStartedAt ?? null,
      };
      if (meta) lastActivityMeta = meta;
      const targetKey =
        meta && meta.threadId && (currentThreadKey === '__default__' || currentThreadKey.endsWith(String(meta.threadId)))
          ? currentThreadKey
          : (meta && meta.threadId ? String(meta.threadId) : currentThreadKey);
      if (meta && meta.threadId && currentThreadKey === '__default__') {
        currentThreadKey = String(meta.threadId);
      }
      const st = getOrCreateTelemetry(targetKey);
      aggregateThreadData(st, meta);
      if (isWorking && !wasWorking) {
        st.lastSampleNode = null;
        st.lastSampleAt = 0;
        st.lastSampleTextLen = 0;
        st.estRate = null;
      } else if (!isWorking && wasWorking && settings.rateMode === 'hybrid') {
        // 回合刚结束时补采一次尾段文本增量，避免短回复来不及命中 800ms 采样周期
        const now = Date.now();
        const prevAt = st.lastSampleAt;
        const delta = sampleStreamingDelta(st);
        if (delta && prevAt > 0 && now - prevAt >= 180 && delta.dTotal < 25000) {
          const instRate = delta.estTokens / ((now - prevAt) / 1000);
          if (instRate > 0.2 && instRate < 1500) {
            st.estRate = st.estRate == null ? instRate : st.estRate * 0.65 + instRate * 0.35;
            st.estRateAt = now;
          }
        }
      }
      syncStreamTimer();
      scheduleRender();
      return activityResult;
    },
    reportUsage(payload) {
      if (!payload || typeof payload !== 'object') return;
      const switched = Boolean(payload.threadKey && payload.threadKey !== currentThreadKey);
      if (payload.threadKey) currentThreadKey = payload.threadKey;
      const st = getOrCreateTelemetry(currentThreadKey);
      if (switched && lastActivityMeta) {
        aggregateThreadData(st, lastActivityMeta);
      }
      const cw = payload.contextWindow ?? null;
      st.contextWindow = cw;
      if (cw && Number.isFinite(cw.maxTokens) && cw.maxTokens > 0) {
        st.lastKnownMaxTokens = cw.maxTokens;
      }
      if (payload.model !== undefined) st.model = payload.model;
      if (payload.providerInstanceId !== undefined) st.providerInstanceId = payload.providerInstanceId;

      const now = Date.now();
      if (cw) {
        const updatedMs = cw.updatedAt ? Date.parse(cw.updatedAt) : now;
        if (cw.lastOutputTokens > 0 && cw.durationMs > 0) {
          const rate = cw.lastOutputTokens / (cw.durationMs / 1000);
          if (Number.isFinite(rate) && rate > 0 && rate < 5000) {
            st.exactRate = rate;
            st.exactRateAt = now;
          }
        } else if (
          cw.outputTokens != null &&
          st.prevOutputTokens != null &&
          cw.outputTokens > st.prevOutputTokens &&
          st.prevUpdatedAtMs != null
        ) {
          const dtMs = Math.max(updatedMs - st.prevUpdatedAtMs, 0);
          if (dtMs >= 300 && dtMs <= 120_000) {
            const rate = (cw.outputTokens - st.prevOutputTokens) / (dtMs / 1000);
            if (Number.isFinite(rate) && rate > 0 && rate < 5000) {
              st.exactRate = rate;
              st.exactRateAt = now;
            }
          }
        }
        if (cw.outputTokens != null) {
          if (st.prevOutputTokens !== cw.outputTokens) {
            st.prevOutputTokens = cw.outputTokens;
            st.prevUpdatedAtMs = Number.isFinite(updatedMs) ? updatedMs : now;
          }
        }
      }
      scheduleRender();
    },
  };

  window.__t3Enhancer = api;
})();
`.trim();

  return `${MARKER_BEGIN}
    <style id="t3-enhancer-styles">
${css}
    </style>
    <script id="t3-enhancer-runtime">
${runtimeJs}
    </script>
    ${MARKER_END}`;
}

export function apply(ctx) {
  const relPath = 'apps/server/dist/client/index.html';
  let html = ctx.readText(relPath);

  // 幂等清理旧注入块
  const existingRe = new RegExp(
    `[\\t ]*${MARKER_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r?\\n?`,
    'g'
  );
  html = html.replace(existingRe, '');

  const headCloseIdx = html.lastIndexOf('</head>');
  if (headCloseIdx < 0) {
    throw new Error('未在 index.html 中找到 </head> 锚点');
  }

  const block = buildInjectedBlock(ctx.config);
  const patched = `${html.slice(0, headCloseIdx)}${block}\n  ${html.slice(headCloseIdx)}`;
  ctx.writeText(relPath, patched);

  return {
    file: relPath,
    summary: `已注入运行时与样式 (${block.length} bytes)`,
  };
}
