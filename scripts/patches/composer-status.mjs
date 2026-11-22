/**
 * 模块 A：主编辑框下方状态栏遥测数据桥接
 * 设计原则：
 *  - 极简单点注入，绝不向 _chat 巨型组件内部插入 JSX 或修改 React Compiler t[N] 槽位
 *  - 所有视觉渲染由 head-runtime 中的独立轻量 DOM 状态栏完成，最大化跨版本抗脆弱能力
 */

export const id = 'composer-status';
export const description = '桥接当前线程 contextWindow、模型与运行态至底部遥测状态栏';
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
  const candidates = ctx.findAssetJs(() => true).filter((f) => {
    const txt = ctx.readText(f.path);
    return (
      txt.includes('data-chat-composer-footer') &&
      txt.includes('contextWindow') &&
      txt.includes('usageLimitSources')
    );
  });

  if (candidates.length !== 1) {
    throw new Error(
      `无法唯一定位 _chat chunk（期望 1 个，找到 ${candidates.length} 个）`
    );
  }

  const targetPath = candidates[0].path;
  let code = ctx.readText(targetPath);

  if (code.includes('__t3Enhancer?.reportUsage')) {
    return { file: targetPath, skipped: true, summary: '已打过 composer-status 补丁' };
  }

  // A1：在 usage 对象构造处同步 contextWindow / model / providerInstanceId / threadKey
  code = replaceOnce(
    code,
    /(usage:\{providerInstanceId:([$\w]+),model:([$\w]+),providers:[$\w]+,sources:[^,]+,contextWindow:)([$\w]+)(\}\}\),\(0,[$\w]+\.jsx\)\([$\w]+,\{threadKey:([$\w]+),)/g,
    (_, p1, providerVar, modelVar, cwVar, p2, threadKeyVar) =>
      `${p1}(window.__t3Enhancer?.reportUsage?.({threadKey:${threadKeyVar},providerInstanceId:${providerVar},model:${modelVar},contextWindow:${cwVar}}),${cwVar})${p2}`,
    'A1(usage contextWindow bridge)'
  );

  // A2：在会话活跃运行态计算处同步 isWorking / phase / 线程 id、runs、providerTurns、nodes 与 visibleTurnItems（供精确计算模型用时、工具用时、TTFT 与步级实时缓存命中）
  code = replaceOnce(
    code,
    /(run:([$\w]+)\?\.runs\.find\([^)]+\),messages:\2\?\.messages\}\),[$\w]+)(=)([$\w]+)\(\{phase:([$\w]+),isSendBusy:([$\w]+),isCompacting:([$\w]+),runlessWorkStartedAt:([$\w]+)\}\)(,[$\w]+=[$\w]+\(([$\w]+)\?\?\[\],)/g,
    (_, prefix, threadObjVar, eq, fnVar, phaseVar, busyVar, compactVar, startedVar, tail, itemsVar) =>
      `${prefix}${eq}(__r=>(window.__t3Enhancer?.reportActivity?.(__r,{threadId:${threadObjVar}?.id,phase:${phaseVar},isSendBusy:${busyVar},isCompacting:${compactVar},runlessWorkStartedAt:${startedVar},runs:${threadObjVar}?.runs,providerTurns:${threadObjVar}?.providerTurns,nodes:${threadObjVar}?.nodes,items:${itemsVar}}),__r))(${fnVar}({phase:${phaseVar},isSendBusy:${busyVar},isCompacting:${compactVar},runlessWorkStartedAt:${startedVar}}))${tail}`,
    'A2(activity state & thread turns/nodes/items bridge)'
  );

  // A3：注册原生 /compact 压缩上下文触发函数供底部「上下文已用」弹窗按钮调用
  code = replaceOnce(
    code,
    /([$\w]+)=\(\)=>\{([$\w]+)\|\|([$\w]+)\(`\/compact`,([$\w]+)\(`Failed to compact context\.`\)\)\}/g,
    (_, fnName, disabledVar, sendCmdVar, tVar) =>
      `${fnName}=(__fn=>(window.__t3Enhancer?.registerCompactHandler?.(__fn,${disabledVar}),__fn))(()=>{${disabledVar}||${sendCmdVar}(\`/compact\`,${tVar}(\`Failed to compact context.\`))})`,
    'A3(native /compact handler bridge)'
  );

  ctx.writeText(targetPath, code);
  return {
    file: targetPath,
    summary: `已修补 ${targetPath.split('/').pop()}（单点数据桥接，零 React Compiler 槽位改动）`,
  };
}
