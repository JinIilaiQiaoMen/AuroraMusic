export type AudioDeviceType =
  | 'speaker'
  | 'headphones'
  | 'headset'
  | 'microphone'
  | 'linelevel'
  | 'digital'
  | 'network'
  | 'unknown'

export interface AudioDevice {
  id: number
  name: string
  driver: string
  type: AudioDeviceType
  isEnabled: boolean
  isDefault: boolean
  isInitialized: boolean
  isLoopback: boolean
  isVirtualInput: boolean
  isVirtualOutput: boolean
}

export interface InstallStatus {
  bassDll: { bass: boolean; mix: boolean }
  rnnoiseDll: boolean
  /** rnnoise 为可选项（缺失时自动降级到 stub 模式，不影响核心功能） */
  rnnoiseOptional?: boolean
  ffiInstalled: boolean
  nativeBassActive: boolean
  nativeRnnActive: boolean
  virtualCableInstalled: boolean
  bassReason?: string
  rnnReason?: string
  // ---- 渲染层 InstallInfo 兼容字段 ----
  installed: boolean
  virtualDeviceId: number
  virtualDeviceName: string
  driverVersion: string
}

export type InstallerSource = 'web' | 'local'

export interface DeviceSnapshot {
  playback: AudioDevice[]
  recording: AudioDevice[]
  virtualInputId: number
  virtualOutputId: number
  micDefaultId: number
}

export type MixerPresetId =
  | 'gaming'
  | 'listening'
  | 'streamer'
  | 'watching'
  | 'meeting'
  | 'custom'

export interface MixerState {
  on: boolean
  preset: MixerPresetId
  musicGain: number      // 0-100
  micGain: number        // 0-100
  monitorGain: number    // 0-100
  denoiseStrength: number // 0-100
  agc: boolean
  echoCancel: boolean
  outDeviceId: number
  virtualDeviceId: number
  micDeviceId: number
  sampleRate: 44100 | 48000 | 96000
}

export interface MixerLevels {
  musicL: number
  musicR: number
  micL: number
  micR: number
  outL: number
  outR: number
}
