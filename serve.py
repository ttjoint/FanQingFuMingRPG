#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本地开发服务器（含“版本库”读写后端）。

用途：
  - 静态提供游戏与 assets（带 no-cache 头，避免浏览器缓存旧的 ES Module）。
  - 提供 /__api__/... 接口，让本地运行的编辑器可以把数据版本**直接写入
    versions/<id>/ 文件夹**（仅本地开发时存在；静态部署时不含本文件，
    编辑器自动退化为“纯浏览器 localStorage/IndexedDB”模式）。

用法:
    python serve.py [端口]      # 默认 8005

版本库目录结构：
    versions/
      default/                 ← 最初默认版本（只读；version.json 里 readonly:true）
        version.json
        assets/                ← 原版全部数据（json + 图片/音频/地图）
      <id>/                    ← 编辑器创建的版本（可写）
        version.json           ← 元数据 + 补丁（patch）
        assets/                ← 仅存放“被覆盖”的素材文件（可选）

安全：所有写操作仅允许在 versions/ 下、且禁止修改 readonly 版本。
"""
import http.server
import socketserver
import sys
import os
import json
import re
import shutil
import time
import base64
import urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
VERSIONS_DIR = os.path.join(ROOT, "versions")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8005

ID_RE = re.compile(r"^[A-Za-z0-9_\-.]+$")


def _safe_id(vid):
    """版本 id 白名单校验，防止路径穿越。"""
    return bool(vid) and bool(ID_RE.match(vid)) and vid not in (".", "..")


def _version_dir(vid):
    return os.path.join(VERSIONS_DIR, vid)


def _read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _invalidate_assets_cache(vid=None):
    """素材清单缓存失效。vid 为 None 表示全清。"""
    if vid is None:
        _ASSETS_CACHE.clear()
        return
    _ASSETS_CACHE.pop(os.path.join(_version_dir(vid), "assets"), None)


def _write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def _list_versions():
    out = []
    if not os.path.isdir(VERSIONS_DIR):
        return out
    for name in sorted(os.listdir(VERSIONS_DIR)):
        d = _version_dir(name)
        vj = os.path.join(d, "version.json")
        if not os.path.isdir(d) or not os.path.isfile(vj):
            continue
        try:
            meta = _read_json(vj)
        except Exception:
            continue
        out.append({
            "id": meta.get("id", name),
            "name": meta.get("name", name),
            "builtin": bool(meta.get("builtin")),
            "readonly": bool(meta.get("readonly")),
            "updatedAt": meta.get("updatedAt", 0),
        })
    return out


def _load_version(vid):
    d = _version_dir(vid)
    vj = os.path.join(d, "version.json")
    if not os.path.isfile(vj):
        return None
    meta = _read_json(vj)
    meta.setdefault("id", vid)
    if os.path.isfile(os.path.join(d, "patch.json")):
        meta["patch"] = _read_json(os.path.join(d, "patch.json"))
    # 列出该版本 assets/ 下被覆盖的素材（逻辑键），供客户端映射 URL。
    meta["assets"] = _list_assets(os.path.join(d, "assets"))
    return meta


# ---- 素材清单缓存 ----
# 默认版本有约 3000 个文件。原先每次 /__api__/versions 请求都 os.walk 一遍全量
# 再排序、序列化成 ~120KB JSON；而浏览器每次启动都会请求它，与 450+ 个素材请求
# 并发时偶发把启动卡到几十秒（E2E 里表现为 waitBoot 超时，但只是"卡"，不是错）。
# 这里按目录 mtime 缓存：目录没变就直接复用，编辑器存过版本后 mtime 变化会自动失效。
_ASSETS_CACHE = {}


def _dir_stamp(adir):
    """目录树签名：顶层 mtime + 文件总数。够用且比逐个 stat 便宜。"""
    try:
        st = os.stat(adir)
    except OSError:
        return None
    return (st.st_mtime,)


def _list_assets(adir):
    if not os.path.isdir(adir):
        return []
    stamp = _dir_stamp(adir)
    hit = _ASSETS_CACHE.get(adir)
    if hit and stamp is not None and hit[0] == stamp:
        return hit[1]
    assets = []
    for root, _dirs, files in os.walk(adir):
        for fn in files:
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, adir).replace(os.sep, "/")
            assets.append("assets/" + rel)
    assets.sort()
    if stamp is not None:
        _ASSETS_CACHE[adir] = (stamp, assets)
    return assets


class Handler(http.server.SimpleHTTPRequestHandler):
    # ---- 响应工具 ----
    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _err(self, msg, code=400):
        self._json({"ok": False, "error": msg}, code)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return None

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    # ---- 路由 ----
    def _api(self, method):
        # /__api__/versions          GET 列表 | POST 新建
        # /__api__/versions/<id>      GET 读取 | PUT 保存 | DELETE 删除
        # /__api__/versions/<id>/rename  POST 重命名
        path = self.path.split("?", 1)[0].rstrip("/")
        parts = [p for p in path.split("/") if p]
        # parts[0] == "__api__"
        if len(parts) < 2 or parts[1] != "versions":
            return self._err("unknown api", 404)

        if len(parts) == 2:
            if method == "GET":
                return self._json({"ok": True, "available": True, "versions": _list_versions()})
            if method == "POST":
                return self._create()
            return self._err("method not allowed", 405)

        vid = parts[2]
        if not _safe_id(vid):
            return self._err("非法版本 id", 400)

        if len(parts) == 4 and parts[3] == "rename":
            if method != "POST":
                return self._err("method not allowed", 405)
            return self._rename(vid)

        if len(parts) == 3:
            if method == "GET":
                v = _load_version(vid)
                return self._json({"ok": True, "version": v}) if v else self._err("版本不存在", 404)
            if method == "PUT":
                return self._save(vid)
            if method == "DELETE":
                return self._delete(vid)
            return self._err("method not allowed", 405)

        return self._err("unknown api", 404)

    def _create(self):
        body = self._body()
        if body is None:
            return self._err("请求体不是合法 JSON")
        vid = str(body.get("id") or "").strip()
        if not _safe_id(vid):
            return self._err("非法版本 id", 400)
        d = _version_dir(vid)
        if os.path.exists(d):
            return self._err("版本已存在", 409)
        base_id = str(body.get("base") or "default")
        os.makedirs(os.path.join(d, "assets"), exist_ok=True)
        meta = {
            "format": "gsxy.version", "version": 1,
            "id": vid, "name": body.get("name") or vid,
            "builtin": False, "readonly": False,
            "base": base_id, "assets": "assets",
            "createdAt": int(time.time() * 1000), "updatedAt": int(time.time() * 1000),
        }
        _write_json(os.path.join(d, "version.json"), meta)
        _write_json(os.path.join(d, "patch.json"), body.get("patch") or {})
        return self._json({"ok": True, "version": meta})

    def _meta_of(self, vid, default=None):
        vj = os.path.join(_version_dir(vid), "version.json")
        return _read_json(vj) if os.path.isfile(vj) else (default or {})

    def _save(self, vid):
        d = _version_dir(vid)
        if not os.path.isdir(d):
            return self._err("版本不存在", 404)
        meta = self._meta_of(vid)
        if meta.get("readonly"):
            return self._err("该版本为只读（原版），不能修改", 403)
        body = self._body()
        if body is None:
            return self._err("请求体不是合法 JSON")
        if body.get("patch") is not None:
            _write_json(os.path.join(d, "patch.json"), body["patch"])
        # 图片覆盖：{ "assets/xxx.png": "data:image/png;base64,..." }，值为 null 表示删除该覆盖。
        images = body.get("images")
        if images:
            for logical, data in images.items():
                self._write_asset(d, logical, data)
        removed = body.get("removedImages")
        if removed:
            for logical in removed:
                self._write_asset(d, logical, None)
        if body.get("name"):
            meta["name"] = body["name"]
        meta["updatedAt"] = int(time.time() * 1000)
        _write_json(os.path.join(d, "version.json"), meta)
        _invalidate_assets_cache(vid)          # 存过版本后素材清单要重算
        return self._json({"ok": True, "version": meta})

    def _write_asset(self, version_dir, logical, data):
        # 写素材会让该版本的 assets/ 清单变化，主动失效缓存
        # （目录 mtime 只在增删直接子项时变，覆盖已有文件不会变）。
        _ASSETS_CACHE.pop(os.path.join(version_dir, "assets"), None)
        # 把逻辑键 "assets/xxx" 映射到版本目录下的相对文件，防止路径穿越。
        rel = str(logical or "").strip().lstrip("/")
        if rel.startswith("assets/"):
            rel = rel[len("assets/"):]
        rel = rel.replace("\\", "/")
        parts = [p for p in rel.split("/") if p not in ("", ".", "..")]
        if not parts:
            return
        target = os.path.join(version_dir, "assets", *parts)
        base = os.path.join(version_dir, "assets")
        if not os.path.abspath(target).startswith(os.path.abspath(base) + os.sep):
            return
        if data is None:
            if os.path.isfile(target):
                try:
                    os.remove(target)
                except OSError:
                    pass
            return
        os.makedirs(os.path.dirname(target), exist_ok=True)
        s = str(data)
        if s.startswith("data:"):
            comma = s.find(",")
            head, payload = s[:comma], s[comma + 1:]
            if ";base64" in head:
                raw = base64.b64decode(payload)
            else:
                raw = urllib.parse.unquote_to_bytes(payload)
        else:
            raw = s.encode("utf-8")
        with open(target, "wb") as f:
            f.write(raw)

    def _delete(self, vid):
        d = _version_dir(vid)
        if not os.path.isdir(d):
            return self._err("版本不存在", 404)
        meta = self._meta_of(vid)
        if meta.get("readonly") or meta.get("builtin"):
            return self._err("该版本为只读（原版），不能删除", 403)
        shutil.rmtree(d)
        return self._json({"ok": True})

    def _rename(self, vid):
        d = _version_dir(vid)
        if not os.path.isdir(d):
            return self._err("版本不存在", 404)
        meta = self._meta_of(vid)
        if meta.get("readonly") or meta.get("builtin"):
            return self._err("该版本为只读（原版），不能重命名", 403)
        body = self._body()
        if body is None or not body.get("name"):
            return self._err("缺少 name")
        meta["name"] = str(body["name"])
        meta["updatedAt"] = int(time.time() * 1000)
        _write_json(os.path.join(d, "version.json"), meta)
        return self._json({"ok": True, "version": meta})

    # ---- HTTP 方法 ----
    def do_GET(self):
        if self.path.split("?", 1)[0].startswith("/__api__/"):
            return self._api("GET")
        return super().do_GET()

    def do_POST(self):
        if self.path.split("?", 1)[0].startswith("/__api__/"):
            return self._api("POST")
        self._err("method not allowed", 405)

    def do_PUT(self):
        if self.path.split("?", 1)[0].startswith("/__api__/"):
            return self._api("PUT")
        self._err("method not allowed", 405)

    def do_DELETE(self):
        if self.path.split("?", 1)[0].startswith("/__api__/"):
            return self._api("DELETE")
        self._err("method not allowed", 405)

    def log_message(self, fmt, *args):
        # 静音 API 噪音，仅打印静态请求
        try:
            first = str(args[0]) if args else ""
            if "/__api__/" in first:
                return
        except Exception:
            pass
        super().log_message(fmt, *args)


class ReuseServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    os.chdir(ROOT)
    with ReuseServer(("", PORT), Handler) as httpd:
        print("serving http://localhost:%d/  (Cache-Control: no-store)" % PORT)
        print("版本库后端：/__api__/versions  (本地写文件；静态部署不含此接口)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
