# AI 素材生成管线（ComfyUI）

把 AI 出图接进项目素材流程：**生成大图 → 自动处理成游戏内规格（透明底、像素对齐）→ 落到 `versions/<ver>/assets/`**。

---

## ⚠️ 重要结论：当前环境无法生成「指定形状的物品」

2026-10 实测（8 seed × 同一提示词）后的结论，**请先读这一节再决定用不用这套管线**。

### 实验

提示词明确限定形状：

```
ONE ancient chinese straight sword only, vertical blade pointing up,
crossguard, handle at bottom, ...
```

同一提示词跑 8 个 seed，把结果画成剪影（`#`=前景）：

| seed | 实际形状 | 是不是剑 |
|---|---|---|
| 300 | 团状块 | ✗ |
| 301 | 对称扇/花形 | ✗ |
| 302 | 不规则团 | ✗ |
| 303 | 菱形/宝石状 | ✗ |
| 304 | **人形**（头+身+腿） | ✗ |
| 305 | 徽章/纹章 | ✗ |
| 306 | 方形盾牌 | ✗ |
| 307 | 环形/杯状 | ✗ |

**0/8 命中。** 这不是提示词没调好——是模型的能力边界：
它只产出训练集里泛化的「像素游戏剪影模板」，对具体物品轮廓没有响应。

### 对应的失败模式

| 现象 | 真实原因 |
|---|---|
| 铁剑/古书/玉佩出来是人物 | 模型直接输出的就是人形剪影，不是后处理造成的 |
| 长枪成了带扇状物的弯曲棍 | 模型拼贴了「法杖+装饰」，与提示词无关 |
| 木盾/红宝石/蓝宝石反而正常 | 圆形、块状是模型最擅长的形状；**越接近圆形越可能成功** |
| 换 seed 「挑一个」 | 偶尔碰到像的（如某次铁剑出了竖杆+横条），但不可重复，不可量产 |

### 像素指标不能代替肉眼看形状

`analyze.mjs` 的 `bboxFill`、`blobs` 等只能判断「糊不糊、散不散」，
**不能判断「形状对不对」**。曾出现指标全部合格（单主体、填充紧凑）而实际是个人形/圆盘的情况。
质检只能筛掉废图，不能保证选对图 —— **必须人工肉眼看**。

### 现在能用它做什么

| ✅ 可以 | ❌ 不要指望 |
|---|---|
| 圆形/块状物：宝石、盾、圆牌、钱币 | 有明确轮廓的武器（剑/枪/弓） |
| 抽象材质纹理（石头、布料、木纹） | 书、卷轴、钥匙、工具等结构件 |
| 大面积背景/地形纹理 | 需要严格透视或对称的物件 |
| 角色头像的「风格参考」（仍需人工修） | 同一角色的多帧一致性 |

实测在本项目 **8 张里只有 3 张可用**（木盾、红宝石、蓝宝石）。

### 要真正解决形状问题，需要（当前都不具备）

1. **ControlNet**（`control_v11p_sd15_canny` / `lineart` + 对应 SD1.5 底模）
   —— 先程序画出精确剪影，再让 AI 在剪影内上色，形状就 100% 可控。
   但当前 `models/controlnet/` 是空目录，需下载 ~1.5GB。
2. **专用 LoRA**（像素风中式兵器）—— 需自己准备数据集训练。
3. **改用程序化绘制** —— 对 32×32 图标来说，手写/脚本生成往往比调 AI 更快更准。

**如果你只是要几把武器图标，程序化生成或手绘比调这个管线快得多。**

---

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

---

## 备选方案：程序化生成（`procgen.mjs`）

鉴于上面 AI 对形状完全不可控，**32×32 这类小图标建议直接程序化绘制**：

```bash
node tools/aigen/procgen.mjs
```

输出 `_aigen/proc/*.png` 与 8 倍放大的 `_aigen/程序化图标.png`。

当前内置形状：`ironSword`（铁剑）、`spear`（长枪）、`book`（古书）、`jadePendant`（玉佩）、`potion`（药瓶）。

对比实测：

| 方案 | 形状正确率 | 可复现 | 成本 |
|---|---|---|---|
| AI（当前 checkpoint） | **0/8** | 否（换 seed 全靠运气） | 每张 2–23s + 人工筛 |
| 程序化 `procgen` | **5/5** | 是（确定性输出） | 瞬时 |

新增形状只需在 `SHAPES` 里加一个函数，用 `line` / `poly` / `disc` / `outline` 原语描出来：

```js
function myItem(size) {
  const c = canvas(size), s = size / 32;
  poly(c, [[8*s, 8*s], [24*s, 8*s], [24*s, 24*s], [8*s, 24*s]], P.steel);
  outline(c);              // 描深色边：像素图标关键，也保证抠底不渗
  return c;
}
```

> `line()` 会先把坐标取整；若传浮点会无限循环（已修复）。`w <= 0` 直接返回。

何时仍该用 AI：需要材质纹理、光照渐变、大面积背景（这些程序化难画且没必要手动画）。
