# 🎵 AuroraMusic — 游戏音乐混音播放器

> ⚠️ **仅供学习使用 · 禁止商用 · 后果自负**（请务必阅读文末 [声明与警告](#️-声明与警告) 章节）

---

## 🎬 功能截图

### 游戏混音控制面板
![游戏混音面板开启状态](https://cdn.jsdelivr.net/gh/JinIilaiQiaoMen/AuroraMusic@main/mix_on.png)

---

## ✨ 项目简介

AuroraMusic 是一款 **Electron + Vue 3** 开发的 **本地音乐播放器 + 游戏内音乐/麦克风混音输出工具**。

设计初衷：**在游戏中按一下快捷键，就能把你正在听的歌通过麦克风播放给队友听**，同时你自己的说话声也能一并混合出去，且不影响你自己听游戏声音与队友语音。

### 🎯 核心特性

| 功能 | 说明 |
|------|------|
| 🎼 本地音乐播放 | 支持 MP3 / FLAC / WAV / APE / M4A / OGG 等主流格式 |
| 🎮 游戏混音输出 | **音乐 + 麦克风** 混合后输入到虚拟麦克风（VB-CABLE），队友同时听到你放的歌与说话声 |
| 🎙️ 独立监听控制 | 本地听到的音量（monitorGain）与输出给队友的音量（musicGain）独立控制 |
| ⚡ 全局快捷键 | 支持配置播放/暂停/切歌/混音开关等热键（如 `Ctrl+Alt+M` 快速开关混音） |
| 🗒️ 播放列表 / 收藏 | 本地歌单管理、按歌手/专辑浏览（SQLite） |
| 🌙 暗黑界面 | Aurora 风格深色主题 |
| 🔌 免驱动内核 | 基于 **BASS 音频引擎 + koffi FFI**，无需编译原生模块即可运行 |

---

## 🏗️ 技术栈

| 层 | 技术 |
|----|------|
| 桌面壳 | Electron 28 |
| 前端 | Vue 3 + Pinia + TypeScript |
| 构建工具 | electron-vite 2 |
| 状态管理 | Pinia |
| 音频引擎 | [BASS](https://www.un4seen.com/) + [BASSmix](https://www.un4seen.com/bass.html#addons)（x64） |
| FFI 桥接 | [koffi](https://koffi.dev/)（替代 ffi-napi，免编译） |
| 录音降噪 | RNNoise（预留接口） |
| 虚拟音频驱动 | VB-CABLE（需单独安装） |
| 数据库 | better-sqlite3 |
| 标签解析 | music-metadata |

---

## 🔊 混音原理

```
┌────────────────────┐
│  AuroraMusic 播放  │
│  _musicStream      │───▶ 默认扬声器（你听到音乐）
└────────────────────┘         │
                               │ 独立音量：monitorGain
                               ▼
┌──────────────────────────────────────────┐
│ VB-CABLE 虚拟驱动                         │
│                                           │
│ ┌──────────────────────────────────────┐  │
│ │ Mixer Stream (VB-CABLE 设备)        │  │
│ │  ├─ musicGain × music decode stream │──┼──▶ VB-CABLE Input  ─┐
│ │  └─ micGain × microphone record     │  │                     │
│ └──────────────────────────────────────┘  │                     │
│                                           │                     ▼
└───────────────────────────────────────────┘           游戏语音采集
                                                        (队友听到)
```

**关键设计**：
- **本地扬声器**：音乐流 `_musicStream` 输出，音量 = musicGain × monitorGain
- **VB-CABLE（给队友）**：混音器 `_mixerStream` 输出，包含 decode 音乐副本 + 麦克风流
- **设备切换**：混音器创建到 VB-CABLE 设备，音乐流创建到默认扬声器设备，互不干扰
- **跨设备混音**：使用 `BASS_STREAM_DECODE` 创建 decode 副本（不绑定设备），可被任何设备的混音器读取

---

## 🚀 快速开始

### 📦 方式一：下载预编译 EXE（推荐普通用户，双击即可运行）

直接到 **[Releases 页面](https://github.com/JinIilaiQiaoMen/AuroraMusic/releases)** 下载打包好的文件：

| 文件 | 说明 | 适用场景 |
|------|------|---------|
| `Aurora Music Setup 0.3.0.exe` | **NSIS 安装版**（双击安装到桌面/开始菜单） | 想长期使用、想要图标的用户 |
| `Aurora Music 0.3.0.exe` | **Portable 免安装版**（双击直接运行） | 拷给朋友、U 盘随身用 |

> 💡 **一键启动**：下载后**双击 exe** 即可打开，无需安装 Node.js、无需 npm install！
>
> 安装完成后，桌面和开始菜单会自动创建 `Aurora Music` 快捷方式，双击即可启动。

### 🛠️ 方式二：从源码运行（开发者）

#### 系统要求
- Windows 10 / 11 **64 位**（仅 64 位支持）
- 已安装 VB-CABLE 虚拟驱动
- Node.js ≥ 18

#### 1. 安装 VB-CABLE 虚拟驱动
VB-CABLE 驱动安装包已放在 `_extras/thirdparty-src/VBCABLE_Driver_Pack45/`：
1. 以管理员身份运行 `VBCABLE_Setup_x64.exe`
2. 安装完成后重启（或禁用/启用声卡）
3. 打开 `设置 → 系统 → 声音`，确认能看到：
   - **播放设备**：`CABLE Input (VB-Audio Virtual Cable)`
   - **录音设备**：`CABLE Output (VB-Audio Virtual Cable)`

#### 2. 安装依赖
```powershell
cd AuroraMusic
npm install
```

#### 3. 开发模式运行
```powershell
npm run dev
```

或者双击 `_extras/scripts/启动_AuroraMusic.bat` 一键启动。

#### 4. 构建生产包（自己打 EXE）
```powershell
npm run build      # 编译主进程 + 渲染进程
npm run dist       # 打包 NSIS 安装包 + portable 单文件
# 打包产物在 release/ 目录下：
#   release\Aurora Music Setup 0.3.0.exe   ← 安装版
#   release\Aurora Music 0.3.0.exe         ← 免安装版
```

---

## 🕹️ 使用教程

### 游戏中播放音乐给队友听（完整流程）

#### 第 1 步：设置游戏语音
打开 **游戏设置 → 语音/音频**：
- 🎙️ **麦克风（输入）**：选择 **`CABLE Output (VB-Audio Virtual Cable)`** ← 关键！
- 🔊 **扬声器（输出）**：保持不变（默认耳机/扬声器），不要改到 CABLE Input
  - ✅ 这样游戏/队友语音仍然从你的耳机出来

#### 第 2 步：打开 AuroraMusic
1. 添加本地音乐到播放列表
2. 播放一首歌曲，确认本地能听到声音

#### 第 3 步：开启混音
有 **3 种方式** 开/关混音：
- 🌗 **右下角按钮**：点击底部"混音"开关
- ⌨️ **快捷键**：默认 `Ctrl + Alt + M`（可在设置 → 快捷键中自定义）
- 📋 **托盘菜单**：右键托盘图标 → "🎚️ 混音开关"

#### 第 4 步：调节 4 个音量滑块

| 滑块 | 控制对象 | 建议初始值 |
|------|---------|-----------|
| 🎵 **音乐音量 (musicGain)** | 队友听到的音乐音量 | 50% 左右（太大盖住你的说话声） |
| 🎙️ **麦克风 (micGain)** | 队友听到的你的说话声音量 | 80-100% |
| 👂 **本地监听 (monitorGain)** | **你自己**听到的音乐音量（不影响队友） | 100% 或和音乐播放器音量一致 |
| 🛡️ **降噪强度 (denoiseStrength)** | RNNoise AI 降噪（预留参数，当前版本占位） | 80% |

> 💡 调试技巧：拖动滑块时，问队友"我声音大还是音乐大"，把 musicGain 调整到不盖住你说话的程度。

#### 第 5 步：游戏按键播放
- 播放 / 暂停 / 上一首 / 下一首：使用你设置的全局快捷键
- 例如 `F5` 切歌、`F6` 暂停：在快捷键设置里配置即可

---

## 📂 目录结构

```
AuroraMusic/
├── src/
│   ├── main/                # Electron 主进程
│   │   ├── audio/           # ⭐ 混音核心（BASS 引擎）
│   │   │   ├── engine.ts    # 音频引擎：播放、混音、设备切换
│   │   │   ├── installer.ts # VB-CABLE / BASS / koffi 安装检测
│   │   │   └── devices.ts   # 设备枚举（PowerShell + BASS）
│   │   ├── ipc/             # IPC 注册：audio / globalShortcut
│   │   └── index.ts         # 主进程入口
│   ├── renderer/            # 渲染进程（Vue 3）
│   │   └── src/
│   │       ├── components/  # BottomPlayer.vue（播放器）
│   │       │                  MixPanel.vue（混音面板）
│   │       └── stores/      # audio.ts（混音 Pinia 状态）
│   └── preload/             # preload IPC 桥
├── native/                  # 运行时必需的 DLL（提交）
│   ├── bass/x64/            # bass.dll、bassmix.dll
│   └── rnnoise/x64/         # rnnoise.dll
├── _extras/                 # ⬇️ 非运行必需，已归档到这里
│   ├── docs/                # BUG_SUMMARY.md、诊断脚本
│   ├── thirdparty-src/      # BASS 官方 SDK 源码、VB-CABLE 驱动、RNNoise 源码
│   └── build-archive/       # 旧版 release（被 .gitignore 排除）
├── mix_on.png               # README 用截图
├── LICENSE                  # ⚠️ 禁止商用 + 后果自负（必读）
├── README.md                # 本文档
├── package.json
├── electron.vite.config.ts
└── .gitignore
```

---

## ⚠️ 声明与警告

### ❌ 禁止商用
本项目 **不支持任何形式的商业用途**。
所依赖的 BASS、VB-CABLE 等第三方组件，其商业使用需单独向版权所有者申请授权。详见 [LICENSE](./LICENSE)。

### ⚖️ 风险提示（后果自负）
使用本软件即表示您同意自行承担全部风险：
1. **音乐版权风险**：请不要通过虚拟麦克风向他人传播受版权保护的音乐作品，由此产生的版权纠纷责任自负。
2. **游戏封禁风险**：部分游戏或语音平台（如 Valorant Vanguard、Steam Overlay、Discord 等）对音频驱动、虚拟录音设备、全局热键较为敏感，**可能判定为第三方工具/作弊**。请谨慎使用。因使用本项目导致账号封禁、反作弊报警等，作者不承担责任。
3. **系统稳定性**：虚拟音频驱动与系统音频栈交互复杂，极端情况下可能导致蓝屏、声卡驱动崩溃。请确保重要工作已保存。
4. **隐私安全**：麦克风采集的音频只在本地混音处理，不上传任何服务器。请自行判断信任程度。

---

## 📜 第三方版权与许可

| 组件 | 版权方 | 许可 | 商用是否需额外授权 |
|------|-------|------|-------------------|
| **BASS Audio Library** | un4seen developments | [Shareware](https://www.un4seen.com/) | ✅ **是**（需购买） |
| **BASSmix** | un4seen developments | 同上 | ✅ **是** |
| **VB-CABLE** | VB-Audio Software | Donationware | ✅ 专业/商业环境需捐赠 |
| **RNNoise** | Xiph.Org / Mozilla | BSD 3-Clause | ❌ 否 |
| **Electron** | OpenJS Foundation | MIT | ❌ 否 |
| **Vue 3** | Evan You / Vue.js | MIT | ❌ 否 |
| **koffi** | Koromilo | MIT | ❌ 否 |
| **music-metadata** | Borewit | MIT | ❌ 否 |

---

## 🐞 已知问题

详见 [\_extras/docs/BUG_SUMMARY.md](./_extras/docs/BUG_SUMMARY.md)

---

## 🙏 致谢与参考

- 感谢 [un4seen](https://www.un4seen.com/) 提供强大的 BASS 音频引擎
- 感谢 [VB-Audio](https://vb-audio.com/Cable/) 提供免费的虚拟音频驱动
- 感谢 [koffi](https://koffi.dev/) 项目，让 Node.js 调用原生 DLL 终于不再需要编译环境
- 感谢 [RNNoise](https://jmvalin.ca/demo/rnnoise/) 项目提供轻量降噪算法

---

> 🌟 如果本项目对您的学习有帮助，欢迎留下一颗 Star！
> 同时，**请严格遵守 [LICENSE](./LICENSE) 条款，仅限个人学习使用**。
