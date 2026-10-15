#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_assets.py —— 为网页版《国殇之血色狼烟》生成静态资源 (assets/)

用法（在本项目根目录）:
    python build_assets.py [游戏根目录] [输出目录]
    例: python build_assets.py . assets

生成:
    assets/atlas.png / atlas.json      地面图块图谱（10 列，64x32）
    assets/obj.png                    对象大图集（建筑/树木/装饰）
    assets/maps/*.json                 地图（表头 + 格子 + 对象 + NPC 出生点）
    assets/maps_manifest.json          全部场景清单（原游戏 map/ 下所有 *.map）
    assets/game.json                   标题/结局配置（片头闪屏、评价称号、音乐）
    assets/chars.json                  角色模型 -> 动作 -> 帧序列（PNG 名）
    assets/role/*.png                  角色帧（品红已透明）
    assets/npcs.json / items.json / skills.json
    assets/face/*.png                  头像
    assets/items_icons/*.png           物品图标
    assets/skill_icons/*.png           技能图标
    assets/scripts.json                全部 .gsp 文本
"""
import os, sys, json, struct, re, shutil, subprocess
from PIL import Image, ImageChops

# ------------------------------------------------------------------ helpers
def cstr(buf, off, maxlen=64):
    end = buf.find(b"\x00", off)
    if end < 0 or end - off > maxlen:
        end = min(len(buf), off + maxlen)
    return buf[off:end].decode("gbk", "replace")

def clean_seg(p):
    """去掉段首的 0xCC/0xCD 填充（仅当是连续 2 个以上同字节时）。"""
    if len(p) >= 2 and p[0] == p[1] and p[0] in (0xCC, 0xCD):
        i = 0
        while i < len(p) and p[i] in (0xCC, 0xCD):
            i += 1
        p = p[i:]
    return p.decode("gbk", "replace")

def search_str(buf, pattern, region=0x80):
    """在 buf 前 region 字节里找匹配 pattern 的 C 字符串（去掉 0xCC/0xCD 填充）。"""
    m = re.search(pattern, buf[:region])
    if not m:
        return ""
    raw = m.group(1)
    return raw.replace(b"\xcc", b"").replace(b"\xcd", b"").decode("gbk", "replace")

def key_magenta(im):
    """把 #FF00FF 品红设为透明。"""
    im = im.convert("RGBA")
    r, g, b, a = im.split()
    mr = r.point(lambda v: 255 if v > 200 else 0)
    mb = b.point(lambda v: 255 if v > 200 else 0)
    mg = g.point(lambda v: 255 if v < 100 else 0)
    mask = ImageChops.multiply(mr, ImageChops.multiply(mb, mg))
    im.putalpha(ImageChops.invert(mask))
    return im

def copy_trans(parent, src, name):
    if not os.path.exists(src):
        return False
    key_magenta(Image.open(src)).save(os.path.join(parent, name))
    return True

# ------------------------------------------------------------------ agp
def load_tile_order(root):
    path = os.path.join(root, "res", "tiles.agp")
    d = open(path, "rb").read()
    doff = struct.unpack_from("<I", d, 4)[0]
    off, order = 12, []
    while off < doff:
        nl = struct.unpack_from("<I", d, off + 16)[0]
        name = d[off + 24:off + 24 + nl].decode("gbk", "replace")
        if re.match(r"s\d{6}\.bmp$", name):
            order.append(name)
        off += 24 + nl + 1
    return order

# ------------------------------------------------------------------ map
def parse_map(path):
    d = open(path, "rb").read()
    assert d[:4] == b"2pam"
    w = struct.unpack_from("<I", d, 0x38)[0]
    c1 = struct.unpack_from("<I", d, 0x3C)[0]
    c2 = struct.unpack_from("<I", d, 0x40)[0]
    cells = []
    g = 0x5C
    for i in range(w * w):
        row, col, sx, sy, dx, dy = struct.unpack_from("<6i", d, g + i * 32)
        flag, packed = struct.unpack_from("<2I", d, g + i * 32 + 0x18)
        cells.append(dict(row=row, col=col, sx=sx, sy=sy,
                          dx=dx, dy=dy, flag=flag,
                          trigger=packed & 0xFF, map=(packed >> 8) & 0xFF,
                          layer=(packed >> 16) & 0xFF))
    entry = list(struct.unpack_from("<2I", d, 0x44))

    # 对象表1：每个对象 = 若干 64x32 图块 + 目标位置
    o1 = g + w * w * 32
    objects = []
    seen_obj = set()
    for i in range(c1):
        r = d[o1 + i * 276:o1 + (i + 1) * 276]
        count = struct.unpack_from("<I", r, 0x08)[0]
        if count > 30:
            count = 0
        sx0, sy0, dxa, dya, sw, sh = struct.unpack_from("<6i", r, 0xFC)
        tiles = []
        for k in range(count):
            sx, sy = struct.unpack_from("<2I", r, 0x0C + k * 8)
            tiles.append([sx, sy, sx - sx0 + dxa, sy - sy0 + dya])
        key = (sx0, sy0, dxa, dya, sw, sh)
        if key in seen_obj:      # 地图里有完全重复的记录，去重
            continue
        seen_obj.add(key)
        if tiles or (sw > 0 and sh > 0):
            objects.append(dict(sprite=[sx0, sy0, sw, sh, dxa, dya], tiles=tiles))

    # 对象表2：NPC 出生点 [npcIndex, .., col, row]
    o2 = o1 + c1 * 276
    spawns = []
    for i in range(c2):
        f = struct.unpack_from("<8I", d, o2 + i * 32)
        if 1 <= f[0] <= 500:
            spawns.append(dict(npc=f[0], row=f[6], col=f[7]))

    return dict(name=os.path.basename(path), width=w, music=cstr(d, 0x4C, 16),
                entry=entry, cells=cells, objects=objects, spawns=spawns)

# ------------------------------------------------------------------ pmg
ACTION_CODE = {"st": "stand", "wlk": "walk", "run": "run", "at": "fight", "die": "die"}

def parse_pmg(path):
    """按动作名区间解析 pmg 帧列表，并读出“每方向帧数 perDir”。
    兼容 npcNNN_ / 名字_ / mapNNN_ 等命名；不对帧去重（同帧可能被多个方向复用）。"""
    d = open(path, "rb").read()
    states = ["stand", "walk", "run", "fight", "die"]
    marks = []
    for s in states:
        pat = s.encode() + b"\x00"
        k = 0
        while True:
            j = d.find(pat, k)
            if j < 0:
                break
            if j >= 0x9E8:
                marks.append((j, s))
            k = j + 1
    marks.sort()
    groups, per_dir = {}, {}
    for idx, (pos, s) in enumerate(marks):
        nxt = marks[idx + 1][0] if idx + 1 < len(marks) else len(d)
        e = d.find(b"*end*\x00", pos, nxt)
        seg = d[pos:(e if e >= 0 else nxt)]
        frames = []
        for part in seg.split(b"\x00"):
            while len(part) >= 2 and part[0] == part[1] and part[0] in (0xCC, 0xCD):
                b = part[0]
                j = 0
                while j < len(part) and part[j] == b:
                    j += 1
                part = part[j:]
            if part.endswith(b".bmp"):
                name = part.decode("gbk", "replace")
                if len(name) < 64:
                    frames.append(name)
        if frames:
            m = re.search(rb"[ -~\x81-\xfe][ -~\x81-\xfe]{2,}\.bmp", seg)
            if m and m.start() >= 8:
                per, total = struct.unpack_from("<2I", seg, m.start() - 8)
                if 0 < per <= 64:
                    per_dir[s] = per
            groups[s] = frames
    return groups, per_dir

def split_dirs(frames, per):
    """按“每方向帧数 per”切成若干方向块；未知时退回单块。"""
    if per and per > 0 and len(frames) >= per and len(frames) % per == 0:
        return [frames[i * per:(i + 1) * per] for i in range(len(frames) // per)]
    return [frames]

# ------------------------------------------------------------------ data tables
def parse_items(root):
    d = open(os.path.join(root, "data", "items.itm"), "rb").read()
    n = struct.unpack_from("<I", d, 4)[0]
    out = []
    for i in range(n):
        r = d[8 + i * 272:8 + (i + 1) * 272]
        g = lambda o: struct.unpack_from("<I", r, o)[0]
        out.append(dict(name=cstr(r, 0x00, 52), price=g(0x34), desc=cstr(r, 0x38, 100),
                        type=g(0xD0), subtype=g(0xD4), icon=cstr(r, 0xD8, 24),
                        reqLevel=g(0xE8), hp=g(0xEC), mp=g(0xF0),
                        attack=g(0xF8), defence=g(0xFC),
                        attrA=g(0x104), attrB=g(0x108), attrC=g(0x10C)))
    return out

def parse_skills(root):
    d = open(os.path.join(root, "data", "skill.skl"), "rb").read()
    n = struct.unpack_from("<I", d, 4)[0]
    out = []
    for i in range(n):
        r = d[8 + i * 516:8 + (i + 1) * 516]
        g = lambda o: struct.unpack_from("<I", r, o)[0]
        sound = clean_seg(r[0xAC:].split(b"\x00")[0])
        parts = [clean_seg(p) for p in r[0xAC:].split(b"\x00")]
        bmps = [p for p in parts if p.lower().endswith(".bmp")]
        icon = bmps[0] if bmps else ""
        frames = [p for p in bmps[1:]]
        out.append(dict(name=cstr(r, 0x00, 51), desc="", type=g(0x98), range=g(0x9C),
                        mp=g(0xA0), reqLevel=g(0xA4), power=g(0xA8),
                        sound=sound, icon=icon, frames=frames))
    return out

def parse_npcs(root):
    d = open(os.path.join(root, "data", "npc.npc"), "rb").read()
    n = struct.unpack_from("<I", d, 4)[0]
    out = []
    for i in range(n):
        r = d[8 + i * 2208:8 + (i + 1) * 2208]
        g = lambda o: struct.unpack_from("<I", r, o)[0]
        model = cstr(r, 0x24, 24)
        portrait = cstr(r, 0x33, 24)
        script = cstr(r, 0x42, 24)
        out.append(dict(id=g(0x00), name=cstr(r, 0x04, 20),
                        model=model if ".pmg" in model else "",
                        portrait=portrait if ".bmp" in portrait else "",
                        script=script if ".gsp" in script else "",
                        hp=g(0x54), attack=g(0x58), hostile=g(0x5C), defence=g(0x60),
                        level=g(0x64), exp=g(0x68), ai=g(0x70),
                        skills=cstr(r, 0x74, 24), talks=parse_talks(r)))
    return out

def parse_talks(r, limit=0x400):
    """+0x74 起是一串空闲对白（引擎每次随机选一条）。敌人为 '*/*'。"""
    out = []
    o = 0x74
    while o < min(len(r), limit):
        # 跳过填充：只跳过 ≥2 个相同 0xCC/0xCD（0xCC 也是“天”的首字节，不能单跳）
        while o + 1 < len(r) and r[o] == r[o + 1] and r[o] in (0xCC, 0xCD):
            b = r[o]
            j = 0
            while o + j < len(r) and r[o + j] == b:
                j += 1
            o += j
        if o >= len(r):
            break
        e = r.find(b"\x00", o)
        if e < 0:
            break
        raw = r[o:e]
        if raw == b"*/*":
            break
        try:
            s = raw.decode("gbk")
        except Exception:
            o = e + 1
            continue
        if len(s) >= 2 and not any(ord(c) < 32 for c in s):
            out.append(s)
        o = e + 1
        if len(out) >= 12:
            break
    return out

def parse_scripts(root):
    sd = os.path.join(root, "extracted", "script")
    out = {}
    for fn in os.listdir(sd):
        out[fn.replace(".txt", "")] = open(os.path.join(sd, fn), encoding="utf-8").read()
    return out

def parse_transitions(root):
    """scripts.ini: 地图触发器编号 -> 进入地图时执行的脚本。"""
    path = os.path.join(root, "extracted", "ini", "scripts.ini.txt")
    out = {}
    if not os.path.exists(path):
        return out
    for line in open(path, encoding="utf-8"):
        m = re.match(r"\s*(\d+)\s*=\s*(.+?)\s*$", line)
        if m and m.group(2).endswith(".gsp"):
            out[int(m.group(1))] = m.group(2)
    return out

def parse_maps_ini(root):
    """maps.ini 顺序：0x1D 字段就是这里的序号（1-based）。"""
    path = os.path.join(root, "extracted", "ini", "maps.ini.txt")
    out = {}
    if not os.path.exists(path):
        return out
    for line in open(path, encoding="utf-8"):
        m = re.match(r"\s*(\d+)\s*=\s*(\S+?\.map)", line)
        if m:
            out[int(m.group(1))] = m.group(2)[:-4]
    return out

def parse_game_ini(root):
    """game.ini：标题/结局音乐、片头闪屏、结局背景图、结局评价称号。"""
    path = os.path.join(root, "extracted", "ini", "game.ini.txt")
    out = {"music": {}, "flash": [], "endpic": None, "result": []}
    if not os.path.exists(path):
        return out
    section = None
    result_count = 0
    rows = {}
    for raw in open(path, encoding="utf-8"):
        line = raw.strip()
        if not line:
            continue
        m = re.match(r"\[(.+?)\]", line)
        if m:
            section = m.group(1).strip().lower()
            continue
        m = re.match(r"([^=]+)=(.*)", line)
        if not m:
            continue
        key, val = m.group(1).strip(), re.split(r"\s*//", m.group(2))[0].strip()
        if section == "music":
            out["music"][key.lower()] = os.path.basename(val)
        elif section == "background" and key.lower() == "endpic":
            out["endpic"] = os.path.basename(val)
        elif section.startswith("flashwindow"):
            if val and val.lower() != "null":
                out["flash"].append(os.path.basename(val))
        elif section == "result":
            if key.lower() == "count":
                result_count = int(val)
            else:
                mm = re.match(r"(lower|upper|name)(\d+)", key.lower())
                if mm:
                    rows.setdefault(int(mm.group(2)), {})[mm.group(1)] = val
    for i in range(1, result_count + 1):
        r = rows.get(i, {})
        out["result"].append({"lower": int(r.get("lower") or 0),
                              "upper": int(r.get("upper") or 0),
                              "name": r.get("name", "")})
    return out

# ------------------------------------------------------------------ main
def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, "web", "assets")
    ex = os.path.join(root, "extracted")
    os.makedirs(out, exist_ok=True)

    # ---- 地形图谱 ----
    order = load_tile_order(root)
    COLS = 10
    atlas = Image.new("RGBA", (COLS * 64, ((len(order) + COLS - 1) // COLS) * 32), (0, 0, 0, 0))
    for i, n in enumerate(order):
        p = os.path.join(ex, "tiles", n[:-4] + ".png")
        if os.path.exists(p):
            atlas.alpha_composite(key_magenta(Image.open(p)), ((i % COLS) * 64, (i // COLS) * 32))
    atlas.save(os.path.join(out, "atlas.png"))
    json.dump(dict(cols=COLS, tileW=64, tileH=32, order=order),
              open(os.path.join(out, "atlas.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print("atlas:", len(order), "tiles")

    # ---- 对象图谱 ----
    obj = key_magenta(Image.open(os.path.join(ex, "tiles", "obj.png")))
    obj.save(os.path.join(out, "obj.png"))
    print("obj atlas:", obj.size)

    # ---- 地图 ----
    os.makedirs(os.path.join(out, "maps"), exist_ok=True)
    md = os.path.join(root, "map")
    map_manifest = []
    for fn in sorted(os.listdir(md)):
        if fn.endswith(".map"):
            m = parse_map(os.path.join(md, fn))
            json.dump(m, open(os.path.join(out, "maps", fn[:-4] + ".json"), "w", encoding="utf-8"),
                      ensure_ascii=False)
            map_manifest.append(fn[:-4])
            print("map:", fn, m["width"], "x", m["width"], "objs", len(m["objects"]), "spawns", len(m["spawns"]))
    # 全部场景清单：网页版据此加载原游戏的全部地图（包括未被脚本直接引用的场景）
    json.dump(map_manifest, open(os.path.join(out, "maps_manifest.json"), "w", encoding="utf-8"),
              ensure_ascii=False)

    # ---- 角色模型 ----
    chars = {}
    needed = set()
    data_dir = os.path.join(root, "data")
    for fn in os.listdir(data_dir):
        if fn.endswith(".pmg"):
            groups, per_dir = parse_pmg(os.path.join(data_dir, fn))
            model = fn[:-4]
            acts = {}
            for a, frames in groups.items():
                acts[a] = split_dirs(frames, per_dir.get(a))
                for block in acts[a]:
                    needed.update(block)
            chars[model] = acts
    json.dump(chars, open(os.path.join(out, "chars.json"), "w", encoding="utf-8"), ensure_ascii=False)

    # 角色帧先做品红抠图，再从“抠图后”的 alpha 包围盒计算锚点。
    # 注意：必须在抠图之后再取 bbox，否则品红底会被当成不透明像素，
    # 导致锚点退化成“画布中心/底边”，角色身体并不在画布中心 -> 动作切换时错位。
    os.makedirs(os.path.join(out, "role"), exist_ok=True)
    keyed = {}
    for n in sorted(needed):
        src = os.path.join(ex, "role", n[:-4] + ".png")
        if not os.path.exists(src):
            continue
        imm = key_magenta(Image.open(src))
        keyed[n] = imm
        imm.save(os.path.join(out, "role", n.replace(".bmp", ".png")))

    # 锚点 = (该“动作+方向”块内各帧包围盒中心的【中位数】, 该帧包围盒【底边】)。
    #   x 用整块中位数：一帧内挥剑/摆臂不会让角色左右抽动；
    #   y 用逐帧底边  ：保留抬脚/下蹲/倒地等真实竖直运动，同时脚永远踩在单位坐标上；
    #   每个动作各自取中心：站立/行走/奔跑/攻击/倒地之间身体中心能对齐。
    anchors = {}
    for model, acts in chars.items():
        for a, blocks in acts.items():
            for block in blocks:
                rows = []
                for f in block:
                    imm = keyed.get(f)
                    if imm is None:
                        continue
                    rows.append((f, imm.getbbox()))
                if not rows:
                    continue
                centers = sorted((bb[0] + bb[2]) // 2 for _, bb in rows if bb)
                mx = centers[len(centers) // 2] if centers else 0
                for f, bb in rows:
                    imm = keyed[f]
                    anchors[f] = [mx, bb[3]] if bb else [imm.width // 2, imm.height]
    json.dump(anchors, open(os.path.join(out, "anchors.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print("chars:", len(chars), "frames:", len(anchors))

    # ---- 头像 ----
    os.makedirs(os.path.join(out, "face"), exist_ok=True)
    fsrc = os.path.join(ex, "face")
    for fn in os.listdir(fsrc):
        copy_trans(os.path.join(out, "face"), os.path.join(fsrc, fn), fn)
    print("faces:", len(os.listdir(os.path.join(out, "face"))))

    # ---- 数据表 ----
    items = parse_items(root)
    skills = parse_skills(root)
    npcs = parse_npcs(root)
    json.dump(items, open(os.path.join(out, "items.json"), "w", encoding="utf-8"), ensure_ascii=False)
    json.dump(skills, open(os.path.join(out, "skills.json"), "w", encoding="utf-8"), ensure_ascii=False)
    json.dump(npcs, open(os.path.join(out, "npcs.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print("items:", len(items), "skills:", len(skills), "npcs:", len(npcs))

    # ---- 物品 / 技能图标 ----
    os.makedirs(os.path.join(out, "items_icons"), exist_ok=True)
    for it in items:
        if it["icon"]:
            copy_trans(os.path.join(out, "items_icons"),
                       os.path.join(ex, "items", it["icon"].replace(".bmp", ".png")),
                       it["icon"].replace(".bmp", ".png"))
    os.makedirs(os.path.join(out, "skill_icons"), exist_ok=True)
    for sk in skills:
        if sk["icon"]:
            copy_trans(os.path.join(out, "skill_icons"),
                       os.path.join(ex, "skill", sk["icon"].replace(".bmp", ".png")),
                       sk["icon"].replace(".bmp", ".png"))
    # 技能特效帧
    os.makedirs(os.path.join(out, "skill"), exist_ok=True)
    for sk in skills:
        for f in sk["frames"]:
            copy_trans(os.path.join(out, "skill"),
                       os.path.join(ex, "skill", f.replace(".bmp", ".png")),
                       f.replace(".bmp", ".png"))

    # ---- 界面素材 ----
    os.makedirs(os.path.join(out, "ui"), exist_ok=True)
    usrc = os.path.join(ex, "ui")
    if os.path.isdir(usrc):
        for fn in os.listdir(usrc):
            copy_trans(os.path.join(out, "ui"), os.path.join(usrc, fn), fn)
        print("ui:", len(os.listdir(os.path.join(out, "ui"))))

    # ---- 音效 ----
    os.makedirs(os.path.join(out, "sound"), exist_ok=True)
    ssrc = os.path.join(root, "sound")
    if os.path.isdir(ssrc):
        for fn in os.listdir(ssrc):
            if fn.lower().endswith(".wav"):
                shutil.copy2(os.path.join(ssrc, fn), os.path.join(out, "sound", fn))
        print("sounds:", len([f for f in os.listdir(ssrc) if f.lower().endswith('.wav')]))

    # ---- 背景音乐（wma 用 ffmpeg 转 mp3）----
    mdir = os.path.join(root, "music")
    os.makedirs(os.path.join(out, "music"), exist_ok=True)
    if os.path.isdir(mdir):
        have_ff = shutil.which("ffmpeg")
        nm = 0
        for fn in os.listdir(mdir):
            base, ext = os.path.splitext(fn)
            dst = os.path.join(out, "music", base + ".mp3")
            if os.path.exists(dst):
                nm += 1; continue
            if ext.lower() == ".mp3":
                shutil.copy2(os.path.join(mdir, fn), dst); nm += 1
            elif ext.lower() == ".wma" and have_ff:
                try:
                    subprocess.run([have_ff, "-y", "-loglevel", "error", "-i", os.path.join(mdir, fn),
                                    "-codec:a", "libmp3lame", "-q:a", "5", dst], check=True)
                    nm += 1
                except Exception as e:
                    print("  wma 转换失败", fn, e)
        print("music:", nm)

    # ---- 脚本 / 地图触发器 ----
    scripts = parse_scripts(root)
    json.dump(scripts, open(os.path.join(out, "scripts.json"), "w", encoding="utf-8"),
              ensure_ascii=False)
    json.dump(parse_transitions(root), open(os.path.join(out, "transitions.json"), "w", encoding="utf-8"),
              ensure_ascii=False)
    json.dump(parse_maps_ini(root), open(os.path.join(out, "maps_index.json"), "w", encoding="utf-8"),
              ensure_ascii=False)
    json.dump(parse_game_ini(root), open(os.path.join(out, "game.json"), "w", encoding="utf-8"),
              ensure_ascii=False)
    print("scripts:", len(scripts))
    print("done ->", out)

if __name__ == "__main__":
    main()
