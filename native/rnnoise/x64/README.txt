Aurora Music - RNNoise DLL 目录
================================

本目录需要放入：rnnoise.dll (x64)

参考构建：
  · 官方源码: https://gitlab.xiph.org/xiph/rnnoise
  · 预编译 Windows x64: https://github.com/xiph/rnnoise/releases (或使用 community builds)

功能：
  RNNoise 是基于 RNN 的 AI 实时降噪（48kHz / 10ms 帧），给麦克风输入降噪。
  DLL 未就位时使用 JS 软限幅作为回退（近似效果）。
