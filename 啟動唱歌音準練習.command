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

yt_dlp_supported() {
  "$1" --ignore-config --js-runtimes deno --version >/dev/null 2>&1
}

use_homebrew_downloader() {
  local prefix
  command -v brew >/dev/null || return 1
  prefix=$(brew --prefix yt-dlp 2>/dev/null) || return 1
  [[ -x "$prefix/bin/yt-dlp" ]] && yt_dlp_supported "$prefix/bin/yt-dlp" || return 1
  export PATH="$prefix/bin:$PATH"
  hash -r
}

use_ffmpeg_directory() {
  local bin="$1"
  [[ -x "$bin/ffmpeg" && -x "$bin/ffprobe" ]] || return 1
  "$bin/ffmpeg" -version >/dev/null 2>&1 || return 1
  "$bin/ffprobe" -version >/dev/null 2>&1 || return 1
  export INTONAVIO_FFMPEG_DIR="$bin"
  export PATH="$bin:$PATH"
  hash -r
}

configure_ffmpeg() {
  local ffmpeg_path prefix
  unset INTONAVIO_FFMPEG_DIR
  ffmpeg_path=$(command -v ffmpeg) || ffmpeg_path=""
  if [[ "$ffmpeg_path" == /* ]] && use_ffmpeg_directory "${ffmpeg_path%/*}"; then
    return 0
  fi
  if command -v brew >/dev/null &&
    prefix=$(brew --prefix ffmpeg 2>/dev/null) &&
    use_ffmpeg_directory "$prefix/bin"; then
    return 0
  fi
  ffmpeg -version >/dev/null 2>&1 && ffprobe -version >/dev/null 2>&1
}

check_dependencies() {
  missing=()
  outdated_downloader=false
  missing_ffmpeg=false
  if ! command -v node >/dev/null ||
    ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)'; then
    missing+=(node)
  fi
  if ! yt_dlp_supported yt-dlp && ! use_homebrew_downloader; then
    if command -v yt-dlp >/dev/null; then
      outdated_downloader=true
    else
      missing+=(yt-dlp)
    fi
  fi
  configure_ffmpeg || missing_ffmpeg=true
  command -v deno >/dev/null || missing+=(deno)
  command -v python3.13 >/dev/null || missing+=(python@3.13)
}

check_dependencies
if (( ${#missing[@]} )) || "$outdated_downloader" || "$missing_ffmpeg"; then
  if (( ${#missing[@]} )); then
    printf '需要安裝或更新：%s\n' "${missing[*]}"
  fi
  if "$outdated_downloader"; then
    printf '%s\n' '這台 Mac 的 YouTube 下載工具（yt-dlp）版本太舊，需要更新才能分離人聲。'
  fi
  if "$missing_ffmpeg"; then
    printf '%s\n' '缺少可用的音訊轉檔工具（ffmpeg 和 ffprobe）。兩者都由 Homebrew 的 ffmpeg 套件提供。'
  fi
  if ! command -v brew >/dev/null; then
    printf '%s\n' '請先依 https://brew.sh/ 的說明安裝 Homebrew，接著重新執行此啟動器。'
    exit 1
  fi
  printf '%s' '使用 Homebrew 安裝或更新以上工具？[y/N] '
  read -r answer
  if [[ "$answer" != y && "$answer" != Y ]]; then
    exit 0
  fi
  if "$outdated_downloader"; then
    brew update
    if [[ -n "$(brew list --versions yt-dlp 2>/dev/null)" ]]; then
      brew upgrade yt-dlp
    else
      missing+=(yt-dlp)
    fi
  fi
  if "$missing_ffmpeg"; then
    if [[ -n "$(brew list --versions ffmpeg 2>/dev/null)" ]]; then
      brew reinstall ffmpeg || printf '%s\n' 'Homebrew 回報修復問題，正在檢查音訊工具是否仍可啟動。'
    else
      brew install ffmpeg || printf '%s\n' 'Homebrew 回報安裝問題，正在檢查音訊工具是否仍可啟動。'
    fi
  fi
  if (( ${#missing[@]} )); then
    brew install "${missing[@]}"
  fi
  hash -r
  check_dependencies
  if "$outdated_downloader"; then
    printf '仍在使用舊版 yt-dlp：%s\n' "$(command -v yt-dlp)"
    printf '%s\n' '請確認 Homebrew 更新成功，再重新開啟啟動檔。'
    exit 1
  fi
  if "$missing_ffmpeg"; then
    printf '%s\n' 'ffmpeg 或 ffprobe 仍無法執行。請把上方的安裝訊息提供給 Intonavio 的維護者。'
    exit 1
  fi
  if (( ${#missing[@]} )); then
    printf '仍找不到可用的工具：%s\n' "${missing[*]}"
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
