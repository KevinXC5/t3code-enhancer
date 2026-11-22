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
    -h|--help)
      cat <<'EOF'
用法: ./install.sh [--app "/Applications/T3 Code (Nightly).app"] [--dry-run] [其他 patch-all.mjs 参数]
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

# 检查目标应用是否处于运行状态（给出提示，防止覆盖正在加载的 asar 引发异常）
if pgrep -f "${APP_PATH}/Contents/MacOS/" >/dev/null 2>&1; then
  echo "[t3code-enhancer] 提示：检测到 ${APP_NAME} 正在运行。建议先完全退出应用后再安装，安装完成后重新打开。" >&2
fi

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
