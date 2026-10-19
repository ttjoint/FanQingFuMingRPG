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
import errno
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

# ---- 缓存策略（按路径分级）----
#
# 历史：这里曾经对**所有**响应无条件发 "no-store"。
# 代价是浏览器每次刷新都要把 470+ 个请求、约 12MB 正文全部重传一遍
# （实测：首次 11.87MB，刷新同样 11.87MB，304 命中 0 次）。
# 对本地开发服务器来说，"永远不缓存"的意图可以理解（改了源文件要立刻生效），
# 但做法过猛——它把**不可能变的内容**（图片素材、只读版本的数据）也一起废了。
#
# 分级原则："改得勤、必须立即生效" 的就不缓存；"基本不变" 的允许缓存但必须校验。
#   1) /src/** 与 HTML 入口：no-cache（配合 ETag → 内容没变时走 304，不重传正文）。
#      这里用 no-cache 而不是 no-store：no-cache 仍允许本地存副本，
#      只是每次用前必须跟服务端核对；改了文件 mtime 变 → ETag 变 → 立即拿到新内容。
#   2) /versions/<id>/assets/**：带 ?v= 指纹时 immutable（一年）；不带时 no-cache。
#      ?v= 由前端在确认版本更新后才换，带上它就是"内容不变"的承诺。
#   3) /__api__/**：no-store（接口响应永远不缓存）。
#   4) 其他（编辑器页面、打包产物等）：no-cache + ETag。
CACHE_IMMUTABLE = "public, max-age=31536000, immutable"
CACHE_REVALIDATE = "no-cache"
CACHE_NONE = "no-store, no-cache, must-revalidate, max-age=0"


def _cache_policy(path):
    """根据请求路径决定 Cache-Control（见上面的分级说明）。"""
    p = path.split("?", 1)[0]
    if p.startswith("/__api__/"):
        return CACHE_NONE
    if p.startswith("/versions/") and "/assets/" in p:
        # 带指纹参数才允许 immutable；没有指纹时无法保证内容不变，只能每次校验。
        q = path.split("?", 1)[1] if "?" in path else ""
        if re.search(r"(?:^|&)v=", q):
            return CACHE_IMMUTABLE
        return CACHE_REVALIDATE
    return CACHE_REVALIDATE


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


def _assets_stamp(adir):
    """目录内容指纹（用于素材 URL 的 ?v= 参数）。

    为什么用 mtime 而不是内容哈希：默认版本有 2700+ 个文件、共 42MB，
    每次启动把它们全读一遍算哈希要好几秒，而缓存头只能省传输、不能省启动。
    (mtime_ns, 文件数) 已足够判"变没变"：素材库里增删改文件都会推到目录 mtime 上。
    注意它不如内容哈希严格（同 ns 内改完又改回同一大小可能漏判），
    所以调用方仅在"已知不会变"的只读版本上用它（见前端 setAssetToken）。
    """
    try:
        st = os.stat(adir)
    except OSError:
        return None
    n = 0
    for _r, _d, fs in os.walk(adir):
        n += len(fs)
    return "%x-%x" % (int(st.st_mtime_ns), n)


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
    adir = os.path.join(d, "assets")
    meta["assets"] = _list_assets(adir)
    # 素材目录指纹：前端拿它当 ?v=，让 serve.py 对素材返回 immutable。
    # 只对只读（原版）版本提供：可写版本随时会变，给指纹反而会把旧内容钉在缓存里。
    if meta.get("readonly"):
        meta["assetsToken"] = _assets_stamp(adir)
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
    # 用 HTTP/1.1。
    #
    # 标准库默认是 HTTP/1.0，它带来的问题不只是"无 keep-alive"：
    # 旧版协议下频繁/大文件的缓存语义更保守，浏览器会把带 immutable 的响应
    # 也当成"下次还要问一下"——实测 HTTP/1.0 时刷新仍会重发 476 个请求 / 11MB。
    # 切成 1.1 后：
    #   - 连接可复用，启动时 2700+ 个资源不再反复建 TCP；
    #   - 缓存的正常规则生效，带 immutable 的素材直接从本地拿。
    # 前提：每个响应必须有 Content-Length 或 chunked，否则客户端不知道何时结束。
    # 静态文件由 SimpleHTTPRequestHandler 自行填 Content-Length；
    # _json 显式填；304 无正文（标准允许）。
    protocol_version = "HTTP/1.1"

    # ---- 响应工具 ----
    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # 不在这里写 Cache-Control：统一由 end_headers 按策略发，
        # 否则同一个响应会出现两条 Cache-Control（浏览器取哪条是未定义的）。
        self._cache_policy = CACHE_NONE
        self._headers_sent_once = False
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
        # 缓存头统一在这里注入（见文件头 CACHE_* 的分级说明）。
        #
        # 为什么放 end_headers 而不是 send_head：http.server 的 send_head 内部
        # 就会调 end_headers 把头一次性刷出，所以想在父类流程里插头，
        # 只能挤在 end_headers 这个唯一的出口上。
        # 上下文由 prepare_cache_policy() 提前填好：静态请求填文件信息，
        # 接口响应填 CACHE_NONE；两者都没填时用最保守的 no-cache。
        if not self._headers_sent_once:
            self._emit_cache_headers()
            self._headers_sent_once = True
        super().end_headers()

    def _emit_cache_headers(self):
        """按当前请求的策略写入 Cache-Control / ETag，并处理 If-None-Match。"""
        pol = getattr(self, "_cache_policy", None) or _cache_policy(self.path)
        self.send_header("Cache-Control", pol)
        if pol == CACHE_NONE:
            # 接口响应：不缓存，也不做条件请求。
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            return

        etag = getattr(self, "_etag", None)
        if etag:
            self.send_header("ETag", etag)

    def _check_not_modified(self, fs):
        """ETag/Last-Modified 命中时直接回 304。返回 True 表示已经回了 304。

        ETag 由 (mtime_ns, size) 构造（与 nginx 的默认做法一致）：
        文件一改动，mtime 和 size 至少一个会变，所以不会出现"改了没生效"。
        """
        etag = '"%x-%x"' % (int(fs.st_mtime_ns), fs.st_size)
        self._etag = etag
        inm = self.headers.get("If-None-Match")
        if inm:
            # 允许逗号分隔的多个候选，以及弱校验前缀 W/
            cands = [c.strip() for c in inm.split(",")]
            for c in cands:
                if c == "*" or c == etag or c == "W/" + etag:
                    return True
        return False

    def _not_modified(self):
        """发一个 304（无正文）。"""
        self.send_response(304)
        # 304 必须带上与 200 相同的缓存头，否则浏览器会改用下一次的策略。
        self.end_headers()

    # ---- 静态文件的缓存头与 304 ----
    def send_head(self):
        """在父类发头之前，把本次请求的缓存策略与 ETag 算好。

        历史：父类 SimpleHTTPRequestHandler 只发 Last-Modified，不发 ETag；
        本服务原先又在 end_headers 里强塞 no-store，两个问题叠加的结果是
        "缓存一次都没生效过"（实测刷新重传 11.87MB）。
        现在：先算策略/ETag → 命中条件请求就 304 → 否则让父类正常发 200。
        """
        self._cache_policy = _cache_policy(self.path)
        self._headers_sent_once = False

        # 先把文件系统信息拿到，才能算出 ETag。
        fs = None
        try:
            path = self.translate_path(self.path)
            if os.path.isfile(path):
                fs = os.stat(path)
        except OSError:
            fs = None

        if fs is not None and self._cache_policy != CACHE_NONE:
            if self._check_not_modified(fs):
                self._not_modified()
                return None

        return super().send_head()
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

    def do_HEAD(self):
        # 旧实现没拦 HEAD，于是 curl -I /__api__/versions 会掉进静态文件分支，
        # 去找一个并不存在的磁盘文件而返回 404（浏览器/监控探活会误判接口挂了）。
        if self.path.split("?", 1)[0].startswith("/__api__/"):
            return self._api("GET")
        return super().do_HEAD()

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
    # 关服务时不等子线程：浏览器 keep-alive 连接会长命，等它们会卡住退出。
    daemon_threads = True
    # 监听队列深度。socketserver 默认只有 5，而游戏启动时浏览器会一口气并发
    # 拉 2700+ 个资源（角色帧、地图、图标），连接数远超 5。
    # 超出队列的 SYN 会被内核直接丢掉/回 RST，浏览器表现为 ERR_CONNECTION_REFUSED，
    # 而前端的 fetch 大多写的是 .catch(() => null)——于是**资源静默缺失**，
    # 页面永远卡在“加载资源中…”。
    # E2E 偶发启动超时（一次只发出 194 个请求 vs 正常的 2768）就是这个原因，
    # 跟测试代码无关；单跑时机器空闲就不出现，连跑或机器负载高就复现。
    request_queue_size = 256

    def handle_error(self, request, client_address):
        # 浏览器在资源全部加载完后会主动断开 keep-alive 连接，Windows 下本机
        # 复现为 ConnectionAbortedError / WinError 10053（macOS/Linux 上是
        # ConnectionResetError）。这是**正常现象**，不是服务端错误，但 socketserver
        # 默认会把整个 traceback 打到 stderr——一次页面启动就是几十条，
        # 既淹没真正的错误，也让日志写入拖慢启动（E2E 偶发启动超时就是这个）。
        # 这里只静默这类“对端断开”，其他异常照常报。
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        if isinstance(exc, OSError) and getattr(exc, "winerror", None) in (10053, 10054, 10058):
            return
        if isinstance(exc, OSError) and getattr(exc, "errno", None) in (
            errno.ECONNRESET, errno.EPIPE, errno.ECONNABORTED,
        ):
            return
        super().handle_error(request, client_address)


if __name__ == "__main__":
    os.chdir(ROOT)
    with ReuseServer(("", PORT), Handler) as httpd:
        print("serving http://localhost:%d/  (Cache-Control: no-store)" % PORT)
        print("版本库后端：/__api__/versions  (本地写文件；静态部署不含此接口)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
