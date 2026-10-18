#!/usr/bin/env bash
# 精确清理**自己启动的**无头 / 调试用 Chrome，绝不按进程名批量杀。
#
# 为什么需要它：用户通常同时开着正常浏览器窗口，`taskkill /IM chrome.exe`
# 或 `Stop-Process -Name chrome` 会连它们一起强杀。这个脚本只匹配
# 命令行里带 --headless 或 --remote-debugging-port / --user-data-dir 的实例。
#
# 用法：
#   tools/kill-chrome.sh                      只结束带 --headless 的实例
#   tools/kill-chrome.sh --port 9225          只结束占用该调试端口的实例（最精确，推荐）
#   tools/kill-chrome.sh --user-data-dir /tmp/chrs   按 user-data-dir 精确匹配
#
# 注意：--port 是匹配命令行里的 --remote-debugging-port=<PORT>，
# 不是去查谁在监听该端口；这样连子进程一起清理，且不会误伤正常浏览器。
set -u

PORT=""
UDD=""
while [ $# -gt 0 ]; do
  case "$1" in
    --port) shift; PORT="${1:-}" ;;
    --port=*) PORT="${1#*=}" ;;
    --user-data-dir) shift; UDD="${1:-}" ;;
    --user-data-dir=*) UDD="${1#*=}" ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
  shift
done

# Windows（Git Bash / MSYS）走 PowerShell，其余平台走 pgrep
if command -v powershell >/dev/null 2>&1; then
  PS_FILTER='$_.CommandLine -match "--headless"'
  if [ -n "$PORT" ]; then
    PS_FILTER="\$_.CommandLine -match '--remote-debugging-port=$PORT(\\s|\$)'"
  elif [ -n "$UDD" ]; then
    PS_FILTER="\$_.CommandLine -like '*--user-data-dir=$UDD*'"
  fi
  powershell -NoProfile -Command "
    \$killed = 0
    Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" |
      Where-Object { $PS_FILTER } |
      ForEach-Object {
        Write-Output ('kill ' + \$_.ProcessId)
        Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue
        \$killed++
      }
    Write-Output (\"done: \$killed\")
  "
else
  if [ -n "$PORT" ]; then
    PAT="--remote-debugging-port=$PORT([^0-9]|\$)"
  elif [ -n "$UDD" ]; then
    PAT="--user-data-dir=$UDD"
  else
    PAT="--headless"
  fi
  pkill -f -- "$PAT" && echo "done" || echo "done: 0"
fi
