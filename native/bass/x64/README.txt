Aurora Music - BASS DLL 目录
============================

本目录需要放入以下 DLL 文件（64 位）：
  · bass.dll        - Un4seen BASS audio library 2.4
  · bassmix.dll     - BASSmix add-on (混音器)
  · (可选) bassenc.dll

下载地址（免费用于非商业）：
  https://www.un4seen.com/bass.html
  https://www.un4seen.com/bass.html#addons

安装步骤：
  1. 从官网下载 BASS 2.4 (x64) + BASSmix 2.4 (x64)
  2. 解压后把 bass.dll / bassmix.dll 复制到本目录（native/bass/x64/）
  3. 重启 Aurora Music，系统会自动检测并启用原生音频引擎
  4. 同时安装 npm: npm i ffi-napi@4.0.3 ref-napi@3.0.3

若 DLL 未就位，Aurora Music 会使用浏览器的 <audio> 元素作为回退方案播放音乐（M2 兼容模式），仅游戏混音输出功能需 BASS 才可启用。
