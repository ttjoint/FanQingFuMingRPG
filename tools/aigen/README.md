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

`tools/aigen/prompts.mjs` 的 `KINDS`（参数经像素分析验证，非拍脑袋）：

| kind | 用途 | 游戏内尺寸 | AI 出图 | steps | cfg | 量化级 |
|---|---|---|---|---|---|---|
| `item` | 物品图标 | 32×32 | **256** | 26 | 7 | 6 |
| `skill` | 技能图标 | 34×34 | **256** | 26 | 7 | 6 |
| `face` | 角色头像 | 63×80 | 384 | 28 | 7 | 8 |
| `unit` | 角色立绘/格子精灵 | 64×64 | 384 | 28 | 7 | 8 |
| `prop` | 场景物件 | 64×64 | **256** | 26 | 7 | 8 |

> 尺寸取自现有资产的真实规格（PNG IHDR 读出）。
> 出图尺寸从 512 降到 256 是**关键改动**：512 下 @32 有 200~600 色（细节过载，缩小崩坏），
> 256+cfg7 降到 108~365 色，处理后成品只剩 **26~47 色**（手绘基线 169 色）。

## 提示词：经实测踩过的坑

| 做法 | 结果 |
|---|---|
| 写 `pixel art` / `16-bit` / `32x32 sprite` | ❌ 模型理解成「给照片套像素滤镜」，产出 2~4 万色细节图 |
| 写 `flat design / cartoon / bold colors / thick outline / simple silhouette` | ✅ 简单剪影，缩小后可辨识 |
| 漏写 `no frame / no pedestal / no shadow / no decoration` | ❌ 模型爱加展示台与边框（实测左下角出现方形装饰块） |
| 漏写 `thick dark outline` | ❌ 白发/白袍与背景同色且**无描边分隔**，抠图必被烧掉 |

## 后处理链（`tools/aigen/png.mjs`）

```
原始大图
 → centerSquare(ratio)      取中心方形区域
 → floodKey(BFS)            从画布四边洪水填充抠底（保白发/白袍，见下）
 → trimBox                  按不透明像素裁紧致包围盒
 → areaDown                 块平均下采样（保留明度结构，比最近邻好）
 → quantize(levels)         颜色量化到 6~8 级（4 万色 → 几十色）
 → 居中到目标画布
```

### 抠底为什么不能用简单色键

旧实现 `chromaKey` 把所有「接近背景色」的像素删掉 —— **白发、白袍、玉质高光会被一起烧成窟窿**。

新实现 `floodKey` 从四边**洪水填充**，只删「与边缘连通」的背景；被描边包围的白色区域保留。

```bash
node tools/aigen/selftest-keying.mjs   # 自检：有描边保住白发 / 大容差下对比旧色键
```

> ⚠️ **物理限制**：若白色区域与背景**无描边直接相邻**，洪水也会从缝隙渗入。
> 这是无法用后处理解决的，只能靠提示词强制 `thick dark outline`。自检会如实报告这一点。

## 自动质检（`tools/aigen/analyze.mjs`）

不靠肉眼，用像素指标判断生成结果能不能用：

| 指标 | 含义 | 合格阈值 |
|---|---|---|
| `palette.at32` | 缩到 32px 后的唯一色数 | ≤ 300 |
| `blobs` | 连通域数量（主体是否唯一） | ≤ 2 |
| `largestRatio` | 最大连通域占画面比 | ≥ 8% |
| `bboxFill` | **bbox 内前景填充率** | ≥ 45% |

`bboxFill` 是最有用的一个：它直接量化「散不散」。
例如失败的铁剑 bbox 240×200 但前景只占 26%，`bboxFill=35%` —— 画面被稀疏碎点占满，
缩小后必然散成噪点；而药瓶 `bboxFill=75%`，结构紧实。

`gen` 输出时自动跑质检并打印警告；配 `--retry N` 可在不合格时自动换 seed 重来：

```bash
node tools/aigen/cli.mjs gen item "chinese iron sword" --seed 101 --retry 5
# seed 101 质检不合格（bbox填充=35%）→ 重试
# seed 102 质检不合格（bbox填充=41%）→ 重试
# seed 103 通过（bbox填充=73%）
```

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
- **模型对具体物品形状控制有限**：同一提示词不同 seed 可能给出完全不同的东西（圆形当剑）。
  所以必须依赖 `analyze.mjs` 质检 + `--retry` 自动筛，而不是相信单次结果。
- 提示词模板是英文偏通用；中式细节（发冠、甲片、纹样）需要靠 `extra` 补充强调。
- 流程未接 CI：`tools/aigen/` 不参与 `check-arch` 与单测，属于开发期工具。
  `selftest-keying.mjs` 可单独跑。
