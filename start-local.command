#!/bin/bash
# 本地一键启动「跟着肯尼学英语」教学工作台
# 作用：在你自己的 Mac 上起服务，访问 http://localhost:8080
#       完全不碰 render.com，永久避免 ERR_CONNECTION_RESET（被墙重置）问题。
# 用法：双击本文件即可（macOS 会用终端运行并自动打开浏览器）。

NODE_BIN="/Users/dolphinlai/.workbuddy/binaries/node/versions/22.22.2/bin/node"
PORT=8080

# 切到本脚本所在目录（deploy/）
cd "$(dirname "$0")" || exit 1

if [ ! -f server.js ]; then
  echo "❌ 找不到 server.js，请确认本脚本位于 deploy/ 目录内。"
  exit 1
fi

echo "🚀 正在启动本地服务器 ..."
echo "   地址：http://localhost:$PORT"
echo "   关闭：关闭此终端窗口，或在终端按 Ctrl+C"
echo ""

PORT=$PORT WORKBENCH_TOKEN=local-dev "$NODE_BIN" server.js &
SRV_PID=$!

# 等服务器起来后自动打开浏览器
sleep 2.5
( open "http://localhost:$PORT" ) 2>/dev/null

wait $SRV_PID
