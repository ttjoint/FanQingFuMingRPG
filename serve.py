#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本地开发服务器：带 no-cache 头，避免浏览器缓存旧的 ES Module
（否则改了 src/*.js 后可能报 “does not provide an export named …”）。

用法:
    python serve.py [端口]      # 默认 8005
"""
import http.server
import socketserver
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8005


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


class ReuseServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    with ReuseServer(("", PORT), NoCacheHandler) as httpd:
        print("serving http://localhost:%d/  (Cache-Control: no-store)" % PORT)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
