# AGENTS.md —— 国殇之血色狼烟 / FanQingFuMingRPG

本目录及其子目录下的 pi 会话规则。

## Git：提交后自动推送（重要）

**每次 commit 后必须自动 `git push` 到 `origin`，不需要再问我。**

```bash
git add -A && git commit -m "..." && git push origin <当前分支>
```

- 当前工作分支：`feat/item-effects-system`
- 远端：`https://github.com/ttjoint/FanQingFuMingRPG`
- 推送用默认凭据即可（见下方“凭据”），**不要**把 token 拼进命令行或写进配置。

### 提交前必须全绿

```bash
node tools/check-arch.mjs    # 架构检查
node test/run.mjs            # 单测
npx tsc --noEmit             # 类型检查
```

三项任一失败 → 先修，不要提交。

### 凭据（已修复，勿破坏）

Windows 凭据管理器里曾有 `ttjoint` 和 `momordica2020` 两个 GitHub 账号，
自动取用时选错成 `momordica2020`，导致 `403 Permission denied`。

2026-10 已用 `git credential-manager github logout momordica2020` 移除错误账号，
现在只剩 `ttjoint`（该仓库 admin + push 权限），`git push` 可直接成功。

若再次出现 `403 ... denied to <别的用户名>`：

```bash
git credential-manager github list          # 看有哪几个账号
git credential-manager github logout <错的那个>
```

### 提交历史要干净

不要留下“临时验证”“测试”之类的垃圾提交。验证性提交用完立即
`git reset --hard <正常提交>` 后 `git push --force-with-lease` 清理。

## 浏览器自动化测试（重要）

**禁止**使用 `taskkill //F //IM chrome.exe`、`taskkill /F /IM chrome.exe`、
`Stop-Process -Name chrome` 等按进程名批量结束 Chrome 的命令。
用户可能同时开着正常的 Chrome 浏览器，这些命令会连它一起强杀（曾导致浏览器每几分钟被关闭）。

需要清理测试用的无头 Chrome 时，只用下面这个脚本，它按命令行特征筛选，只结束无头/调试实例：

```bash
# 只结束自己的无头实例（--headless）
tools/kill-chrome.sh

# 只结束占用某个调试端口的实例（推荐，最精确）
tools/kill-chrome.sh --port 9225

# 按 user-data-dir 精确匹配
tools/kill-chrome.sh --user-data-dir /tmp/chrs
```

## 启动无头 Chrome 的推荐姿势

启动前先按端口清理，再用**端口专属**的 user-data-dir，便于精确回收：

```bash
PORT=9225
tools/kill-chrome.sh --port "$PORT"
rm -rf /tmp/chrs
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port="$PORT" \
  --user-data-dir=/tmp/chrs --window-size=1000,760 about:blank \
  >/tmp/chrs.log 2>&1 &
```

测试结束后同样用 `tools/kill-chrome.sh --port "$PORT"` 回收，不要按进程名杀。

## 本地服务

```bash
python serve.py 8005     # 默认端口 8005，不是 8000
```

## 数据文件格式约定

以下文件**必须保持单行紧凑 JSON**（不要格式化换行）：

- `versions/default/assets/npcs.json`
- `versions/default/assets/skills.json`
- `versions/default/assets/scripts.json`
- `versions/default/assets/items.json`

改这些文件用 `JSON.parse` → 修改 → `JSON.stringify` 写回，
不要手工编辑导致格式变化。改完务必 diff 确认只动了目标条目。

## 素材约定

- **不要自动覆盖已有美术素材**（`versions/<ver>/assets/` 下），尤其手绘图。
  生成后先预览 → 人工挑选 → 再复制。
- 图标规格：`32x32`、`depth=8`、`colortype=6`（RGBA），内容 bbox ≤30×30 且居中。
- `items.json` 的 `icon` 字段历史上写的是 `.bmp`，运行时会把 `.bmp` 自动替换成 `.png`，
  所以文件名写 `.bmp` 是对的，实际放 `.png` 文件即可。

## 其它约定

- 测试脚本 / 截图等临时产物请放在项目内并加入 `.gitignore`（如 `_*.mjs`、`_*.png`、`_*.log`），
  不要污染仓库根目录。
- `test/` 和 `test-results/` 已被 gitignore，不跟踪。
- `_aigen/` 是 AI 出图的开发期临时产物，已 gitignore。

## 关于 AI 生成美术（重要背景）

`tools/aigen/` 的 ComfyUI 管线**无法按指定轮廓出图**：
实测同一提示词 8 个 seed，0/8 命中目标形状（给“铁剑”提示词，产出人形/扇/宝石/盾/徽章等）。

- 圆形、块状物（宝石、盾、钱币）→ 大概率可用
- 有明确轮廓的武器/书籍/工具 → 基本不可用
- 根因：单 checkpoint 无 ControlNet，只会输出泛化的“像素游戏剪影模板”
- 详见 `tools/aigen/README.md` 顶部「重要结论」

**32×32 图标优先用 `tools/aigen/procgen.mjs` 程序化绘制**（形状 100% 可控、确定性、瞬时）：

```bash
node tools/aigen/procgen.mjs     # 输出 _aigen/proc/*.png
```

新增形状在 `SHAPES` 里加函数，用 `line` / `poly` / `disc` / `outline` 原语描，
再用 `normalizeIcon()` 规范化到 32×32。
