#!/usr/bin/env python3
"""用本机 LM Studio 的视觉模型查看图片。

存在理由：主模型无法查看图片，调试像素素材时只能靠数值指标推断，
而指标判断不了「形状对不对」（曾出现指标全合格、实际是人形的情况）。
这里借 LM Studio 的 gemma-4 做视觉复核。

用法：
    python tools/vlook.py <图片路径> "<问题>"
    python tools/vlook.py _aigen/格子预览.png "这张图里每个图标画的是什么？"

要点：
- reasoning_effort=none 会关闭思考链，实测 28.1s → 5.2s（快 5 倍），
  且 content 直接有内容；不关时 content 为空、答案全在 reasoning_content 里。
- 需先启动 LM Studio 本地服务（默认 127.0.0.1:1234）。
"""
import base64
import json
import sys
import urllib.error
import urllib.request

URL = "http://127.0.0.1:1234/v1/chat/completions"
MODEL = "gemma-4-e4b-uncensored-hauhaucs-aggressive"


def look(path, prompt, max_tokens=900, timeout=400):
    """把图片交给视觉模型，返回文字描述。"""
    with open(path, "rb") as f:
        img = base64.b64encode(f.read()).decode()
    body = {
        "model": MODEL,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64," + img}},
        ]}],
        "temperature": 0.1,
        "max_tokens": max_tokens,
        "reasoning_effort": "none",   # 关闭思考链，快 5 倍
    }
    req = urllib.request.Request(
        URL, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=timeout))
    m = r["choices"][0]["message"]
    return (m.get("content") or "").strip() or (m.get("reasoning_content") or "").strip()


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    try:
        print(look(sys.argv[1], sys.argv[2]))
    except urllib.error.URLError as e:
        print("无法连接 LM Studio（%s）。请先启动本地服务。" % e, file=sys.stderr)
        sys.exit(1)
