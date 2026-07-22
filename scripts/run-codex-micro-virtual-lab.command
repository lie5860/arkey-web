#!/bin/zsh
set -eu

SCRIPT_DIR=${0:A:h}
ROOT=${SCRIPT_DIR:h}
EXECUTABLE="$ROOT/build/CodexMicroVirtualLabProduct/CodexMicroVirtualLab.app/Contents/MacOS/CodexMicroVirtualLab"
LOG="$ROOT/build/CodexMicroVirtualLab.log"

if [[ ! -x "$EXECUTABLE" ]]; then
    print -u2 "尚未构建 Codex Micro Virtual Lab。"
    print -u2 "先按 docs/CODEX_MICRO_LAB.md 使用已获批的 macOS profile 构建。"
    read -r "?按回车关闭窗口。"
    exit 1
fi

print "即将临时枚举 303A:8360 虚拟 HID；退出工具即移除设备。"
print "本工具不会刷写硬件，也不会修改 ChatGPT/Codex Desktop。"
read -r "confirmation?输入 RUN 并回车继续："
if [[ "$confirmation" != "RUN" ]]; then
    print "已取消，未创建设备。"
    read -r "?按回车关闭窗口。"
    exit 0
fi

set +e
"$EXECUTABLE" --acknowledge-device-identity-test 2>&1 | tee "$LOG"
status=${pipestatus[1]}
set -e
print "Lab 已退出（状态 $status）。日志：$LOG"
read -r "?按回车关闭窗口。"
exit "$status"
