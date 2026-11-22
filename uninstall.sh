#!/usr/bin/env bash
# t3code-enhancer 一键还原脚本
# 将 APFS 原厂完整备份原子还原回 /Applications，恢复官方 Developer ID 签名
set -euo pipefail

ENHANCER_HOME="${HOME}/.t3/enhancer"
BACKUPS_DIR="${ENHANCER_HOME}/backups"
LATEST_META="${BACKUPS_DIR}/latest-backup.json"

APP_PATH=""
BACKUP_PATH=""
NO_REOPEN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      APP_PATH="$2"
      shift 2
      ;;
    --backup)
      BACKUP_PATH="$2"
      shift 2
      ;;
    --no-reopen)
      NO_REOPEN=1
      shift
      ;;
    -h|--help)
      cat <<'EOF'
用法: ./uninstall.sh [--app "/Applications/T3 Code (Nightly).app"] [--backup <备份.app路径>] [--no-reopen]
EOF
      exit 0
      ;;
    *)
      echo "[t3code-enhancer] 未知参数: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${BACKUP_PATH}" && -f "${LATEST_META}" ]]; then
  BACKUP_PATH="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("backupPath",""))' "${LATEST_META}" 2>/dev/null || true)"
  if [[ -z "${APP_PATH}" ]]; then
    APP_PATH="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("appPath",""))' "${LATEST_META}" 2>/dev/null || true)"
  fi
fi

if [[ -z "${BACKUP_PATH}" || ! -d "${BACKUP_PATH}" ]]; then
  echo "[t3code-enhancer] 未找到原厂备份（可在 ${BACKUPS_DIR} 查看或通过 --backup 指定）。" >&2
  exit 1
fi

if [[ -z "${APP_PATH}" ]]; then
  echo "[t3code-enhancer] 未指定目标应用路径，请通过 --app 指定。" >&2
  exit 1
fi

# 校验原厂备份签名完整后再动手替换
echo "[t3code-enhancer] 校验原厂备份签名: ${BACKUP_PATH}"
codesign --verify --deep --strict "${BACKUP_PATH}"

# 检测目标应用是否正在运行，若运行中则提示并自动优雅退出，还原完成后再自动打开
APP_NAME="$(basename "${APP_PATH}" .app)"
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

if is_app_running; then
  WAS_RUNNING=1
  echo "[t3code-enhancer] 检测到 ${APP_NAME} 正在运行，需要先退出应用后再还原，正在自动退出..."
  if [[ -n "${APP_BUNDLE_ID}" ]]; then
    osascript -e "tell application id \"${APP_BUNDLE_ID}\" to quit" >/dev/null 2>&1 || true
  else
    osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
  fi

  waited=0
  while is_app_running && [[ "${waited}" -lt 25 ]]; do
    sleep 0.2
    waited=$((waited + 1))
  done

  if is_app_running; then
    echo "[t3code-enhancer] 正在结束残留的后台服务进程..."
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
  echo "[t3code-enhancer] ${APP_NAME} 已退出，继续执行还原..."
fi

TARGET_DIR="$(dirname "${APP_PATH}")"
STAGING_APP="${TARGET_DIR}/.t3-enhancer-restore-$$.app"
OLD_APP="${TARGET_DIR}/.t3-enhancer-old-$$.app"

echo "[t3code-enhancer] 正在准备还原副本..."
if ! cp -c -R "${BACKUP_PATH}" "${STAGING_APP}" 2>/dev/null; then
  cp -R "${BACKUP_PATH}" "${STAGING_APP}"
fi

# 原子替换：先移走旧包再移入还原包，失败时回滚
if [[ -d "${APP_PATH}" ]]; then
  mv "${APP_PATH}" "${OLD_APP}"
fi

if mv "${STAGING_APP}" "${APP_PATH}"; then
  rm -rf "${OLD_APP}"
else
  echo "[t3code-enhancer] 替换失败，正在回滚原应用..." >&2
  if [[ -d "${OLD_APP}" ]]; then
    mv "${OLD_APP}" "${APP_PATH}"
  fi
  rm -rf "${STAGING_APP}"
  exit 1
fi

codesign --verify --deep --strict "${APP_PATH}"
echo "[t3code-enhancer] 已成功还原至原厂官方签名版本: ${APP_PATH}"
if [[ "${WAS_RUNNING}" -eq 1 && "${NO_REOPEN}" -eq 0 ]]; then
  echo "[t3code-enhancer] 正在重新打开 ${APP_NAME}..."
  open "${APP_PATH}"
fi
