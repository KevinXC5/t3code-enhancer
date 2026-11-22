#!/usr/bin/env bash
# t3code-enhancer 后台自动升级与重打补丁闭环脚本
# 由 MacUpdater.quitAndInstall Hook 以 detached 方式拉起：
#   1. 等待当前 T3 Code 进程退出
#   2. 解压官方 update.zip 并验证官方代码签名
#   3. APFS 写时复制备份完整原厂新版 .app
#   4. 可选执行非阻塞 git pull --ff-only
#   5. 对新版副本重打补丁；若核心锚点失配或异常则自动降级安装干净官方新版
#   6. 原子替换目标 .app 并重新拉起应用
set -euo pipefail

ENHANCER_HOME="${HOME}/.t3/enhancer"
CONFIG_PATH="${ENHANCER_HOME}/config.json"
BACKUPS_DIR="${ENHANCER_HOME}/backups"
LOGS_DIR="${ENHANCER_HOME}/logs"
mkdir -p "${BACKUPS_DIR}" "${LOGS_DIR}"

LOG_FILE="${LOGS_DIR}/update-$(date +%Y%m%d-%H%M%S).log"
exec >>"${LOG_FILE}" 2>&1

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [t3code-enhancer-updater] $*"
}

ZIP_PATH=""
TARGET_APP=""
WAIT_PID=""
RELAUNCH="1"
DRY_RUN="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --zip)
      ZIP_PATH="$2"
      shift 2
      ;;
    --app)
      TARGET_APP="$2"
      shift 2
      ;;
    --pid)
      WAIT_PID="$2"
      shift 2
      ;;
    --relaunch)
      RELAUNCH="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="1"
      shift
      ;;
    *)
      log "忽略未知参数: $1"
      shift
      ;;
  esac
done

log "启动自动升级流程: zip=${ZIP_PATH}, target=${TARGET_APP}, pid=${WAIT_PID}, relaunch=${RELAUNCH}, dryRun=${DRY_RUN}"

if [[ -z "${ZIP_PATH}" || ! -f "${ZIP_PATH}" ]]; then
  log "错误：升级包不存在：${ZIP_PATH}"
  exit 1
fi
if [[ -z "${TARGET_APP}" ]]; then
  log "错误：未提供目标 .app 路径"
  exit 1
fi

# 1. 等待旧进程完全退出（最长 45 秒）
if [[ -n "${WAIT_PID}" ]]; then
  log "等待旧进程 PID=${WAIT_PID} 退出..."
  for _ in $(seq 1 90); do
    if ! kill -0 "${WAIT_PID}" 2>/dev/null; then
      break
    fi
    sleep 0.5
  done
  if kill -0 "${WAIT_PID}" 2>/dev/null; then
    log "警告：旧进程 PID=${WAIT_PID} 超过 45 秒仍未退出，终止本次替换以防损坏。"
    exit 1
  fi
  # 给文件句柄释放一点缓冲时间
  sleep 0.5
fi

# 2. 创建临时工作区并解压官方 update.zip
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/t3code-enhancer-update-XXXXXX")"
EXTRACT_DIR="${WORK_DIR}/extract"
mkdir -p "${EXTRACT_DIR}"
cleanup() {
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

log "正在使用 ditto 解压官方更新包..."
ditto -xk "${ZIP_PATH}" "${EXTRACT_DIR}"

NEW_OFFICIAL_APP="$(find "${EXTRACT_DIR}" -maxdepth 2 -name "*.app" -type d | head -n 1)"
if [[ -z "${NEW_OFFICIAL_APP}" || ! -d "${NEW_OFFICIAL_APP}" ]]; then
  log "错误：解压后的更新包中未找到 .app 目录"
  exit 1
fi
log "已解压官方新版: ${NEW_OFFICIAL_APP}"

# 校验官方新版签名（允许测试环境通过环境变量跳过）
if [[ "${T3_ENHANCER_SKIP_OFFICIAL_VERIFY:-0}" != "1" ]]; then
  if ! codesign --verify --deep --strict "${NEW_OFFICIAL_APP}"; then
    log "错误：解压出的官方新版代码签名校验未通过，中止安装！"
    exit 1
  fi
  log "官方新版签名校验通过。"
fi

NEW_NAME="$(basename "${NEW_OFFICIAL_APP}" .app)"
NEW_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "${NEW_OFFICIAL_APP}/Contents/Info.plist" 2>/dev/null || echo 'unknown')"
SAFE_NAME="$(echo "${NEW_NAME}" | tr ' /' '__')"

# 3. APFS 写时复制备份干净官方新版（dry-run 模式不污染用户备份目录）
if [[ "${DRY_RUN}" != "1" ]]; then
  BACKUP_APP="${BACKUPS_DIR}/${SAFE_NAME}-${NEW_VERSION}-original.app"
  if [[ ! -d "${BACKUP_APP}" ]]; then
    log "创建新版原厂 APFS 备份: ${BACKUP_APP}"
    if ! cp -c -R "${NEW_OFFICIAL_APP}" "${BACKUP_APP}" 2>/dev/null; then
      cp -R "${NEW_OFFICIAL_APP}" "${BACKUP_APP}"
    fi
  fi
  cat > "${BACKUPS_DIR}/latest-backup.json" <<EOF
{
  "appPath": "${TARGET_APP}",
  "appName": "${NEW_NAME}",
  "version": "${NEW_VERSION}",
  "backupPath": "${BACKUP_APP}",
  "teamId": "ARK85ZXQ4Z",
  "createdAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
fi

# 解析配置中的仓库目录与 autoPullOnUpdate
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUTO_PULL="0"
if [[ -f "${CONFIG_PATH}" ]]; then
  CFG_REPO="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("repoDir",""))' "${CONFIG_PATH}" 2>/dev/null || true)"
  CFG_PULL="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("1" if d.get("autoPullOnUpdate") else "0")' "${CONFIG_PATH}" 2>/dev/null || true)"
  if [[ -n "${CFG_REPO}" && -d "${CFG_REPO}" ]]; then
    REPO_DIR="${CFG_REPO}"
  fi
  AUTO_PULL="${CFG_PULL:-0}"
fi

# 4. 可选非阻塞拉取最新补丁代码（容错，不阻断升级）
if [[ "${AUTO_PULL}" == "1" && -d "${REPO_DIR}/.git" ]]; then
  log "尝试更新补丁仓库 (git pull --ff-only)..."
  (
    cd "${REPO_DIR}"
    git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=12 pull --ff-only || log "警告：git pull 未能完成，继续使用本地补丁。"
  )
fi

# 查找 Node 或内置 Electron 运行时
run_node() {
  if command -v node >/dev/null 2>&1; then
    node "$@"
  else
    local electron_bin
    electron_bin="$(find "${NEW_OFFICIAL_APP}/Contents/MacOS" -maxdepth 1 -type f -perm -u+x | head -n 1)"
    ELECTRON_RUN_AS_NODE=1 "${electron_bin}" "$@"
  fi
}

# 5. 在独立副本上尝试重打补丁；失败则自动安全降级为干净官方新版
PATCHED_STAGING_APP="${WORK_DIR}/patched.app"
if ! cp -c -R "${NEW_OFFICIAL_APP}" "${PATCHED_STAGING_APP}" 2>/dev/null; then
  cp -R "${NEW_OFFICIAL_APP}" "${PATCHED_STAGING_APP}"
fi

INSTALL_SOURCE="${NEW_OFFICIAL_APP}"
INSTALL_MODE="official-fallback"

PATCH_EXTRA_ARGS=()
if [[ "${T3_ENHANCER_NO_SIGN:-0}" == "1" ]]; then
  PATCH_EXTRA_ARGS+=("--no-sign")
fi

log "开始对新版副本执行补丁 (--strict-updater)..."
if run_node "${REPO_DIR}/scripts/patch-all.mjs" --app "${PATCHED_STAGING_APP}" --strict-updater ${PATCH_EXTRA_ARGS[@]+"${PATCH_EXTRA_ARGS[@]}"}; then
  if [[ "${T3_ENHANCER_NO_SIGN:-0}" == "1" ]] || codesign --verify --deep --strict "${PATCHED_STAGING_APP}"; then
    INSTALL_SOURCE="${PATCHED_STAGING_APP}"
    INSTALL_MODE="patched"
    log "新版补丁与签名校验全部通过！"
  else
    log "警告：补丁版签名校验失败，自动降级安装干净官方新版！"
  fi
else
  log "警告：补丁执行失败或核心更新器锚点失配，自动降级安装干净官方新版！"
fi

if [[ "${INSTALL_MODE}" == "official-fallback" ]]; then
  cat > "${LOGS_DIR}/last-downgrade-warning.log" <<EOF
[${NEW_VERSION}] $(date '+%Y-%m-%d %H:%M:%S')
自动升级期间补丁锚点失配或重签名异常，已自动安全降级为干净官方新版。
详细日志：${LOG_FILE}
EOF
fi

if [[ "${DRY_RUN}" == "1" ]]; then
  log "DRY-RUN 完成: installMode=${INSTALL_MODE}, source=${INSTALL_SOURCE}"
  exit 0
fi

# 6. 原子替换目标 .app（先在同卷准备，再双 mv 原子切换，失败自动回滚）
TARGET_PARENT="$(dirname "${TARGET_APP}")"
STAGING_IN_TARGET="${TARGET_PARENT}/.t3-enhancer-new-$$.app"
OLD_BACKUP_IN_TARGET="${TARGET_PARENT}/.t3-enhancer-old-$$.app"

log "正在原子替换目标应用 (${INSTALL_MODE}): ${TARGET_APP}"
if ! cp -c -R "${INSTALL_SOURCE}" "${STAGING_IN_TARGET}" 2>/dev/null; then
  cp -R "${INSTALL_SOURCE}" "${STAGING_IN_TARGET}"
fi

if [[ -d "${TARGET_APP}" ]]; then
  mv "${TARGET_APP}" "${OLD_BACKUP_IN_TARGET}"
fi

if mv "${STAGING_IN_TARGET}" "${TARGET_APP}"; then
  rm -rf "${OLD_BACKUP_IN_TARGET}"
  log "原子替换成功 (${INSTALL_MODE})！"
else
  log "错误：目标目录替换失败，回滚旧版应用..."
  if [[ -d "${OLD_BACKUP_IN_TARGET}" ]]; then
    mv "${OLD_BACKUP_IN_TARGET}" "${TARGET_APP}"
  fi
  rm -rf "${STAGING_IN_TARGET}"
  exit 1
fi

# 7. 重新启动应用
if [[ "${RELAUNCH}" == "1" ]]; then
  log "正在重新启动 ${TARGET_APP}..."
  open "${TARGET_APP}" || log "警告：open 启动应用返回非零状态"
fi

log "自动升级闭环全部完成。"
