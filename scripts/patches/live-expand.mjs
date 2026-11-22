/**
 * 模块 B：对话流式工作组与最新思考/工具调用自动展开 + 固定高度视口
 * 设计原则：
 *  - Hash 无关：按语义特征动态扫描 ReadOnlyThreadTimeline chunk
 *  - 变量名无关：全部通过正则动态捕获压缩局部变量名，绝不写死短变量名
 *  - React Compiler 安全：不修改 Q.c(N) 槽位数量与依赖索引
 */

export const id = 'live-expand';
export const description = '流式工作组与最新条目自动展开、固定高度滚动视口与 TTL 透传';
export const featureKey = 'liveExpand';
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
  // 动态定位包含工作组展开与工具滚动列表的 Timeline chunk
  const candidates = ctx.findAssetJs(() => true).filter((f) => {
    const txt = ctx.readText(f.path);
    return (
      txt.includes('expandedWorkGroupIds') &&
      txt.includes('work-live') &&
      txt.includes('isExpandedToolGroup') &&
      txt.includes('data-tool-group-scroll')
    );
  });

  if (candidates.length !== 1) {
    throw new Error(
      `无法唯一定位 Timeline chunk（期望 1 个，找到 ${candidates.length} 个）`
    );
  }

  const targetPath = candidates[0].path;
  let code = ctx.readText(targetPath);

  if (code.includes('__t3Enhancer?.resolveLiveExpanded')) {
    return { file: targetPath, skipped: true, summary: '已打过 live-expand 补丁' };
  }

  // B1-1：活跃末尾工作组 work-live 的 expanded 判定
  code = replaceOnce(
    code,
    /(kind:`work-live`,id:[^,]+,createdAt:[^,]+,entry:[^,]+,groupedEntries:[^,]+,groupId:([$\w]+),expanded:)([$\w]+\.expandedWorkGroupIds\?\.has\(\2\)\?\?!1)/g,
    (_, prefix, groupVar, nativeExpr) =>
      `${prefix}(window.__t3Enhancer?.resolveLiveExpanded?.(${groupVar},${nativeExpr})??(${nativeExpr}))`,
    'B1-1(work-live tail)'
  );

  // B1-2：进行中内联工作组 work-live 的 expanded 判定
  code = replaceOnce(
    code,
    /(let ([$\w]+)=[$\w]+\([$\w]+\.id\),([$\w]+)=)([$\w]+\.expandedWorkGroupIds\?\.has\(\2\)\?\?!1)(,[$\w]+=[$\w]+\.at\(-1\);[$\w]+\.push\(\{kind:`work-live`)/g,
    (_, p1, groupVar, _expVar, nativeExpr, p2) =>
      `${p1}(window.__t3Enhancer?.resolveLiveExpanded?.(${groupVar},${nativeExpr})??(${nativeExpr}))${p2}`,
    'B1-2(work-live inline)'
  );

  // B2：活跃思考组 thinking 的 expanded 判定
  code = replaceOnce(
    code,
    /(let ([$\w]+)=[$\w]+\([$\w]+\.id\),([$\w]+)=)([$\w]+\.expandedWorkGroupIds\?\.has\(\2\)\?\?!1)(,[$\w]+=[$\w]+\.map\([^)]+\);[$\w]+\.push\(\{kind:`thinking`)/g,
    (_, p1, groupVar, _expVar, nativeExpr, p2) =>
      `${p1}(window.__t3Enhancer?.resolveLiveExpanded?.(${groupVar},${nativeExpr})??(${nativeExpr}))${p2}`,
    'B2(thinking live)'
  );

  // B3-1：工作组点击切换时记录用户手动折叠态
  code = replaceOnce(
    code,
    /(:details`\}\),)([$\w]+)\(([$\w]+)=>\{let ([$\w]+)=new Set\(\3\);return \4\.has\(([$\w]+)\)\?\4\.delete\(\5\):\4\.add\(\5\),\4\}\)/g,
    (_, prefix, setterVar, prevVar, setVar, idVar) =>
      `${prefix}${setterVar}(${prevVar}=>{let ${setVar}=new Set(${prevVar});return window.__t3Enhancer?.toggleLiveGroup?.(${idVar},${setVar}.has(${idVar})),${setVar}.has(${idVar})?${setVar}.delete(${idVar}):${setVar}.add(${idVar}),${setVar}})`,
    'B3-1(onToggleWorkGroup)'
  );

  // B3-2：注册底栏一键开关即时刷新器（点击开关立即重算 Timeline 活跃组展开态）
  code = replaceOnce(
    code,
    /(rememberedPosition\?\.disclosures\?\.workGroups\?\?new Set[^;]+;let\[([$\w]+),([$\w]+)\]=\(0,([$\w]+)\.useState\)\(([$\w]+)\)),([$\w]+);/g,
    (_, prefix, _stateVar, setterVar, reactVar, _initVar, nextVar) =>
      `${prefix};(0,${reactVar}.useEffect)(()=>window.__t3Enhancer?.registerTimelineRefresher?.(()=>${setterVar}(__prev=>new Set(__prev))),[]);let ${nextVar};`,
    'B3-2(registerTimelineRefresher)'
  );

  // B4：在展开工作组列表组件（Jh）内动态提取变量名，绝不硬编码压缩标识符
  const jhHeaderMatch = code.match(
    /\{anchorKey:([$\w]+),disclosureAnchorKey:[$\w]+,entries:([$\w]+),groupedEntries:[$\w]+,workspaceRoot:[$\w]+\}=[$\w]+,\{workGroupViewState:([$\w]+),onToggleWorkEntry:/
  );
  if (!jhHeaderMatch) {
    throw new Error('锚点 B4-0(Jh 变量提取) 未匹配');
  }
  const [, jhAnchorVar, jhEntriesVar, jhViewStateVar] = jhHeaderMatch;

  // B4-1：活跃组启用流式自动滚底（follow）并同步最新条目自动展开
  code = replaceOnce(
    code,
    /(let\[([$\w]+),([$\w]+)\]=\(0,([$\w]+)\.useState\)\(([$\w]+)\);\2\.entries!==([$\w]+)&&\3\(\{entries:\6,follow:)(([$\w]+)\.viewportHeight>0&&[$\w]+\(\2\.entries,\6,\8\.bottom\?1\/0:0\))(\}\);)/g,
    (_, p1, _stateVar, _setStateVar, _reactVar, _initVar, entriesVar, followExpr, scrollVar, p2) =>
      `${p1}(window.__t3Enhancer?.isLiveAnchor?.(${jhAnchorVar})&&window.__t3Enhancer?.isLiveExpandEnabled?.()?!${scrollVar}.bottom:(${followExpr}))${p2}window.__t3Enhancer?.syncLiveEntries?.(${jhAnchorVar},${entriesVar},${jhViewStateVar}.expandedEntries);`,
    'B4-1(Jh live follow & syncLiveEntries)'
  );

  // B4-2：给滚动容器附加 data-t3-enhancer-live-group="true" 属性，命中 260px 固定高度样式
  code = replaceOnce(
    code,
    /("data-tool-group-scroll":!0)/g,
    (_, attr) =>
      `${attr},"data-t3-enhancer-live-group":window.__t3Enhancer?.isLiveAnchor?.(${jhAnchorVar})&&window.__t3Enhancer?.isLiveExpandEnabled?.()?\`true\`:void 0`,
    'B4-2(Jh live group attribute)'
  );

  // B4-3：在 Jh 原生布局/尺寸变化回调（ResizeObserver 触发）中接入自动滚底跟随，联动单条命令详情框与分组滚底
  code = replaceOnce(
    code,
    /(let ([$\w]+)=([$\w]+)\.current\?\.getScrollableNode\(\);if\(!\2\)return;)(let [$\w]+=\2\.scrollHeight-\2\.clientHeight-\2\.scrollTop)/g,
    (_, prefix, elVar, _refVar, rest) =>
      `${prefix}window.__t3Enhancer?.followLiveScroll?.(${elVar});${rest}`,
    'B4-3(Jh resize/layout live auto-scroll)'
  );

  // B4-4：在单条命令/思考详情容器组件 wu 中注入语义标记与 panel 流式跟底，使每条命令在自身 260px 视口内滚动而不遮挡前面命令
  code = replaceOnce(
    code,
    /(\{children:[$\w]+,kind:[$\w]+,followLive:([$\w]+)\}=[$\w]+,([$\w]+)=[$\w]+===void 0\?`text`:[$\w]+,([$\w]+)=)(\2!==void 0&&\2)(,[$\w]+=\(0,[$\w]+\.useRef\)\(null\),[$\w]+=\(0,[$\w]+\.useRef\)\(!0\))/g,
    (_, p1, _flVar, kindVar, _oVar, origCond, p2) =>
      `${p1}((${origCond})||(${kindVar}===\`panel\`&&window.__t3Enhancer?.isLiveExpandEnabled?.()===!0))${p2}`,
    'B4-4a(wu panel followLive)'
  );

  code = replaceOnce(
    code,
    /(let ([$\w]+)=([$\w]+)===\`text\`\?`ms-7 flex max-h-96[^`]+`:[$\w]+===\`panel\`\?`mt-0\.5 mb-1\.5 pb-2`:`mt-1`[^;]+;[\s\S]{0,180}?\(0,[$\w]+\.jsx\)\(`div`,\{ref:[$\w]+,onScroll:[$\w]+,className:[$\w]+)(,onClick:)/g,
    (_, prefix, _dVar, kindVar, suffix) =>
      `${prefix},"data-t3-enhancer-entry-panel":${kindVar}${suffix}`,
    'B4-4b(wu entry panel data attr)'
  );

  // B5-1：单条目组件（zh）订阅最新条目切换同步（微任务更新，并妥善衔接后续 comma-let 声明）
  code = replaceOnce(
    code,
    /((?:[$\w]+)\?\.\s*state\.expandedEntries\.has\(([$\w]+)\.id\)\?\?!1[^;]+;let\[([$\w]+),([$\w]+)\]=\(0,([$\w]+)\.useState\)\(([$\w]+)\))(,|;)/g,
    (_, stmt, entryVar, _expState, setExpFn, reactVar, _initVar, sep) =>
      sep === ','
        ? `${stmt};(0,${reactVar}.useEffect)(()=>window.__t3Enhancer?.subscribeEntryState?.(${entryVar}.id,${setExpFn}),[${entryVar}.id]);let `
        : `${stmt};(0,${reactVar}.useEffect)(()=>window.__t3Enhancer?.subscribeEntryState?.(${entryVar}.id,${setExpFn}),[${entryVar}.id]);`,
    'B5-1(zh subscribeEntryState)'
  );

  // B5-2：单条目手动点击切换记录，确保用户手动操作优先于自动收起/展开
  code = replaceOnce(
    code,
    /(([$\w]+)\.onToggleEntry\(!([$\w]+),([$\w]+)\.id\),\3\?\2\.state\.expandedEntries\.add\(\4\.id\):\2\.state\.expandedEntries\.delete\(\4\.id\))/g,
    (match, _full, _ctxVar, nextVar, entryVar) =>
      `(window.__t3Enhancer?.onManualEntryToggle?.(${entryVar}.id,${nextVar}),${match})`,
    'B5-2(zh manual toggle override)'
  );

  // B6：在 dx() 构建 contextWindow 时透传 promptCacheTtlMs 与 promptCacheExpiresAt，供模块 A 计算热/冷缓存
  code = replaceOnce(
    code,
    /(cachedInputTokens:([$\w]+)\.cachedInputTokens\?\?null,outputTokens:\2\.outputTokens\?\?null)/g,
    (match, _full, tokenVar) =>
      `${match},promptCacheTtlMs:${tokenVar}.promptCacheTtlMs??null,promptCacheExpiresAt:${tokenVar}.promptCacheExpiresAt??null`,
    'B6(dx cache TTL passthrough)'
  );

  // B7-1：在详情加载器 Pm 中允许 file_change 自动按需加载完整 diffStr / oldStr / newStr / additions / deletions
  code = replaceOnce(
    code,
    /(,([$\w]+)=([$\w]+)\.item,([$\w]+);[$\w]+\[0\]!==([$\w]+)\|\|[$\w]+\[1\]!==\2\?\(\4=!\5&&)([$\w]+\(\2\))(,)/g,
    (_, p1, itemVar, _eVar, _cVar, _aVar, checkCall, p2) =>
      `${p1}(${checkCall}||${itemVar}.type===\`file_change\`)${p2}`,
    'B7-1(Pm load file_change detail)'
  );

  // B7-2：在 file_change 详情区直接内联渲染红绿 Diff（不再仅限于 failed 状态）
  code = replaceOnce(
    code,
    /(([$\w]+)\.status===`failed`&&\2\.diffStr\?\.trim\(\)\?\(0,([$\w]+)\.jsx\)\(([$\w]+),\{value:\2\.diffStr\}\):null)/g,
    (_, _full, itemVar, jsxVar, fallbackComp) =>
      `((${itemVar}.diffStr?.trim()||${itemVar}.oldStr!==void 0||${itemVar}.newStr!==void 0)?(window.__t3Enhancer?.renderInlineDiff?.(${jsxVar},${itemVar})??(0,${jsxVar}.jsx)(${fallbackComp},{value:${itemVar}.diffStr??\`\` })):null)`,
    'B7-2(file_change inline diff renderer)'
  );

  ctx.writeText(targetPath, code);
  return {
    file: targetPath,
    summary: `已修补 ${targetPath.split('/').pop()}（变量动态捕获: anchor=${jhAnchorVar}, entries=${jhEntriesVar}, state=${jhViewStateVar}）`,
  };
}
