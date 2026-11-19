#!/bin/bash
set -e

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ "$(uname -s)" != Darwin || "$(sw_vers -productVersion | cut -d. -f1)" -lt 14 ]]; then
  printf '%s\n' '本機版需要 macOS 14 或以上版本。'
  exit 1
fi

if [[ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" == 1 ]]; then
  if [[ "$(uname -m)" != arm64 ]]; then
    printf '%s\n' '請從原生 Apple Silicon 的終端機啟動。'
    exit 1
  fi
  export PATH="/opt/homebrew/bin:$PATH"
else
  export PATH="/usr/local/bin:$PATH"
fi

check_dependencies() {
  missing=()
  if ! command -v node >/dev/null ||
    ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)'; then
    missing+=(node)
  fi
  for tool in yt-dlp ffmpeg deno; do
    command -v "$tool" >/dev/null || missing+=("$tool")
  done
  command -v python3.13 >/dev/null || missing+=(python@3.13)
}

check_dependencies
if (( ${#missing[@]} )); then
  printf '需要安裝或更新：%s\n' "${missing[*]}"
  if ! command -v brew >/dev/null; then
    printf '%s\n' '請先依 https://brew.sh/ 的說明安裝 Homebrew，接著重新執行此啟動器。'
    exit 1
  fi
  printf '%s' '用 Homebrew 安裝以上依賴？[y/N] '
  read -r answer
  if [[ "$answer" != y && "$answer" != Y ]]; then
    exit 0
  fi
  brew install "${missing[@]}"
  hash -r
  check_dependencies
  if (( ${#missing[@]} )); then
    printf '仍找不到可用的依賴：%s\n' "${missing[*]}"
    exit 1
  fi
fi

node_arch=$(node -p process.arch)
python_arch=$(python3.13 -c 'import platform; print(platform.machine())')
if [[ "$(uname -m)" == arm64 && ( "$node_arch" != arm64 || "$python_arch" != arm64 ) ]]; then
  printf '%s\n' '請在 Apple Silicon 安裝原生 arm64 的 Node.js 與 Python 3.13。'
  exit 1
fi

printf '%s\n' 'Intonavio Web 唱歌音準練習' '本機網址：http://127.0.0.1:3218/' '使用期間請保留此視窗。按 Control+C 可停止服務。'
exec node server/launch.mjs "$@"
