#!/usr/bin/env bash
# t3code-enhancer 一键安装脚本
# 功能：自动探测 T3 Code.app -> APFS 写时复制完整备份原厂签名包 -> 打补丁并重签名 -> 写入配置
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENHANCER_HOME="${HOME}/.t3/enhancer"
BACKUPS_DIR="${ENHANCER_HOME}/backups"
CONFIG_PATH="${ENHANCER_HOME}/config.json"

APP_PATH=""
DRY_RUN=0
NO_REOPEN=0
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      APP_PATH="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      EXTRA_ARGS+=("--dry-run")
      shift
      ;;
    --no-reopen)
      NO_REOPEN=1
      shift
      ;;
    -h|--help)
      cat <<'EOF'
用法: ./install.sh [--app "/Applications/T3 Code (Nightly).app"] [--dry-run] [--no-reopen] [其他 patch-all.mjs 参数]
EOF
      exit 0
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

detect_app() {
  if [[ -n "${APP_PATH}" ]]; then
    echo "${APP_PATH}"
    return
  fi
  for candidate in \
    "/Applications/T3 Code (Nightly).app" \
    "/Applications/T3 Code.app" \
    "${HOME}/Applications/T3 Code (Nightly).app" \
    "${HOME}/Applications/T3 Code.app"; do
    if [[ -f "${candidate}/Contents/Resources/app.asar" ]]; then
      echo "${candidate}"
      return
    fi
  done
  echo ""
}

APP_PATH="$(detect_app)"
if [[ -z "${APP_PATH}" || ! -d "${APP_PATH}" ]]; then
  echo "[t3code-enhancer] 未找到 T3 Code.app，请通过 --app 指定路径。" >&2
  exit 1
fi

# 解析 Node 运行时：优先系统 node，否则回退应用内置 Electron（ELECTRON_RUN_AS_NODE=1）
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"
run_node() {
  if command -v node >/dev/null 2>&1; then
    node "$@"
  else
    local electron_bin
    electron_bin="$(find "${APP_PATH}/Contents/MacOS" -maxdepth 1 -type f -perm -u+x | head -n 1)"
    if [[ -z "${electron_bin}" ]]; then
      echo "[t3code-enhancer] 既未找到系统 node，也无法定位应用内置 Electron 可执行文件。" >&2
      exit 1
    fi
    ELECTRON_RUN_AS_NODE=1 "${electron_bin}" "$@"
  fi
}

APP_NAME="$(basename "${APP_PATH}" .app)"
APP_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "${APP_PATH}/Contents/Info.plist" 2>/dev/null || echo 'unknown')"
SAFE_NAME="$(echo "${APP_NAME}" | tr ' /' '__')"
BACKUP_APP="${BACKUPS_DIR}/${SAFE_NAME}-${APP_VERSION}-original.app"

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "[t3code-enhancer] 只读体检模式，不会备份或修改 ${APP_PATH}"
  run_node "${REPO_DIR}/scripts/patch-all.mjs" --app "${APP_PATH}" ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
  exit 0
fi

# 检测目标应用是否正在运行，若运行中则提示并自动优雅退出，安装完成后再自动打开
APP_BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "${APP_PATH}/Contents/Info.plist" 2>/dev/null || true)"
WAS_RUNNING=0

get_app_pids() {
  # 仅匹配真正以目标 .app/Contents/MacOS/ 为可执行文件前缀的进程，避免匹配到 awk 或命令行参数中包含路径的无关进程
  ps -ax -o pid=,command= | awk -v prefix="${APP_PATH}/Contents/MacOS/" '
    {
      pid = $1
      cmd = $0
      sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", cmd)
      if (substr(cmd, 1, length(prefix)) == prefix) print pid
    }
  '
}

is_app_running() {
  [[ -n "$(get_app_pids)" ]]
}

quit_app_if_running() {
  if ! is_app_running; then
    return 0
  fi
  WAS_RUNNING=1
  echo "[t3code-enhancer] 检测到 ${APP_NAME} 正在运行，需要先退出应用后再安装，正在自动退出..."
  if [[ -n "${APP_BUNDLE_ID}" ]]; then
    osascript -e "tell application id \"${APP_BUNDLE_ID}\" to quit" >/dev/null 2>&1 || true
  else
    osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
  fi

  local waited=0
  while is_app_running && [[ "${waited}" -lt 25 ]]; do
    sleep 0.2
    waited=$((waited + 1))
  done

  if is_app_running; then
    echo "[t3code-enhancer] 正在结束残留的后台服务进程..."
    local pids
    pids="$(get_app_pids)"
    if [[ -n "${pids}" ]]; then
      kill -TERM ${pids} >/dev/null 2>&1 || true
    fi
    waited=0
    while is_app_running && [[ "${waited}" -lt 20 ]]; do
      sleep 0.2
      waited=$((waited + 1))
    done
  fi

  if is_app_running; then
    echo "[t3code-enhancer] 无法自动退出 ${APP_NAME}，请手动退出（Cmd + Q）后重试。" >&2
    exit 1
  fi
  echo "[t3code-enhancer] ${APP_NAME} 已退出，继续执行安装..."
}

quit_app_if_running

mkdir -p "${BACKUPS_DIR}"

# 仅在当前为官方签名且同版本原厂备份不存在时，通过 APFS cp -c -R 零空间备份
TEAM_ID="$(codesign -dv --verbose=2 "${APP_PATH}" 2>&1 | awk -F= '/^TeamIdentifier=/{print $2}' | head -n 1 || true)"
if [[ "${TEAM_ID}" == "ARK85ZXQ4Z" ]]; then
  if [[ ! -d "${BACKUP_APP}" ]]; then
    echo "[t3code-enhancer] 创建 APFS 原厂完整备份: ${BACKUP_APP}"
    if ! cp -c -R "${APP_PATH}" "${BACKUP_APP}" 2>/dev/null; then
      cp -R "${APP_PATH}" "${BACKUP_APP}"
    fi
    cat > "${BACKUPS_DIR}/latest-backup.json" <<EOF
{
  "appPath": "${APP_PATH}",
  "appName": "${APP_NAME}",
  "version": "${APP_VERSION}",
  "backupPath": "${BACKUP_APP}",
  "teamId": "${TEAM_ID}",
  "createdAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
  else
    echo "[t3code-enhancer] 已存在该版本的原厂备份，保持不动: ${BACKUP_APP}"
  fi
else
  echo "[t3code-enhancer] 当前应用非官方签名（TeamIdentifier=${TEAM_ID:-none}），跳过覆盖原厂备份。"
fi

# 将仓库路径与目标应用写入 ~/.t3/enhancer/config.json（保留已有自定义配置）
run_node --input-type=module -e '
import { saveConfig } from "'"${REPO_DIR}"'/scripts/config.mjs";
saveConfig({ repoDir: "'"${REPO_DIR}"'", appPath: "'"${APP_PATH}"'" });
'

# 若当前应用已打过旧版补丁且存在同版本原厂备份，先基于干净原厂副本重新打补丁再原子替换（防止旧补丁残留）
if [[ "${TEAM_ID}" != "ARK85ZXQ4Z" && -d "${BACKUP_APP}" ]]; then
  echo "[t3code-enhancer] 检测到已安装旧版补丁，正在基于原厂干净备份重新构建最新补丁..."
  TARGET_PARENT="$(dirname "${APP_PATH}")"
  STAGING_APP="${TARGET_PARENT}/.t3-enhancer-staging-$$.app"
  OLD_APP="${TARGET_PARENT}/.t3-enhancer-old-$$.app"
  cleanup_staging() {
    rm -rf "${STAGING_APP}" 2>/dev/null || true
  }
  trap cleanup_staging EXIT

  if ! cp -c -R "${BACKUP_APP}" "${STAGING_APP}" 2>/dev/null; then
    cp -R "${BACKUP_APP}" "${STAGING_APP}"
  fi

  run_node "${REPO_DIR}/scripts/patch-all.mjs" --app "${STAGING_APP}" ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}

  mv "${APP_PATH}" "${OLD_APP}"
  if mv "${STAGING_APP}" "${APP_PATH}"; then
    rm -rf "${OLD_APP}"
    trap - EXIT
  else
    echo "[t3code-enhancer] 原子替换失败，正在回滚..." >&2
    mv "${OLD_APP}" "${APP_PATH}"
    exit 1
  fi
else
  # 首次直接对目标应用打补丁与重签名
  run_node "${REPO_DIR}/scripts/patch-all.mjs" --app "${APP_PATH}" ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
fi
echo "[t3code-enhancer] 安装完成。原厂还原可执行: ${REPO_DIR}/uninstall.sh"
if [[ "${WAS_RUNNING}" -eq 1 && "${NO_REOPEN}" -eq 0 ]]; then
  echo "[t3code-enhancer] 正在重新打开 ${APP_NAME}..."
  open "${APP_PATH}"
fi
