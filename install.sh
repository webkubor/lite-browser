#!/usr/bin/env bash
set -e

# lite-browser 一键安装脚本
REPO="webkubor/lite-browser"
INSTALL_DIR="${HOME}/.local/bin"
TARGET="${INSTALL_DIR}/lite-browser"

mkdir -p "${INSTALL_DIR}"

echo "🚀 正在安装 lite-browser..."

# 如果当前就在源码目录中，优先编译或链接
if [ -f "src/cli.ts" ] && command -v bun >/dev/null 2>&1; then
  echo "📦 本地源码就绪，编译原生单文件二进制..."
  bun run build
  ln -sf "$(pwd)/bin/lite-browser" "${TARGET}"
elif command -v bun >/dev/null 2>&1; then
  TMP_DIR=$(mktemp -d)
  trap 'rm -rf "${TMP_DIR}"' EXIT
  git clone --depth 1 "https://github.com/${REPO}.git" "${TMP_DIR}"
  (cd "${TMP_DIR}" && bun run build && cp bin/lite-browser "${TARGET}")
else
  # 预编译包直接下载回退
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m)"
  if [ "$ARCH" = "x86_64" ]; then ARCH="x64"; fi
  if [ "$ARCH" = "aarch64" ]; then ARCH="arm64"; fi
  
  DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/lite-browser-${OS}-${ARCH}"
  if curl -fsSL -o "${TARGET}" "${DOWNLOAD_URL}" 2>/dev/null; then
    chmod +x "${TARGET}"
  else
    echo "❌ 需要安装 Bun 环境以完成编译: curl -fsSL https://bun.sh/install | bash"
    exit 1
  fi
fi

chmod +x "${TARGET}"

# PATH 提示
case ":$PATH:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    echo "💡 请将 ${INSTALL_DIR} 加入您的 PATH: export PATH=\"${INSTALL_DIR}:\$PATH\""
    ;;
esac

echo "✅ lite-browser 安装成功！执行 'lite-browser --help' 开始使用。"
