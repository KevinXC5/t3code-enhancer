#!/usr/bin/env bash
# t3code-enhancer 一键还原脚本
# 将 APFS 原厂完整备份原子还原回 /Applications，恢复官方 Developer ID 签名
set -euo pipefail

ENHANCER_HOME="${HOME}/.t3/enhancer"
BACKUPS_DIR="${ENHANCER_HOME}/backups"
LATEST_META="${BACKUPS_DIR}/latest-backup.json"

APP_PATH=""
BACKUP_PATH=""

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
    -h|--help)
      cat <<'EOF'
用法: ./uninstall.sh [--app "/Applications/T3 Code (Nightly).app"] [--backup <备份.app路径>]
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

if pgrep -f "${APP_PATH}/Contents/MacOS/" >/dev/null 2>&1; then
  echo "[t3code-enhancer] 检测到目标应用正在运行，请先完全退出 T3 Code 后再执行还原。" >&2
  exit 1
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
