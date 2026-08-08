import { defineStore } from 'pinia'
import { ref, reactive, watch } from 'vue'

export type MixerPresetId = 'gaming' | 'listening' | 'streamer' | 'watching' | 'meeting'

export interface MixerState {
  on: boolean
  preset: MixerPresetId
  musicGain: number
  micGain: number
  monitorGain: number
  denoiseStrength: number
  agc: boolean
  echoCancel: boolean
  outDeviceId: number
  virtualDeviceId: number
  micDeviceId: number
  sampleRate: 44100 | 48000 | 96000
}

export const MIXER_PRESETS_LABELS: Record<MixerPresetId, string> = {
  gaming: '🎮 开黑模式',
  listening: '🎧 听歌模式',
  streamer: '🎤 主播模式',
  watching: '📺 观影模式',
  meeting: '🎙️ 会议模式'
}

export interface MixerLevels {
  musicL: number
  musicR: number
  micL: number
  micR: number
  outL: number
  outR: number
}

export interface InstallInfo {
  installed: boolean
  virtualDeviceId: number
  virtualDeviceName: string
  driverVersion: string
}

export interface AudioDevice {
  id: number
  name: string
  type: string
  isDefault: boolean
  isVirtualInput?: boolean
  isVirtualOutput?: boolean
}

export interface DeviceSnapshot {
  playback: AudioDevice[]
  recording: AudioDevice[]
  virtualInputId: number
  virtualOutputId: number
  micDefaultId: number
}

export const MIXER_PRESETS: Record<MixerPresetId, Partial<MixerState>> = {
  gaming:    { musicGain: 55, micGain: 90, monitorGain: 70, denoiseStrength: 55, agc: true,  echoCancel: true  },
  listening: { musicGain: 72, micGain: 50, monitorGain: 40, denoiseStrength: 35, agc: false, echoCancel: false },
  streamer:  { musicGain: 45, micGain: 85, monitorGain: 75, denoiseStrength: 70, agc: true,  echoCancel: true  },
  watching:  { musicGain: 78, micGain: 60, monitorGain: 35, denoiseStrength: 45, agc: false, echoCancel: true  },
  meeting:   { musicGain: 35, micGain: 88, monitorGain: 80, denoiseStrength: 80, agc: true,  echoCancel: true  }
}

const DEFAULT_STATE: MixerState = {
  on: false,
  preset: 'listening',
  musicGain: 60,
  micGain: 75,
  monitorGain: 60,
  denoiseStrength: 50,
  agc: false,
  echoCancel: false,
  outDeviceId: -1,
  virtualDeviceId: -1,
  micDeviceId: -1,
  sampleRate: 48000
}

export const useAudioStore = defineStore('audio', () => {
  const state = reactive<MixerState>({ ...DEFAULT_STATE })
  const levels = reactive<MixerLevels>({ musicL: 0, musicR: 0, micL: 0, micR: 0, outL: 0, outR: 0 })
  const installed = ref<InstallInfo>({ installed: false, virtualDeviceId: -1, virtualDeviceName: '', driverVersion: '' })
  const subsStarted = ref(false)

  let levelsTimer: ReturnType<typeof setInterval> | null = null
  let offLevels: (() => void) | null = null
  let offState: (() => void) | null = null

  async function loadFromSettings() {
    try {
      const saved = await (window as any).api?.settings?.get?.('mixerState', null)
      if (saved && typeof saved === 'object') {
        Object.assign(state, { ...DEFAULT_STATE, ...saved })
      }
    } catch {}
  }

  async function persistState() {
    try {
      await (window as any).api?.settings?.set?.('mixerState', { ...state })
    } catch {}
  }

  watch(() => ({ ...state }), () => persistState(), { deep: true })

  async function checkInstall(): Promise<InstallInfo> {
    const w = window as any
    if (typeof w.api?.audio?.checkInstall === 'function') {
      try {
        const r = await w.api.audio.checkInstall()
        if (r && typeof r === 'object') {
          installed.value = {
            installed: !!r.installed,
            virtualDeviceId: Number(r.virtualDeviceId) ?? -1,
            virtualDeviceName: r.virtualDeviceName || 'Aurora Virtual Mic',
            driverVersion: r.driverVersion || ''
          }
          if (installed.value.installed && state.virtualDeviceId < 0 && installed.value.virtualDeviceId >= 0) {
            state.virtualDeviceId = installed.value.virtualDeviceId
          }
          return installed.value
        }
      } catch {}
    }
    installed.value = {
      installed: false,
      virtualDeviceId: -1,
      virtualDeviceName: 'Aurora Virtual Mic',
      driverVersion: ''
    }
    return installed.value
  }

  async function applyPreset(id: MixerPresetId) {
    const preset = MIXER_PRESETS[id]
    if (!preset) return
    state.preset = id
    Object.assign(state, preset)
    const w = window as any
    if (typeof w.api?.audio?.mixer?.preset === 'function') {
      try { await w.api.audio.mixer.preset(id) } catch {}
    }
    await persistState()
  }

  async function applyPatch(patch: Partial<MixerState>): Promise<{ ok: boolean; error?: string }> {
    const wantOn = patch.on !== undefined ? !!patch.on : state.on
    if (wantOn && !installed.value.installed) {
      // 前端缓存未就绪 → 做一次实时 IPC 检查（兜底）
      try {
        const w = window as any
        if (typeof w.api?.audio?.checkInstall === 'function') {
          const r = await w.api.audio.checkInstall()
          if (r && r.installed) {
            installed.value = {
              installed: true,
              virtualDeviceId: Number(r.virtualDeviceId) ?? -1,
              virtualDeviceName: r.virtualDeviceName || 'Aurora Virtual Mic',
              driverVersion: r.driverVersion || ''
            }
            if (installed.value.installed) {
              if (state.virtualDeviceId < 0 && installed.value.virtualDeviceId >= 0) {
                state.virtualDeviceId = installed.value.virtualDeviceId
              }
              // 安装状态更新后继续往下执行
            }
          }
        }
      } catch {}
      if (!installed.value.installed) {
        return { ok: false, error: 'VIRTUAL_MIC_NOT_INSTALLED' }
      }
    }
    const prev = { ...state }
    Object.assign(state, patch)
    const w = window as any
    let ipcOk = true
    let ipcErr: string | undefined
    if (typeof w.api?.audio?.mixer?.apply === 'function') {
      try {
        const r = await w.api.audio.mixer.apply(patch)
        if (r && typeof r === 'object') {
          // 同步主进程实际状态（防止前端显示 on=true 但主进程没启动）
          Object.assign(state, { ...DEFAULT_STATE, ...r })
        }
      } catch (e: any) {
        ipcOk = false
        ipcErr = (e?.message ?? String(e)) || '混音启动失败'
        // 主进程失败 → 回滚前端状态
        Object.assign(state, prev)
      }
    } else {
      ipcOk = wantOn ? false : true
      if (wantOn) ipcErr = '音频引擎不可用'
    }
    try { await persistState() } catch {}
    return { ok: ipcOk, error: ipcErr }
  }

  async function emergencyStop() {
    state.on = false
    const w = window as any
    if (typeof w.api?.audio?.mixer?.emergencyStop === 'function') {
      try { await w.api.audio.mixer.emergencyStop() } catch {}
    }
    await persistState()
  }

  function startSubs() {
    if (subsStarted.value) return
    subsStarted.value = true
    const w = window as any
    let mainPushReceived = false
    if (typeof w.api?.audio?.mixer?.onLevels === 'function') {
      try {
        offLevels = w.api.audio.mixer.onLevels((lv: Partial<MixerLevels>) => {
          mainPushReceived = true
          if (lv.musicL != null) levels.musicL = lv.musicL
          if (lv.musicR != null) levels.musicR = lv.musicR
          if (lv.micL != null) levels.micL = lv.micL
          if (lv.micR != null) levels.micR = lv.micR
          if (lv.outL != null) levels.outL = lv.outL
          if (lv.outR != null) levels.outR = lv.outR
        })
      } catch {}
    }
    // 本地 fallback 动画：平滑"呼吸式"律动（不使用 Math.random() 随机乱跳）
    // 保证视觉稳定：随音量做缓慢正弦变化，避免跳动感
    let tau = 0
    const SMOOTH = 0.18 // 0..1，越大变化越快
    levelsTimer = setInterval(() => {
      // 如果主进程已经在推电平，就走主进程推送 + CSS transition，不用本地 fallback
      if (mainPushReceived) return
      tau += 0.04
      if (state.on) {
        // 基础响度（只看音量档位）
        const musicBase = Math.max(0, Math.min(1, state.musicGain / 100))
        const micBase = Math.max(0, Math.min(1, state.micGain / 100))
        // 目标值：正弦 + 音量档位，不使用随机，变化平缓
        const env = (a: number, phase: number) => {
          const v = 0.15 + 0.55 * a + 0.25 * a * (0.5 + 0.5 * Math.sin(tau + phase))
          return Math.max(0, Math.min(1, v))
        }
        const targetMusicL = env(musicBase, 0)
        const targetMusicR = env(musicBase, 0.7)
        const targetMicL = env(micBase, 1.4)
        const targetMicR = env(micBase, 2.1)
        const targetOutL = Math.min(1, targetMusicL * 0.55 + targetMicL * 0.4)
        const targetOutR = Math.min(1, targetMusicR * 0.55 + targetMicR * 0.4)
        // 线性插值（lerp）：当前值 向 target 慢慢靠拢
        const lerp = (cur: number, tgt: number, f: number) => cur + (tgt - cur) * f
        levels.musicL = lerp(levels.musicL, targetMusicL, SMOOTH)
        levels.musicR = lerp(levels.musicR, targetMusicR, SMOOTH)
        levels.micL = lerp(levels.micL, targetMicL, SMOOTH)
        levels.micR = lerp(levels.micR, targetMicR, SMOOTH)
        levels.outL = lerp(levels.outL, targetOutL, SMOOTH)
        levels.outR = lerp(levels.outR, targetOutR, SMOOTH)
      } else {
        // 关掉后向 0 平滑衰减（不会突然归零跳动）
        const lerp = (cur: number, f: number) => cur * (1 - f)
        levels.musicL = lerp(levels.musicL, 0.2)
        levels.musicR = lerp(levels.musicR, 0.2)
        levels.micL = lerp(levels.micL, 0.25)
        levels.micR = lerp(levels.micR, 0.25)
        levels.outL = lerp(levels.outL, 0.22)
        levels.outR = lerp(levels.outR, 0.22)
        // 低于 0.001 直接归零，避免尾巴微抖
        if (levels.musicL < 0.002) levels.musicL = 0
        if (levels.musicR < 0.002) levels.musicR = 0
        if (levels.micL < 0.002) levels.micL = 0
        if (levels.micR < 0.002) levels.micR = 0
        if (levels.outL < 0.002) levels.outL = 0
        if (levels.outR < 0.002) levels.outR = 0
      }
    }, 120)
    if (typeof w.api?.audio?.mixer?.onState === 'function') {
      try {
        offState = w.api.audio.mixer.onState((s: Partial<MixerState>) => {
          Object.assign(state, s)
        })
      } catch {}
    }
    loadFromSettings()
  }

  function stopSubs() {
    if (levelsTimer) {
      clearInterval(levelsTimer)
      levelsTimer = null
    }
    if (offLevels) { try { offLevels() } catch {}; offLevels = null }
    if (offState) { try { offState() } catch {}; offState = null }
    subsStarted.value = false
  }

  async function listDevices(): Promise<DeviceSnapshot | null> {
    const w = window as any
    if (typeof w.api?.audio?.listDevices === 'function') {
      try { return await w.api.audio.listDevices() } catch {}
    }
    return null
  }

  return {
    state, levels, installed,
    checkInstall, applyPreset, applyPatch, emergencyStop, startSubs, stopSubs,
    loadFromSettings, listDevices
  }
})
