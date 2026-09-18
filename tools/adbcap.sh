#!/usr/bin/env bash
# adb 采集小工具: 统一 serial 与路径转换坑
#   ./adbcap.sh shot  <输出png>        截图并拉回
#   ./adbcap.sh tap   <x> <y>          点击
#   ./adbcap.sh swipe <x1> <y1> <x2> <y2> [ms]
#   ./adbcap.sh back                   返回键
export MSYS_NO_PATHCONV=1
# adb 位置: 优先环境变量 ADB, 其次 ANDROID_HOME / ANDROID_SDK_ROOT, 最后用 PATH 里的 adb
if [ -n "$ADB" ]; then :
elif [ -n "$ANDROID_HOME" ]; then ADB="$ANDROID_HOME/platform-tools/adb.exe"
elif [ -n "$ANDROID_SDK_ROOT" ]; then ADB="$ANDROID_SDK_ROOT/platform-tools/adb.exe"
else ADB="adb"; fi
# 设备 serial: 模拟器重连后可能变, 用 ADB_SERIAL 覆盖
S="${ADB_SERIAL:-emulator-5556}"

case "$1" in
  shot)
    "$ADB" -s $S shell screencap -p /sdcard/_cap.png >/dev/null 2>&1
    "$ADB" -s $S pull /sdcard/_cap.png "$2" >/dev/null 2>&1
    ls -la "$2" | awk '{print $5, $9}'
    ;;
  tap)   "$ADB" -s $S shell input tap "$2" "$3" ;;
  swipe) "$ADB" -s $S shell input swipe "$2" "$3" "$4" "$5" "${6:-400}" ;;
  back)  "$ADB" -s $S shell input keyevent 4 ;;
  size)  "$ADB" -s $S shell wm size ;;
  *) echo "usage: adbcap.sh shot|tap|swipe|back|size"; exit 1 ;;
esac
