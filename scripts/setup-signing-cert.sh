#!/usr/bin/env bash
# 一键在当前 macOS 登录钥匙串创建本地固定代码签名证书（T3 Code Local Patch）
# 创建后：
#  1. install.sh 与自动升级闭环将自动检测到该证书并优先使用，告别每次重装/升级弹出钥匙串密码框
#  2. 仅首次打开签名后的 T3 Code 时点一次“始终允许”，后续永久免弹窗
set -euo pipefail

CERT_NAME="${1:-T3 Code Local Patch}"
KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"

if security find-identity -v -p codesigning "${KEYCHAIN}" 2>/dev/null | grep -Fq "\"${CERT_NAME}\""; then
  echo "[t3code-enhancer] 钥匙串中已存在有效的代码签名证书：${CERT_NAME}"
  security find-identity -v -p codesigning "${KEYCHAIN}" | grep -F "\"${CERT_NAME}\""
  exit 0
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/t3code-enhancer-cert-XXXXXX")"
cleanup() {
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

CFG="${WORK_DIR}/cert.cnf"
KEY="${WORK_DIR}/cert.key"
CRT="${WORK_DIR}/cert.crt"
P12="${WORK_DIR}/cert.p12"
P12_PASS="t3code-local-patch-tmp"

cat > "${CFG}" <<EOF
[ req ]
default_bits       = 2048
distinguished_name = req_dn
x509_extensions    = v3_codesign
prompt             = no

[ req_dn ]
CN = ${CERT_NAME}

[ v3_codesign ]
basicConstraints = critical,CA:FALSE
keyUsage         = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF

echo "[t3code-enhancer] 正在生成 10 年期本地代码签名证书：${CERT_NAME}"
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "${KEY}" -out "${CRT}" \
  -days 3650 -config "${CFG}" >/dev/null 2>&1

# macOS security import 对旧版 PBE 算法兼容性最好，优先用 -legacy（OpenSSL 3），不支持时回退默认
if ! openssl pkcs12 -export -legacy -out "${P12}" -inkey "${KEY}" -in "${CRT}" -passout "pass:${P12_PASS}" >/dev/null 2>&1; then
  openssl pkcs12 -export -out "${P12}" -inkey "${KEY}" -in "${CRT}" -passout "pass:${P12_PASS}" >/dev/null 2>&1
fi

echo "[t3code-enhancer] 正在导入证书至登录钥匙串（如弹出系统认证窗口请允许）..."
security import "${P12}" -k "${KEYCHAIN}" -P "${P12_PASS}" -T /usr/bin/codesign -T /usr/bin/security >/dev/null

echo "[t3code-enhancer] 正在将证书设为受信任的代码签名证书（需确认一次系统授权）..."
security add-trusted-cert -r trustRoot -p codeSign -k "${KEYCHAIN}" "${CRT}"

if security find-identity -v -p codesigning "${KEYCHAIN}" 2>/dev/null | grep -Fq "\"${CERT_NAME}\""; then
  echo "[t3code-enhancer] ✓ 本地代码签名证书创建并信任成功！"
  security find-identity -v -p codesigning "${KEYCHAIN}" | grep -F "\"${CERT_NAME}\""
  echo "[t3code-enhancer] 接下来退出 T3 Code 后执行 ./install.sh 即可自动启用该固定证书签名。"
else
  echo "[t3code-enhancer] 警告：证书已导入但暂未在 codesigning 列表中激活，请打开“钥匙串访问”检查“${CERT_NAME}”的信任设置（代码签名 -> 始终信任）。" >&2
  exit 1
fi
