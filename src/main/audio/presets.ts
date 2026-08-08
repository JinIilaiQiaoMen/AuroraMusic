import type { MixerState, MixerPresetId } from './types'

export function defaultMixerState(
  outDeviceId: number = -1,
  micDeviceId: number = -1,
  virtualDeviceId: number = -1
): MixerState {
  return {
    on: false,
    preset: 'listening',
    musicGain: 60,
    micGain: 75,
    monitorGain: 60,
    denoiseStrength: 50,
    agc: false,
    echoCancel: false,
    outDeviceId,
    virtualDeviceId,
    micDeviceId,
    sampleRate: 48000
  }
}

export interface MixerPresetDef {
  id: MixerPresetId
  label: string
  icon: string
  musicGain: number
  micGain: number
  monitorGain: number
  denoiseStrength: number
  agc: boolean
  echoCancel: boolean
}

export const MixerPresets: Record<MixerPresetId, MixerPresetDef> = {
  gaming: {
    id: 'gaming',
    label: '🎮 开黑模式',
    icon: '🎮',
    musicGain: 55,
    micGain: 90,
    monitorGain: 70,
    denoiseStrength: 55,
    agc: true,
    echoCancel: true
  },
  listening: {
    id: 'listening',
    label: '🎧 听歌模式',
    icon: '🎧',
    musicGain: 72,
    micGain: 50,
    monitorGain: 40,
    denoiseStrength: 35,
    agc: false,
    echoCancel: false
  },
  streamer: {
    id: 'streamer',
    label: '🎤 主播模式',
    icon: '🎤',
    musicGain: 45,
    micGain: 85,
    monitorGain: 75,
    denoiseStrength: 70,
    agc: true,
    echoCancel: true
  },
  watching: {
    id: 'watching',
    label: '📺 观影模式',
    icon: '📺',
    musicGain: 78,
    micGain: 60,
    monitorGain: 35,
    denoiseStrength: 45,
    agc: false,
    echoCancel: true
  },
  meeting: {
    id: 'meeting',
    label: '🎙️ 会议模式',
    icon: '🎙️',
    musicGain: 35,
    micGain: 88,
    monitorGain: 80,
    denoiseStrength: 80,
    agc: true,
    echoCancel: true
  },
  custom: {
    id: 'custom',
    label: '自定义',
    icon: '＋',
    musicGain: 50,
    micGain: 50,
    monitorGain: 50,
    denoiseStrength: 50,
    agc: false,
    echoCancel: false
  }
}

export function applyPreset(state: MixerState, id: MixerPresetId): MixerState {
  const preset = MixerPresets[id]
  if (!preset) return { ...state }
  return {
    ...state,
    preset: id,
    musicGain: preset.musicGain,
    micGain: preset.micGain,
    monitorGain: preset.monitorGain,
    denoiseStrength: preset.denoiseStrength,
    agc: preset.agc,
    echoCancel: preset.echoCancel
  }
}
