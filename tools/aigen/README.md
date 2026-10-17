# AI 素材生成管线（ComfyUI）

把 AI 出图接进项目素材流程：**生成大图 → 自动处理成游戏内规格（透明底、像素对齐）→ 落到 `versions/<ver>/assets/`**。

## 前置：本地 ComfyUI

本项目用**便携版 ComfyUI**（自带 Python，不污染系统环境）：

```
D:/Projects/ComfyUI_windows_portable/
  python_embeded/python.exe
  ComfyUI/main.py
```

模型**不重复下载**，通过 `extra_model_paths.yaml` 复用 Comfy-Desktop 安装里的模型：

```yaml
comfy_desktop:
    base_path: D:/Comfy-Desktop/ComfyUI-Installs/comfyui/ComfyUI/
    checkpoints: models/checkpoints
    loras: models/loras
    vae: models/vae
```

> ⚠️ 该 YAML **必须是纯 ASCII**：ComfyUI 用系统 GBK 编码读取，含中文注释会 `UnicodeDecodeError` 直接崩。

### 启动

```bash
node tools/aigen/cli.mjs serve     # 后台拉起并等待就绪（默认 127.0.0.1:8199）
node tools/aigen/cli.mjs status    # 探活 + 列出 checkpoint
```

- 默认端口 **8199**（8188 在部分 Windows 上被 WinNAT/Hyper-V 保留，bind 会 `WinError 10013`）。
- 环境变量：`COMFY_URL`、`COMFY_CKPT`、`COMFY_PORTABLE`。
- 首次加载模型约 40–50s，之后单张 **7–23s**（RTX 4060 Laptop）。
- 日志：`_aigen/comfy.log`。

## 用法

```bash
# 单个素材
node tools/aigen/cli.mjs gen item "rusty iron sword, chinese ancient blade" --seed 777
node tools/aigen/cli.mjs gen face "young chinese swordsman" --out _aigen/out/hero.png

# 批量（见 tools/aigen/jobs.example.json）
node tools/aigen/cli.mjs batch tools/aigen/jobs.example.json

# 候选图拼成放大预览长图，便于肉眼挑选
node tools/aigen/cli.mjs sheet --dir _aigen/cand --scale 8

node tools/aigen/cli.mjs kinds     # 列出素材类别与目标尺寸
```

输出三件套（同名前缀）：

| 文件 | 内容 |
|---|---|
| `xxx.png` | **成品**，已裁切抠底缩放到游戏规格 |
| `xxx.raw.png` | AI 原图 512×512（留档，方便重处理） |
| `xxx.json` | 提示词、seed、尺寸、prompt_id（可复现） |

## 素材类别与目标规格

`tools/aigen/prompts.mjs` 的 `KINDS`：

| kind | 用途 | 游戏内尺寸 | AI 出图 |
|---|---|---|---|
| `item` | 物品图标 | 32×32 | 512 |
| `skill` | 技能图标 | 34×34 | 512 |
| `face` | 角色头像 | 63×80 | 512 |
| `unit` | 角色立绘/格子精灵 | 64×64 | 512 |
| `prop` | 场景物件 | 64×64 | 512 |

> 尺寸取自现有资产的真实规格（用 PNG IHDR 读出来的），不是估的。

## 后处理链（`tools/aigen/png.mjs`）

零依赖，自实现 PNG 解码/编码（8bit RGB/RGBA/灰度，非隔行）+ 像素操作：

```
原始大图
 → centerSquare(ratio)      取中心方形区域
 → detectBackground         四角众数取背景色
 → chromaKey                按色键抠成透明（带边缘柔化）
 → trimBox                  按不透明像素裁紧致包围盒
 → fitCentered(size)        等比缩放（最近邻，保持像素锐利）+ 居中到目标画布
 → encodePNG
```

全部用**最近邻**缩放，不用双线性——否则像素风会被糊掉。

## 与内容管线的衔接

生成物是普通 PNG，直接放进 `versions/<版本>/assets/<目录>/` 即可被编辑器/游戏读取：

| 类别 | 落盘目录 |
|---|---|
| `item` | `assets/items_icons/` |
| `skill` | `assets/skill_icons/` |
| `face` | `assets/face/` |
| `unit` | `assets/role/` |

**建议流程**：生成 → `sheet` 预览挑选 → 手工挑优 → 复制到对应 assets 目录 → 编辑器里引用。
不要自动覆盖已有美术资源。

## OpenWebUI 作为补充

OpenWebUI 里挂的生图模型（较贵）适合**少量高价值单张**（封面、主视觉、角色立绘），
不适合批量图标。做法：用它生成大图，再喂给本管线的后处理：

```js
import { decodePNG, encodePNG, toIcon } from "./tools/aigen/png.mjs";
// img = decodePNG(手头的大图 buffer)
const icon = encodePNG(toIcon({ img, size: 32 }));
```

## 已知限制

- 单一 checkpoint（`aziibpixelmix_v10`，像素风），无 LoRA：**角色一致性弱**，同一角色的多帧/多角度难稳定。
  需要一致性时建议后续训 LoRA 或改用 ControlNet 约束姿态。
- 提示词模板是英文偏通用；中式细节（发冠、甲片、纹样）需要靠 `extra` 补充强调。
- 流程未接 CI：`tools/aigen/` 不参与 `check-arch` 与单测，属于开发期工具。
