# AuroraMusic 游戏混音模块 — 报错与 Bug 总结

**更新日期**：2026-08-08
**阶段**：Alpha 修复阶段（第 4 轮）

---

## 一、核心架构说明

AuroraMusic 的设计目标是：**本地播放音乐 + 同时把音乐+麦克风混音输出到 VB-CABLE 虚拟麦克风（游戏队友听）**。

```
┌──────────────────────────────────────────────────────────────┐
│  AuroraMusic 主进程（BASS 音频引擎）                          │
│                                                              │
│   ┌──────────────┐     ┌─────────────────────────────┐       │
│   │  本地扬声器   │◀────│  _musicStream (默认设备)     │       │
│   │  （用户听）   │     │  音量 = musicGain × monitor │       │
│   └──────────────┘     └─────────────────────────────┘       │
│                                                              │
│   ┌──────────────┐     ┌─────────────────────────────┐       │
│   │ VB-CABLE     │◀────│  _mixerStream (VB-CABLE设备) │       │
│   │ Input 输入端  │     │  音乐: _musicDecodeStream   │       │
│   │ ──────────── │     │  麦克: _micStream           │       │
│   │ VB-CABLE     │     │  播放: BASS_ChannelPlay     │       │
│   │ Output 输出端 │     └─────────────────────────────┘       │
│   └──────┬───────┘                                           │
└──────────┼───────────────────────────────────────────────────┘
           │
           ▼
   Windows 录音设备（游戏采集声音）
   → 队友听到 音乐 + 你的麦克风
```

**关键链路**：

| 模块 | 位置 | 作用 |
|------|------|------|
| 前端 Vue | `src/renderer/src/components/MixPanel.vue` | UI 滑块：musicGain / micGain / monitorGain |
| 前端状态 | `src/renderer/src/stores/audio.ts` | `applyPatch` → IPC 调用 `audio:mixer:apply` |
| IPC 桥 | `src/preload/index.ts` | 暴露 `window.api.audio.mixer.apply` |
| IPC 主进程 | `src/main/ipc/audio.ts` | `ipcMain.handle('audio:mixer:apply')` → `engine.applyState` |
| 音频引擎 | `src/main/audio/engine.ts` | `applyState` → 真正操作 BASS 句柄调音量 |
| BASS 原生库 | `native/bass/index.ts` | koffi 声明 + 调用 bass.dll / bassmix.dll |

---

## 二、所有 Bug 清单（按严重性排序）

### ❌ Bug #1（最致命）：BASS 从未真正播放过音频

**问题现象**：所有音乐实际走 HTML5 `<audio>` 元素播放（[BottomPlayer.vue L113](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/renderer/src/components/BottomPlayer.vue#L113)），BASS 引擎完全没在播放。混音面板滑块无效、麦克风无声、VB-CABLE 无输出。

**根本原因**：`BASS_StreamCreateFile` 参数声明为 `void *file`，koffi 把 JS 字符串传给 `void *` 时 **不会自动转换为 C 字符串**，BASS 收到的是一个无效指针 → 返回 handle = 0 → 代码回退到 stub 模式生成假 handle（10001, 10002...）→ 前端查询 duration 为 0，判定引擎不可用 → 全部走 HTML5 `<audio>`。

**错误调用链**：
```
engine.loadMusicFile(path)
  → BassLib.BASS_StreamCreateFile(0, "C:\歌曲.mp3", 0, 0, 0)
     → koffi 把 string 传给 void*（这步是 undefined behavior）
     → BASS 收到非法指针
     → 返回 0
     → BASS_ErrorGetCode() = 2 (BASS_ERROR_FILEOPEN)
  → handle=0，代码走 stub fallback → _musicStream = random(5000, 15000)
  → loadMusicFile 返回 true
  → 前端看到 ok=true，但 isNative=true 且 duration=0（因为 stream handle 是假的）
  → 之前还要求 d>0 才 engineWorking=true，所以走 HTML5 audio
```

**修复**：
1. 添加 `BASS_StreamCreateFileW`（Unicode 版本）声明，路径用 `Buffer.from(path+'\0', 'utf16le')` 手动编码传指针
   - [native/bass/index.ts L97-L101 stub](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/native/bass/index.ts#L97)
   - [native/bass/index.ts L184 koffi声明](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/native/bass/index.ts#L184)
2. native 模式下 `handle=0` 就返回 false，**不要用 stub 假 handle 掩盖问题**
   - [engine.ts L121-L129](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/main/audio/engine.ts#L121-L129)
3. 前端 `engineLoad` 不再检查 `duration>0` 才启用 BASS，只要 `ok && isNative` 就走 BASS
   - [BottomPlayer.vue L46-L72](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/renderer/src/components/BottomPlayer.vue#L46-L72)

---

### ❌ Bug #2：`BASS_StreamPlay` 函数不存在，混音器永远不播放

**问题现象**：混音器创建成功，但 VB-CABLE 收不到任何声音（只有音乐能因为 HTML5 被游戏间接录到，但麦克风完全无声）。

**根本原因**：代码调用了 `BASS_StreamPlay()` 播放混音器，但这个函数是 **BASS 1.x 的废弃 API**，在 BASS 2.x 中是 `BASS_ChannelPlay`。`BassLib.BASS_StreamPlay` 是 `undefined`，导致 `if (... && BassLib.BASS_StreamPlay)` 条件永远不执行。

**修复**：把 `BASS_StreamPlay` 全部替换为 `BASS_ChannelPlay`
   - [engine.ts L582 现在改为 BASS_ChannelPlay](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/main/audio/engine.ts#L582)

---

### ❌ Bug #3：混音器没有路由到 VB-CABLE 设备

**问题现象**：混音器即使播放了，也是输出到默认扬声器，不是 VB-CABLE Input。队友听不到，反而用户自己的扬声器在同时放音乐和麦克风。

**根本原因**：混音器用 `BASS_Mixer_StreamCreate` 创建时，BASS 当前设备是默认扬声器（`-1`），混音器就绑定到默认设备了。要输出到 VB-CABLE，必须先 `BASS_Init(vbcableId)` + `BASS_SetDevice(vbcableId)`，再创建混音器。

**修复**：
1. 创建混音器前 `BASS_Init(vbcableId)` + `BASS_SetDevice(vbcableId)`
2. 创建完混音器 + 播放后，**必须 `BASS_SetDevice(0xFFFFFFFF)` 切回默认设备**（否则音乐流创建到 VB-CABLE，用户听不到）
   - [engine.ts _startMixerLoop 步骤 1-3](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/main/audio/engine.ts#L513-L537)
   - [engine.ts _startMixerLoop 步骤 9](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/main/audio/engine.ts#L588-L595)

---

### ❌ Bug #4：麦克风流创建了但没加入混音器

**问题现象**：游戏端只能听到音乐，完全听不到说话声音。

**根本原因**：`_startMixerLoop` 里 `BASS_RecordStart` 创建了 `_micStream`，但没有 `BASS_Mixer_StreamAddChannel(mixer, _micStream)` 把它加进混音器。混音器里只有音乐流。

**修复**：加一行把 mic stream 加入混音器
   - [engine.ts _startMixerLoop 步骤 7](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/main/audio/engine.ts#L570-L577)

---

### ❌ Bug #5：音乐不能跨设备加入混音器（缺少 decode stream）

**问题现象**：混音器创建在 VB-CABLE 设备，但音乐流绑定在默认扬声器设备，`BASS_Mixer_StreamAddChannel` 跨设备失败。

**根本原因**：BASS 中普通 channel 绑定设备，只能被同设备的混音器读取。跨设备必须先 `BASS_StreamCreateFile` 时加 `BASS_STREAM_DECODE` 标志创建 decode channel，decode channel 不绑定任何设备。

**修复**：
1. 新增 `_musicDecodeStream` 字段
2. 混音时用 `BASS_STREAM_DECODE` 标志创建 decode 副本
3. 混音停止/切歌时正确清理 `_musicDecodeStream`
   - [engine.ts 字段声明](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/main/audio/engine.ts#L32)
   - [engine.ts _startMixerLoop 步骤 4](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/main/audio/engine.ts#L540-L556)
   - [engine.ts _stopMixerLoop 清理](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/main/audio/engine.ts#L655-L672)

---

### ❌ Bug #6：切歌时序不同步

**问题现象**：先开混音开关，再去歌单点新歌播放，队友听不到新歌，还是旧歌的解码流在跑。

**根本原因**：`loadMusicFile` 切换了 `_musicStream`，但混音器里的 `_musicDecodeStream` 没有同步更新。

**修复**：`loadMusicFile` 末尾判断 `if (this._mixerRunning) this._updateMusicInMixer()`，play/pause/seek 里也同步调用。
   - [engine.ts _updateMusicInMixer](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/main/audio/engine.ts#L184-L219)
   - [engine.ts loadMusicFile 末尾触发](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/main/audio/engine.ts#L155)
   - [engine.ts play() 调用](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/main/audio/engine.ts#L236)
   - [engine.ts pause() 调用](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/main/audio/engine.ts#L247)
   - [engine.ts seek() 调用](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/main/audio/engine.ts#L285)

---

### ❌ Bug #7：`applyState` 中 monitorGain / denoiseStrength 完全不处理

**问题现象**：🎵音乐音量和🎙️麦克风有时能听到但滑块没反应，👂本地监听和🛡️降噪滑块拖动完全没效果。

**根本原因**：`applyState` 里只写了 `musicGain` 和 `micGain` 的 BASS 调用，`monitorGain` 和 `denoiseStrength` 没有任何代码。同时当播放走 HTML5 audio 时（Bug #1），IPC 的 BASS 音量设置也完全不影响 HTML5 audio 元素的音量。

**修复**：
1. `applyState` 补全 `monitorGain` 处理
2. HTML5 audio 播放时前端用 `applyAudioElVolume` 直接监听 audio.state.on / musicGain / monitorGain 变化同步 `<audio>.volume`
   - [engine.ts applyState L311-L344](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/main/audio/engine.ts#L311-L344)
   - [BottomPlayer.vue applyAudioElVolume L153-L172](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/renderer/src/components/BottomPlayer.vue#L153-L172)

---

### ❌ Bug #8：启动顺序导致安装状态误判

**问题现象**：点击混音开关，右侧弹出"请先安装"的窗口，即使已经安装了 VB-CABLE。

**根本原因**：`index.ts` 中 `createWindow()` 在第 56 行，音频 IPC 处理器注册在第 60 行。渲染器 `onMounted` 时调用 `checkInstall()`，但 IPC 处理器还没注册 → 调用抛错被 catch 了，`installed=false`。

**修复**：把 `registerAudioIpc` 移到 `createWindow()` 之前执行
   - [index.ts L51-L61](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/main/index.ts#L51-L61)

---

### ❌ Bug #9：VB-CABLE 设备识别靠 BASS 枚举，不可靠

**问题现象**：`_vbcableDeviceId` 找不到，混音器 `BASS_Init(0)` 就错了。

**根本原因**：BASS 设备枚举顺序和 PowerShell AudioEndpoint 顺序不一致，BASS 还多出一些"映射设备"。直接用用户设置的 `virtualDeviceId` 可能和 BASS 的 device id 不匹配。

**修复**：新增 PowerShell 查找逻辑——先在 PowerShell 中找 `CABLE Input` 的 render 索引，再在 BASS 中枚举 ENABLED 且非 INIT 的设备做位置匹配。
   - [engine.ts _findVbcableDeviceAsync](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/main/audio/engine.ts#L416-L475)

---

### ❌ Bug #10：设备名称乱码

**问题现象**：设备列表里中文设备名显示为乱码（???）。

**根本原因**：`BASS_DEVICEINFO.name` 是 ANSI 编码，koffi 直接 `decode` 出来是乱码。同时 koffi v3 没有 `read` 方法，无法安全读取任意内存指针。

**修复**：放弃 BASS 读取名称，改用 PowerShell 枚举 Windows AudioEndpoint，用 UTF-8 编码输出。
   - [devices.ts getPowershellDeviceNames](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/main/audio/devices.ts)
   - [installer.ts detectVirtualCable](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/main/audio/installer.ts)

---

## 三、常见报错与返回值速查

### BASS_ErrorGetCode() 错误码

| 错误码 | 常量名 | 含义 | 可能触发场景 |
|-------|--------|------|-------------|
| 0 | BASS_OK | 正常 | — |
| 1 | BASS_ERROR_MEM | 内存不足 | 内存不够 |
| 2 | BASS_ERROR_FILEOPEN | 打不开文件 | 路径编码问题（Bug #1 常见） |
| 3 | BASS_ERROR_DRIVER | 驱动不可用 | BASS_Init 失败 |
| 4 | BASS_ERROR_BUFLOST | 缓冲区丢失 | 系统音频设备切换 |
| 5 | BASS_ERROR_HANDLE | 非法 handle | 传了 0 或假 handle |
| 6 | BASS_ERROR_FORMAT | 不支持格式 | 音频编码不对 |
| 7 | BASS_ERROR_POSITION | 非法 position | seek 越界 |
| 8 | BASS_ERROR_INIT | 未初始化 | 没先调 BASS_Init/RecordInit |
| 9 | BASS_ERROR_START | 无法启动 | `BASS_RecordStart` 失败 |
| 14 | BASS_ERROR_DENIED | 权限不足 | 其他程序占用麦克风 |
| 18 | BASS_ERROR_DEVICE | 非法设备号 | vbcableId 找不到 |
| 19 | BASS_ERROR_NOCHAN | 无可用 channel | 太多句柄没释放 |
| 20 | BASS_ERROR_ILLTYPE | 类型不匹配 | 对 recording stream 调 channel 属性 |
| 39 | BASS_ERROR_NOTAVAIL | 不可用 | bassmix.dll 没加载 |

### 常见日志片段对照

启动流程中**健康**的日志应该长这样：
```
[engine] loadMusicFile: C:\Users\...\song.mp3 | native: true
[engine] BASS_StreamCreateFileW handle: 196689 | BASS_ErrorGetCode: 0
[engine] lenBytes: 45234688
[engine] duration: 235.6 sec

[mixer] starting mixer loop...
[mixer] VB-CABLE device ID: 4
[mixer] BASS_Init VB-CABLE device 4 result: 1
[mixer] BASS_SetDevice to VB-CABLE: 1
[mixer] created mixer stream on VB-CABLE, handle = 12345
[mixer] created music decode stream (W), handle = 12346 error= 0
[mixer] created mic stream, handle = 3001 error= 0
[mixer] added music decode channel to mixer: 1
[mixer] added mic channel to mixer: 1
[mixer] mixer stream playing on VB-CABLE, result: 1
[mixer] switched back to default playback device (-1)
[mixer] music still playing on default device
[mixer] mixer loop started successfully
```

**异常**日志对照：

| 异常片段 | 对应 Bug | 排查方向 |
|---------|----------|---------|
| `handle: 0 \| BASS_ErrorGetCode: 2` | Bug #1 或路径不存在 | 确认路径是绝对路径；确认用了 BASS_StreamCreateFileW + UTF-16 |
| `native: false` | koffi/bass.dll 没加载 | 运行 test-diagnose.cjs |
| `VB-CABLE device ID: -1` | Bug #9 | 看 [installer.ts](file:///c:/Users/rcg16/OneDrive/Desktop/AI项目/AuroraMusic/src/main/audio/installer.ts) detectVirtualCable 结果 |
| `mixer stream playing on VB-CABLE, result: 0` | Bug #2 或 handle=0 | 确认用的是 BASS_ChannelPlay |
| 看不到 [mixer] 开头的日志 | applyState 没被调用 | 前端 applyPatch → IPC 链路是否通 |
| Console 中 VIRTUAL_MIC_NOT_INSTALLED | Bug #8 或真没装 | 1) 先看 detectInstall 返回值 2) 确认 index.ts IPC 顺序 |

---

## 四、下一步必须验证的测试用例

启动应用后按顺序执行：

1. **播放一首本地歌曲** → 主进程日志出现 `native: true` + `handle != 0` + duration 有值
2. **开混音开关** → 主进程日志出现 `mixer loop started successfully`，每步 result=1
3. **拖动🎵音乐音量滑块** → 游戏端队友能听到音乐音量同步变化
4. **拖动🎙️麦克风滑块** → 游戏端队友能听到麦克风音量变化（说话测试）
5. **拖动👂本地监听滑块** → 自己的扬声器上音乐音量变化（但游戏端队友听到的 musicGain 不变）
6. **在混音开启时点下一首歌** → 队友听到换歌（不能继续播旧歌）
7. **混音中暂停播放** → 队友听不到音乐了（但还能听到麦克风）
8. **混音中拖动进度条（seek）** → 队友也同步跳到新位置
9. **关闭混音** → 切歌、音量滑块全部正常；游戏端不再收到音频
10. **在游戏里设置录音设备为 CABLE Output** → 确认以上测试是通过 VB-CABLE 被采集的

---

## 五、设计层面的反思

### 为什么 bug 这么多？
1. **过早的 stub fallback**：stub 本来是为了前端 UI 不报错，但 native 模式下失败也偷偷 fallback，导致问题被掩盖。现在 native 模式下 `handle=0` 直接返回 `false`，让 UI 显式报错。
2. **缺失 end-to-end 测试**：每个小函数单独看没问题，但从"用户滑块→IPC→主进程→BASS→VB-CABLE→游戏端"这条链路从来没跑通过，导致 Bug #1 一直没被发现。
3. **BASS API 理解不到位**：`BASS_SetDevice` 设备切换、`STREAM_DECODE` 跨设备规则、`BASS_ChannelPlay` vs `BASS_StreamPlay` 这些知识点缺失，导致设计时想当然。

### 后续改进建议
- **native debug 开关**：加一个全局 flag，开启后每个 BASS 调用都记录返回值和 errorcode
- **VB-CABLE 自检命令**：加一个"🎤测试混音输出"按钮，自动生成 440Hz 正弦波混合音输出 3 秒，方便快速验证
- **koffi 指针传参规范**：所有 `char*`/`void*` + 字符串参数统一用 `Buffer.from(..., 'utf16le' or 'utf8')`，不直接传 JS 字符串
