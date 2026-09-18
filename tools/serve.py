#!/usr/bin/env python3
"""本地预览服务器

用法: python tools/serve.py [端口]        # 默认 8765

比 `python -m http.server` 多做一件事: 所有响应都带 `Cache-Control: no-store`。

为什么需要: Python 自带的 http.server 只发 Last-Modified、不发 Cache-Control，
Chrome 会据此做启发式缓存。结果是改了 app/*.js 之后刷新页面，浏览器可能仍在用
旧文件，报出 "FX.xxx is not a function" 这类假故障 —— 排查起来很浪费时间。

注意: 页面本身仍然是为「双击 index.html 用 file:// 打开」设计的
（全部用经典 <script> 标签，不用 ES module、不 fetch 本地文件）。
这个服务器只是本地开发预览的便利，不是运行前提。
"""

import http.server
import socketserver
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoStoreHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        # 只记录非 200，避免刷屏
        if args and str(args[1]) != '200':
            super().log_message(fmt, *args)


class ReusableServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    with ReusableServer(('127.0.0.1', PORT), NoStoreHandler) as httpd:
        print(f'服务中: http://127.0.0.1:{PORT}/index.html   (根目录 {ROOT})')
        print('所有响应带 no-store，改完文件刷新即生效。Ctrl+C 停止。')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n已停止')
