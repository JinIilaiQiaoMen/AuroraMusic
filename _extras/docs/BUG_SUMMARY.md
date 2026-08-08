# AuroraMusic 近期 Bug 总结

> 本文档记录了 AuroraMusic 项目开发过程中发现和修复的主要 Bug，按严重程度排序。

---

## 🔴 严重 Bug（影响核心功能）

### Bug #1：BASS 引擎调用失败，回退到 HTML5 音频

**现象**：
- 音乐播放使用 HTML5 `<audio>` 元素而非 BASS 引擎
- 麦克风输入无法被混音器捕获
- 混音功能完全失效

**根因**：
- 使用 `ffi-napi` 调用 BASS DLL 时，参数传递类型不匹配
- JavaScript 字符串无法正确转换为 C 字符串（char*）
- 导致 `BASS_StreamCreateFile` 等核心函数返回错误码

**修复**：
- 将 `ffi-napi` 替换为 `koffi` 库
- `koffi` 对 Node.js 原生类型支持更好，无需编译原生模块
- 使用 TypeScript 定义正确的函数签名和结构体布局

---

### Bug #2：混音开关点击后弹出安装窗口

**现象**：
- 点击"混音"开关后，右侧弹出"需要安装"的提示窗口
- 用户无法直接开启混音功能

**根因**：
- 前端 Pinia 状态 `audio.ts` 中 `applyPatch` 函数依赖缓存的安装状态
- 当 `checkInstall()` 未及时更新状态时，前端显示错误的"未安装"提示

**修复**：
- 在 `applyPatch` 中添加实时 IPC 检查：`w.api.audio.checkInstall()`
- 动态更新安装状态，不再依赖缓存

---

### Bug #3：BASS 设备名称乱码

**现象**：
- 设备列表中的中文名称显示为乱码
- 无法正确识别 VB-CABLE 设备

**根因**：
- `BASS_DEVICEINFO` 结构体中的 `name` 和 `driver` 字段为 ANSI 字符串
- 直接使用 `koffi.decode` 解码时未指定正确的字符编码

**修复**：
- 改用 PowerShell 枚举 Windows 音频设备
- 通过 `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` 确保中文正确显示
- 同时保留 BASS 设备枚举作为备选方案

---

## 🟠 中等 Bug（影响特定功能）

### Bug #4：麦克风无声

**现象**：
- 开启混音后，队友只能听到音乐，听不到用户的说话声
- 麦克风输入没有被传递到混音器

**根因**：
- 创建麦克风流 `_micStream` 后，未将其添加到混音器
- 缺少 `BASS_Mixer_StreamAddChannel(mixer, _micStream)` 调用

**修复**：
- 在混音初始化代码中添加麦克风通道到混音器
- 确保麦克风流被正确混合输出

---

### Bug #5：音量调控无效

**现象**：
- 拖动"音乐音量"、"麦克风"、"本地监听"滑块无效果
- 调节滑块对输出音频没有任何影响

**根因**：
- `applyState` 函数中缺少 `monitorGain` 的处理逻辑
- 前端未同步 HTML5 `<audio>` 元素的音量

**修复**：
- 在 `applyState` 中补全 `monitorGain` 处理
- 前端添加 `applyAudioElVolume` 函数同步 HTML5 audio 元素音量

---

### Bug #6：BASS_StreamPlay 函数不存在

**现象**：
- 调用 `BASS_StreamPlay` 时返回错误
- 播放控制功能异常

**根因**：
- 代码使用了 BASS 1.x 的废弃函数 `BASS_StreamPlay`
- BASS 2.x 中应使用 `BASS_ChannelPlay` 替代

**修复**：
- 将所有 `BASS_StreamPlay` 调用替换为 `BASS_ChannelPlay`
- 更新函数签名以匹配 BASS 2.x API

---

## 🟡 一般 Bug（影响用户体验）

### Bug #7：设备切换后音频流未正确重建

**现象**：
- 切换音频设备后，音乐或混音功能失效
- 需要重启应用才能恢复

**根因**：
- 设备切换时未正确销毁旧的音频流
- 新设备的音频流创建时机不正确

**修复**：
- 在切换设备前先销毁所有现有流
- 确保新流使用正确的设备句柄

---

### Bug #8：混音状态不同步

**现象**：
- UI 显示"混音已开启"，但实际混音器未运行
- 关闭混音后，UI 状态仍显示"开启"

**根因**：
- 渲染进程与主进程状态同步机制不完善
- 缺少双向状态验证

**修复**：
- 添加 IPC 心跳检查机制
- 前端定期向主进程验证混音状态

---

## 🔧 BASS 错误码参考

| 错误码 | 名称 | 描述 | 常见原因 |
|--------|------|------|---------|
| 0 | BASS_OK | 成功 | - |
| 1 | BASS_ERROR_MEM | 内存不足 | 系统资源紧张 |
| 2 | BASS_ERROR_FILEOPEN | 文件打开失败 | 文件路径错误、权限不足 |
| 3 | BASS_ERROR_DRIVER | 驱动错误 | DLL 缺失或版本不匹配 |
| 4 | BASS_ERROR_BUFLOST | 缓冲区丢失 | 设备被其他程序占用 |
| 5 | BASS_ERROR_HANDLE | 句柄无效 | 使用了已释放的流句柄 |
| 6 | BASS_ERROR_FORMAT | 格式不支持 | 音频格式与设备不兼容 |
| 7 | BASS_ERROR_SPEAKER | 扬声器不可用 | 音频设备未连接 |
| 8 | BASS_ERROR_NOCHAN | 无可用通道 | 通道资源耗尽 |
| 9 | BASS_ERROR_ILLTYPE | 类型错误 | 参数类型不正确 |
| 10 | BASS_ERROR_ILLPARAM | 参数错误 | 参数值超出有效范围 |
| 11 | BASS_ERROR_NO3D | 不支持 3D 音效 | 设备不支持 3D |
| 12 | BASS_ERROR_NOEAX | 不支持 EAX | 设备不支持 EAX 扩展 |
| 13 | BASS_ERROR_DEVICE | 设备错误 | 设备句柄无效 |
| 14 | BASS_ERROR_NOPLAY | 未播放 | 流未正确启动 |
| 15 | BASS_ERROR_FREQ | 频率不支持 | 采样率超出设备支持范围 |
| 16 | BASS_ERROR_NOTFILE | 不是文件 | 数据源不是有效的音频文件 |
| 17 | BASS_ERROR_HLOSE | 句柄已关闭 | 流已被释放 |
| 18 | BASS_ERROR_BLANK | 空白缓冲区 | 录制数据为空 |
| 19 | BASS_ERROR_LOOP | 循环无效 | 循环设置错误 |
| 20 | BASS_ERROR_NOTVOICE | 不是语音通道 | 调用了语音功能但不是语音流 |
| 21 | BASS_ERROR_NOTAUDIO | 不是音频流 | 流类型不正确 |
| 22 | BASS_ERROR_NOCHANREC | 无录制通道 | 录制设备不可用 |
| 23 | BASS_ERROR_NOPLAYREC | 未录制 | 录制未启动 |
| 24 | BASS_ERROR_SLOWDOWN | 速度太慢 | 混音器缓冲区不足 |

---

## 📋 日志对比表

### 正常日志（修复后）

```
[audio] BASS_Init: handle=3, deviceId=4
[audio] BASS_StreamCreateFile: stream=0x12345678, error=0
[audio] BASS_Mixer_StreamCreate: mixer=0x87654321
[audio] BASS_Mixer_StreamAddChannel: channel=music, status=ok
[audio] BASS_Mixer_StreamAddChannel: channel=mic, status=ok
[audio] BASS_ChannelPlay: channel=mixer, loop=0
[audio] 混音已开启: musicGain=0.8, micGain=0.9, monitorGain=1.0
```

### 异常日志（修复前）

```
[audio] BASS_Init: handle=0, deviceId=4, error=3  ← BASS_ERROR_DRIVER
[audio] 回退到 HTML5 音频播放
[audio] BASS_StreamCreateFile: stream=0, error=15  ← BASS_ERROR_FREQ
[audio] BASS_Mixer_StreamCreate: mixer=0, error=5  ← BASS_ERROR_HANDLE
[audio] 混音器创建失败，回退
```

---

## 🧪 测试用例

### 测试 1：混音功能基础测试

**步骤**：
1. 确保 VB-CABLE 驱动已安装
2. 打开 AuroraMusic
3. 播放一首歌曲
4. 点击"混音"开关
5. 检查以下日志：
   - `BASS_Init` 返回 `handle > 0`
   - `BASS_Mixer_StreamCreate` 返回 `mixer > 0`
   - `BASS_Mixer_StreamAddChannel` 成功添加 mic 通道
   - `BASS_ChannelPlay` 返回 `error=0`

**预期结果**：
- 日志显示 BASS 引擎正常初始化
- 混音器成功创建并运行
- 无 BASS 错误码

---

### 测试 2：音量调控测试

**步骤**：
1. 开启混音
2. 拖动"音乐音量"滑块到 30%、50%、80%
3. 询问队友是否能听到音乐音量变化
4. 拖动"麦克风"滑块到 50%、100%
5. 询问队友是否能听到你的说话音量变化
6. 拖动"本地监听"滑块
7. 检查你自己听到的音乐音量是否变化

**预期结果**：
- 每个滑块都能独立控制对应的音量
- 队友能听到音乐和麦克风音量的变化
- 本地监听不影响队友听到的音量

---

### 测试 3：设备切换测试

**步骤**：
1. 开启混音
2. 在系统设置中切换默认音频设备
3. 回到 AuroraMusic，暂停再播放音乐
4. 检查混音是否仍然正常工作
5. 在 AuroraMusic 设置中手动切换音频设备

**预期结果**：
- 切换设备后音频正常恢复
- 不出现卡死或无声现象

---

## 💡 设计建议

### 1. 错误处理
- 为每个 BASS API 调用添加统一的错误检查
- 使用封装的 `bassCheckError()` 函数记录错误码和上下文
- 在关键路径上实现自动回退机制

### 2. 类型安全
- 使用 TypeScript 严格模式编译
- 为 koffi 定义正确的函数签名
- 运行时验证 BASS 句柄有效性

### 3. 状态管理
- 使用 Pinia 管理音频状态，确保 UI 与底层引擎同步
- 添加状态持久化（保存用户偏好到本地存储）
- 实现状态变更日志，便于调试

### 4. 资源管理
- 统一管理 BASS 资源的创建和销毁
- 使用 RAII 思想封装音频流生命周期
- 避免资源泄漏和重复创建

### 5. 日志与诊断
- 添加详细的音频引擎日志（可配置日志级别）
- 实现诊断脚本，一键检测系统音频环境
- 在 README 中说明常见错误的排查方法

---

## 📝 更新记录

| 日期 | 版本 | 更新内容 |
|------|------|---------|
| 2026-08-08 | 0.3.0 | 修复 BASS 引擎调用、混音功能、设备枚举等核心 Bug |
| 2026-08-02 | 0.2.0 | 替换 ffi-napi 为 koffi，添加 RNNoise 降噪接口 |
| 2026-07-28 | 0.1.0 | 初始版本：基本音乐播放和混音功能 |

---

## 🔗 相关文件

- `src/main/audio/engine.ts` — 音频引擎核心
- `src/main/audio/devices.ts` — 设备枚举
- `src/main/audio/installer.ts` — 安装检测
- `src/renderer/src/stores/audio.ts` — 音频状态管理
- `src/renderer/src/components/MixPanel.vue` — 混音面板 UI

---

> **注意**：本文档持续更新，请及时同步最新的 Bug 修复记录。
