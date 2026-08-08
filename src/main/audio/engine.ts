import { EventEmitter } from 'events'
import type { MixerState, MixerLevels, MixerPresetId } from './types'
import { defaultMixerState, applyPreset } from './presets'
import {
  BassLib,
  tryLoadNativeBass,
  nativeBassActive,
  BASS_POS_BYTE,
  BASS_ATTRIB_VOL,
  BASS_ATTRIB_FREQ,
  BASS_STREAM_DECODE,
  BASS_DEVICE_ENABLED,
  BASS_DEVICE_INIT,
} from '../../../native/bass'
import { tryLoadNativeRNNoise, nativeRNNoiseActive } from '../../../native/rnnoise'

const pct = (v: number) => Math.max(0, Math.min(1, v / 100))

export class AuroraAudioEngine {
  state: MixerState
  levels: MixerLevels
  needReload: number

  _playing: boolean
  _musicPath: string | null
  _musicStream: number
  _musicPos: number
  _musicDurSec: number
  _musicSampleRate: number
  _playbackRate: number
  _monitorStream: number
  _mixerStream: number
  _micStream: number
  _musicDecodeStream: number  // decode copy of music for mixer (on VB-CABLE device)
  _defaultDeviceId: number    // default playback device (speakers)
  _vbcableDeviceId: number    // VB-CABLE Input device ID

  nativeOk: boolean
  rnnoiseOk: boolean

  emitter: EventEmitter

  private _tickTimer: NodeJS.Timeout | null = null
  private _mixerRunning: boolean = false
  private _started: boolean = false

  constructor() {
    this.state = defaultMixerState(-1, -1, -1)
    this.levels = { musicL: 0, musicR: 0, micL: 0, micR: 0, outL: 0, outR: 0 }
    this.needReload = 0

    this._playing = false
    this._musicPath = null
    this._musicStream = 0
    this._musicPos = 0
    this._musicDurSec = 0
    this._musicSampleRate = 0
    this._playbackRate = 1
    this._monitorStream = 0
    this._mixerStream = 0
    this._micStream = 0
    this._musicDecodeStream = 0
    this._defaultDeviceId = -1
    this._vbcableDeviceId = -1

    this.nativeOk = false
    this.rnnoiseOk = false

    this.emitter = new EventEmitter()
    this.emitter.setMaxListeners(50)
  }

  async start(): Promise<void> {
    if (this._started) return
    this._started = true

    try {
      const rBass = await tryLoadNativeBass()
      this.nativeOk = rBass.ok
    } catch {
      this.nativeOk = nativeBassActive() || !!BassLib
    }
    try {
      const rRnn = await tryLoadNativeRNNoise()
      this.rnnoiseOk = rRnn.ok
    } catch {
      this.rnnoiseOk = nativeRNNoiseActive()
    }

    try {
      if (BassLib?.BASS_Init) BassLib.BASS_Init(0xFFFFFFFF, this.state.sampleRate ?? 48000, 0, 0, 0)
    } catch {}
    try {
      if (BassLib?.BASS_RecordInit) BassLib.BASS_RecordInit(0xFFFFFFFF)
    } catch {}

    // 枚举 BASS 播放设备，找出默认设备和 VB-CABLE 设备
    this._enumerateBassDevices()

    this._tickTimer = setInterval(() => this._onTick(), 500)
  }

  async loadMusicFile(pathStr: string): Promise<boolean> {
    this._musicPath = pathStr
    this._musicPos = 0
    this._playing = false

    const isNative = this.nativeOk && nativeBassActive()
    console.log('[engine] loadMusicFile:', pathStr, '| native:', isNative)

    try {
      if (this._musicStream && BassLib?.BASS_StreamFree) {
        try { BassLib.BASS_StreamFree(this._musicStream) } catch {}
        this._musicStream = 0
      }
      // 创建音乐流之前，确保 BASS 当前设备是默认播放设备
      if (BassLib?.BASS_SetDevice) {
        try { BassLib.BASS_SetDevice(0xFFFFFFFF) } catch {}
      }

      if (isNative && BassLib?.BASS_StreamCreateFileW) {
        // 用 Unicode 版本，路径转 UTF-16 Buffer 避免编码问题
        const pathBuf = Buffer.from(pathStr + '\0', 'utf16le')
        const handle = BassLib.BASS_StreamCreateFileW(0, pathBuf, 0, 0, 0)
        console.log('[engine] BASS_StreamCreateFileW handle:', handle, '| BASS_ErrorGetCode:', BassLib.BASS_ErrorGetCode ? BassLib.BASS_ErrorGetCode() : 'N/A')
        if (!handle) {
          // native 模式下创建失败，返回 false，不走 stub
          console.error('[engine] BASS_StreamCreateFileW failed, error:', BassLib.BASS_ErrorGetCode ? BassLib.BASS_ErrorGetCode() : 'N/A')
          return false
        }
        this._musicStream = handle
        // 获取时长
        try {
          const lenBytes = BassLib.BASS_ChannelGetLength?.(handle, BASS_POS_BYTE)
          console.log('[engine] lenBytes:', lenBytes)
          if (lenBytes != null && lenBytes > 0) {
            this._musicDurSec = Number(lenBytes) / ((this.state.sampleRate ?? 48000) * 4)
            console.log('[engine] duration:', this._musicDurSec, 'sec')
          }
        } catch (e) { console.error('[engine] getLength failed:', e) }
        // 如果 BASS 获取时长失败，用 music-metadata 补充
        if (!this._musicDurSec || this._musicDurSec <= 0) {
          try {
            const { parseFile } = await import('music-metadata')
            const meta = await parseFile(pathStr, { duration: true, skipCovers: true })
            if (typeof meta.format?.duration === 'number' && isFinite(meta.format.duration) && meta.format.duration > 0) {
              this._musicDurSec = meta.format.duration
              console.log('[engine] duration from music-metadata:', this._musicDurSec)
            }
          } catch (e) { console.error('[engine] music-metadata failed:', e) }
        }
        this._applyMusicGainToBass()
        if (this._playbackRate !== 1) this.setPlaybackRate(this._playbackRate)
        this.needReload++
        if (this._mixerRunning) this._updateMusicInMixer()
        return true
      } else if (BassLib?.BASS_StreamCreateFile && !isNative) {
        // stub 模式
        const handle = BassLib.BASS_StreamCreateFile(0, pathStr, 0, 0, 0)
        if (handle) {
          this._musicStream = handle
          this._musicDurSec = 240
          try {
            const { parseFile } = await import('music-metadata')
            const meta = await parseFile(pathStr, { duration: true, skipCovers: true })
            if (typeof meta.format?.duration === 'number' && isFinite(meta.format.duration) && meta.format.duration > 0) {
              this._musicDurSec = meta.format.duration
            }
          } catch {}
          this.needReload++
          return true
        }
      }
    } catch (e) {
      console.error('[engine] loadMusicFile error:', e)
    }

    // stub fallback
    this._musicStream = Math.floor(Math.random() * 10000) + 5000
    this.needReload++
    return !isNative  // native 模式下失败返回 false，stub 模式返回 true
  }

  /** 当混音已启动但音乐发生变化（加载新歌/停止/继续）时，同步更新混音器中的 decode stream */
  private _updateMusicInMixer() {
    if (!this._mixerStream || !BassLib || !this._mixerRunning) return
    console.log('[mixer] syncing music to running mixer (playing=', this._playing, ')')
    try {
      // 先移除旧的 decode stream
      if (this._musicDecodeStream && BassLib.BASS_Mixer_ChannelRemove) {
        try { BassLib.BASS_Mixer_ChannelRemove(this._mixerStream, this._musicDecodeStream) } catch {}
      }
      if (this._musicDecodeStream && BassLib.BASS_StreamFree) {
        try { BassLib.BASS_StreamFree(this._musicDecodeStream) } catch {}
        this._musicDecodeStream = 0
      }
      // 如果当前有播放的音乐，创建新的 decode stream 并添加
      if (this._musicPath && this._playing && BassLib.BASS_StreamCreateFileW && BassLib.BASS_Mixer_StreamAddChannel) {
        const pathBuf = Buffer.from(this._musicPath + '\0', 'utf16le')
        this._musicDecodeStream = BassLib.BASS_StreamCreateFileW(0, pathBuf, 0, 0, BASS_STREAM_DECODE) || 0
        console.log('[mixer] created decode stream (W) for mixer sync, handle=', this._musicDecodeStream, 'error=', BassLib.BASS_ErrorGetCode ? BassLib.BASS_ErrorGetCode() : 'N/A')
        if (this._musicDecodeStream) {
          // 同步音量
          if (BassLib.BASS_ChannelSetAttribute) {
            BassLib.BASS_ChannelSetAttribute(this._musicDecodeStream, BASS_ATTRIB_VOL, pct(this.state.musicGain))
          }
          // 同步播放位置
          if (this._musicPos > 0 && BassLib.BASS_ChannelSetPosition) {
            const bytes = this._musicPos * (this.state.sampleRate ?? 48000) * 4
            try { BassLib.BASS_ChannelSetPosition(this._musicDecodeStream, bytes, BASS_POS_BYTE) } catch {}
          }
          const r = BassLib.BASS_Mixer_StreamAddChannel(this._mixerStream, this._musicDecodeStream, 0)
          console.log('[mixer] added music decode to running mixer, result=', r)
        }
      }
    } catch (e) { console.error('[mixer] sync music to mixer error:', e) }
  }

  private _applyMusicGainToBass() {
    // 本地播放音量 = musicGain × monitorGain（monitorGain = 本地监听比例）
    const vol = pct(this.state.musicGain) * pct(this.state.monitorGain)
    try {
      if (BassLib?.BASS_ChannelSetAttribute && this._musicStream) {
        BassLib.BASS_ChannelSetAttribute(this._musicStream, BASS_ATTRIB_VOL, vol)
      }
    } catch {}
  }

  play(): MixerState {
    this._playing = true
    try {
      if (BassLib?.BASS_ChannelPlay && this._musicStream) {
        BassLib.BASS_ChannelPlay(this._musicStream, 0)
      }
    } catch {}
    // 如果混音已启动，同步把音乐加入混音器
    if (this._mixerRunning) this._updateMusicInMixer()
    this.emitter.emit('state', this.getState())
    return this.getState()
  }

  pause(): MixerState {
    this._playing = false
    try {
      if (BassLib?.BASS_ChannelPause && this._musicStream) {
        BassLib.BASS_ChannelPause(this._musicStream)
      }
    } catch {}
    // 如果混音已启动，把音乐从混音器移除（暂停时队友不该继续听到音乐）
    if (this._mixerRunning) this._updateMusicInMixer()
    this.emitter.emit('state', this.getState())
    return this.getState()
  }

  positionSec(): number {
    try {
      if (this.nativeOk && nativeBassActive() && BassLib?.BASS_ChannelGetPosition && this._musicStream) {
        const posBytes = BassLib.BASS_ChannelGetPosition(this._musicStream, BASS_POS_BYTE)
        if (posBytes != null) this._musicPos = Number(posBytes) / ((this.state.sampleRate ?? 48000) * 4)
      }
    } catch {}
    return this._musicPos
  }

  durationSec(): number {
    return this._musicDurSec
  }

  seek(sec: number): MixerState {
    const s = Math.max(0, sec)
    this._musicPos = s
    try {
      if (this.nativeOk && nativeBassActive() && BassLib?.BASS_ChannelSetPosition && this._musicStream) {
        BassLib.BASS_ChannelSetPosition(this._musicStream, s * (this.state.sampleRate ?? 48000) * 4, BASS_POS_BYTE)
      }
    } catch {}
    // 混音同步：重新加载 decode stream 定位到新位置
    if (this._mixerRunning) this._updateMusicInMixer()
    this.emitter.emit('state', this.getState())
    return this.getState()
  }

  setMusicVolume(v: number): MixerState {
    const gain = Math.max(0, Math.min(100, v))
    this.state.musicGain = gain
    this._applyMusicGainToBass()
    // 同步混音器中的 decode 音乐音量
    try {
      if (this._musicDecodeStream && BassLib?.BASS_ChannelSetAttribute) {
        BassLib.BASS_ChannelSetAttribute(this._musicDecodeStream, BASS_ATTRIB_VOL, pct(gain))
      }
    } catch {}
    this.emitter.emit('state', this.getState())
    return this.getState()
  }

  setPlaybackRate(rate: number): MixerState {
    const r = Math.max(0.1, Math.min(10, Number.isFinite(rate) ? rate : 1))
    this._playbackRate = r
    try {
      if (this.nativeOk && nativeBassActive() && BassLib?.BASS_ChannelSetAttribute && this._musicStream) {
        if (r === 1) {
          BassLib.BASS_ChannelSetAttribute(this._musicStream, BASS_ATTRIB_FREQ, 0)
        } else if (this._musicSampleRate > 0) {
          BassLib.BASS_ChannelSetAttribute(this._musicStream, BASS_ATTRIB_FREQ, Math.round(this._musicSampleRate * r))
        }
      }
    } catch {}
    this.emitter.emit('state', this.getState())
    return this.getState()
  }

  getPlaybackRate(): number {
    return this._playbackRate
  }

  applyPreset(id: MixerPresetId): MixerState {
    this.state = applyPreset(this.state, id)
    this._applyMusicGainToBass()
    this.emitter.emit('state', this.getState())
    return this.getState()
  }

  applyState(patch: Partial<MixerState>): MixerState {
    const prevOn = this.state.on
    this.state = { ...this.state, ...patch }
    if (patch.musicGain != null) {
      this._applyMusicGainToBass()
      // 同步混音器 decode 音乐音量
      try {
        if (this._musicDecodeStream && BassLib?.BASS_ChannelSetAttribute) {
          BassLib.BASS_ChannelSetAttribute(this._musicDecodeStream, BASS_ATTRIB_VOL, pct(this.state.musicGain))
        }
      } catch {}
    }
    if (patch.micGain != null) {
      // 同步麦克风流音量（混入混音器的那一路）
      try {
        if (this._micStream && BassLib?.BASS_ChannelSetAttribute) {
          BassLib.BASS_ChannelSetAttribute(this._micStream, BASS_ATTRIB_VOL, pct(this.state.micGain))
        }
      } catch {}
    }
    if (patch.monitorGain != null) {
      // 本地监听音量 = monitorGain 控制用户本地扬声器上音乐播放的音量
      // musicGain 控制混入混音器给队友听的音乐音量，monitorGain 控制自己听到的音量
      // 实际本地音量 = musicGain × monitorGain / 100
      try {
        if (this._musicStream && BassLib?.BASS_ChannelSetAttribute) {
          const localVol = pct(this.state.musicGain) * pct(this.state.monitorGain)
          BassLib.BASS_ChannelSetAttribute(this._musicStream, BASS_ATTRIB_VOL, localVol)
        }
      } catch {}
    }
    // denoiseStrength: RNNoise 降噪强度，目前为占位参数，BASS 层面不做实际处理
    // 未来接入 RNNoise 时在此应用
    if (this.state.on && !prevOn) this._startMixerLoop()
    else if (!this.state.on && prevOn) this._stopMixerLoop()
    this.emitter.emit('state', this.getState())
    return this.getState()
  }

  pollLevels(): MixerLevels {
    if (this.nativeOk && nativeBassActive()) {
      return { ...this.levels }
    }
    const mg = pct(this.state.musicGain)
    const mc = pct(this.state.micGain)
    const monitor = pct(this.state.monitorGain)
    const playingFactor = this._playing ? (0.5 + Math.random() * 0.4) : 0
    const onFactor = this.state.on ? 1 : 0.15
    const musicBase = Math.min(1, mg * playingFactor * onFactor)
    const micBase = Math.min(1, mc * (0.3 + Math.random() * 0.6) * (this.state.on ? 1 : 0.2))
    const musicL = musicBase * (0.92 + Math.random() * 0.12)
    const musicR = musicBase * (0.92 + Math.random() * 0.12)
    const micL = micBase * (0.95 + Math.random() * 0.1)
    const micR = micBase * (0.95 + Math.random() * 0.1)
    const outL = Math.min(1, (musicL * 0.55 + micL * 0.7) * (0.9 + monitor * 0.1))
    const outR = Math.min(1, (musicR * 0.55 + micR * 0.7) * (0.9 + monitor * 0.1))
    this.levels = { musicL, musicR, micL, micR, outL, outR }
    return { ...this.levels }
  }

  stopAll(): MixerState {
    this.state.on = false
    this._stopMixerLoop()
    try {
      if (BassLib) {
        if (this._musicStream && BassLib.BASS_ChannelStop) BassLib.BASS_ChannelStop(this._musicStream)
        if (this._musicDecodeStream && BassLib.BASS_StreamFree) { BassLib.BASS_StreamFree(this._musicDecodeStream); this._musicDecodeStream = 0 }
        if (this._mixerStream && BassLib.BASS_StreamFree) { BassLib.BASS_StreamFree(this._mixerStream); this._mixerStream = 0 }
        if (BassLib.BASS_RecordFree) { BassLib.BASS_RecordFree(); this._micStream = 0 }
      }
    } catch {}
    this._playing = false
    this.levels = { musicL: 0, musicR: 0, micL: 0, micR: 0, outL: 0, outR: 0 }
    this.emitter.emit('state', this.getState())
    this.emitter.emit('levels', { ...this.levels })
    return this.getState()
  }

  getState(): MixerState {
    return { ...this.state }
  }

  /** 枚举 BASS 播放设备，找出默认设备和 VB-CABLE 设备 */
  private _enumerateBassDevices() {
    if (!nativeBassActive() || !BassLib?.BASS_GetDeviceInfo) return
    const vbcableId = this.state.virtualDeviceId
    console.log('[bass] enumerating devices, state.virtualDeviceId =', vbcableId)
    for (let i = 0; i < 64; i++) {
      try {
        const info = BassLib.BASS_GetDeviceInfo(i)
        if (!info) break
        const isInit = (info.flags & BASS_DEVICE_INIT) !== 0
        const isEnabled = (info.flags & BASS_DEVICE_ENABLED) !== 0
        console.log(`[bass] device ${i}: flags=0x${(info.flags >>> 0).toString(16)} enabled=${isEnabled} init=${isInit}`)
        if (isInit && this._defaultDeviceId < 0) {
          this._defaultDeviceId = i
          console.log('[bass] default device =', i)
        }
        // VB-CABLE 设备：优先使用 state.virtualDeviceId；否则找非默认的 ENABLED 设备
        if (vbcableId >= 0 && i === vbcableId) {
          this._vbcableDeviceId = i
          console.log('[bass] VB-CABLE device (from state) =', i)
        }
      } catch { break }
    }
    // 如果 state.virtualDeviceId 不匹配任何 BASS 设备，尝试用其他方式找到 VB-CABLE
    if (this._vbcableDeviceId < 0) {
      console.log('[bass] virtualDeviceId not found in BASS enumeration, trying PowerShell detection...')
      this._findVbcableDeviceAsync()
    }
  }

  private async _findVbcableDeviceAsync() {
    try {
      const { execFile } = await import('child_process')
      const { promisify } = await import('util')
      const execFileP = promisify(execFile)
      const script = [
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
        '$devs = Get-PnpDevice -Class AudioEndpoint -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq "OK" }',
        '$idx = 0',
        'foreach ($dev in $devs) {',
        '  $name = $dev.FriendlyName',
        '  if ($name -match "16ch") { continue }',
        '  $isRender = $name -match "speaker|render|cable input|扬声器"',
        '  $isCapture = $name -match "microphone|capture|cable output|麦克风"',
        '  if ($isRender) { Write-Output ("RENDER|" + $idx + "|" + $name) }',
        '  $idx++',
        '}',
      ].join('; ')
      const { stdout } = await execFileP('powershell', ['-NoProfile', '-Command', script], { timeout: 8000, windowsHide: true })
      const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(l => l)
      console.log('[bass] PowerShell render devices:', lines)
      // PowerShell 设备顺序应该和 BASS 枚举顺序接近
      // 找到 CABLE Input 在 render 设备列表中的位置，然后尝试匹配 BASS 设备 ID
      let renderIdx = -1
      let cableIdx = -1
      for (const line of lines) {
        const [dir, idxStr, name] = line.split('|')
        if (dir === 'RENDER') {
          renderIdx++
          if (name.toLowerCase().includes('cable input')) {
            cableIdx = renderIdx
            console.log('[bass] CABLE Input found at render index', cableIdx, ':', name)
          }
        }
      }
      // 尝试将 render 索引映射到 BASS 设备 ID
      // PowerShell 的 AudioEndpoint 枚举和 BASS 的设备枚举可能顺序不同
      // 但通常 BASS 会有一些额外的设备（如映射设备），所以 PowerShell 的第 N 个 render 设备
      // 对应 BASS 的第 N+offset 个 ENABLED 设备
      if (cableIdx >= 0 && nativeBassActive() && BassLib?.BASS_GetDeviceInfo) {
        // 枚举 BASS ENABLED 设备，找出第 cableIdx 个非 INIT 的设备
        let enabledNonInitCount = 0
        for (let i = 0; i < 64; i++) {
          try {
            const info = BassLib.BASS_GetDeviceInfo(i)
            if (!info) break
            const isInit = (info.flags & BASS_DEVICE_INIT) !== 0
            const isEnabled = (info.flags & BASS_DEVICE_ENABLED) !== 0
            if (isEnabled && !isInit) {
              if (enabledNonInitCount === cableIdx) {
                this._vbcableDeviceId = i
                console.log('[bass] VB-CABLE device matched to BASS device', i)
                break
              }
              enabledNonInitCount++
            }
          } catch { break }
        }
      }
    } catch (e) {
      console.log('[bass] PowerShell VB-CABLE detection failed:', e)
    }
  }

  private _startMixerLoop() {
    if (this._mixerRunning) return
    this._mixerRunning = true
    console.log('[mixer] starting mixer loop...')

    try {
      if (!BassLib || !nativeBassActive()) {
        console.error('[mixer] BASS not active, cannot start mixer')
        return
      }

      const vbcableId = this._vbcableDeviceId >= 0 ? this._vbcableDeviceId : this.state.virtualDeviceId
      console.log('[mixer] VB-CABLE device ID:', vbcableId, 'default device ID:', this._defaultDeviceId)

      // 1. 初始化 VB-CABLE Input 设备（播放设备 = 虚拟输入端）
      if (vbcableId >= 0 && BassLib.BASS_Init) {
        try {
          const r = BassLib.BASS_Init(vbcableId, this.state.sampleRate ?? 48000, 0, 0, 0)
          console.log('[mixer] BASS_Init VB-CABLE device', vbcableId, 'result:', r)
        } catch (e) {
          console.error('[mixer] BASS_Init VB-CABLE failed:', e)
        }
      }

      // 2. 切换到 VB-CABLE 设备
      if (vbcableId >= 0 && BassLib.BASS_SetDevice) {
        try {
          const r = BassLib.BASS_SetDevice(vbcableId)
          console.log('[mixer] BASS_SetDevice to VB-CABLE:', r)
        } catch (e) {
          console.error('[mixer] BASS_SetDevice failed:', e)
        }
      }

      // 3. 在 VB-CABLE 设备上创建混音器
      if (!this._mixerStream && BassLib.BASS_Mixer_StreamCreate) {
        this._mixerStream = BassLib.BASS_Mixer_StreamCreate(this.state.sampleRate ?? 48000, 2, 0) || 0
        console.log('[mixer] created mixer stream on VB-CABLE, handle =', this._mixerStream)
      }

      // 4. 创建音乐的 decode 副本（decode channel 不绑定设备，可被任何设备的混音器读取）
      if (this._musicPath && BassLib.BASS_StreamCreateFileW) {
        try {
          if (this._musicDecodeStream && BassLib.BASS_StreamFree) {
            BassLib.BASS_StreamFree(this._musicDecodeStream)
            this._musicDecodeStream = 0
          }
          const pathBuf = Buffer.from(this._musicPath + '\0', 'utf16le')
          this._musicDecodeStream = BassLib.BASS_StreamCreateFileW(0, pathBuf, 0, 0, BASS_STREAM_DECODE) || 0
          console.log('[mixer] created music decode stream (W), handle =', this._musicDecodeStream, 'error=', BassLib.BASS_ErrorGetCode ? BassLib.BASS_ErrorGetCode() : 'N/A')
          if (this._musicDecodeStream && BassLib.BASS_ChannelSetAttribute) {
            BassLib.BASS_ChannelSetAttribute(this._musicDecodeStream, BASS_ATTRIB_VOL, pct(this.state.musicGain))
          }
        } catch (e) {
          console.error('[mixer] create music decode stream failed:', e)
        }
      }

      // 5. 开始麦克风录音（使用默认录音设备）
      if (!this._micStream && BassLib.BASS_RecordStart) {
        try {
          this._micStream = BassLib.BASS_RecordStart(this.state.sampleRate ?? 48000, 1, 0, 0, 0) || 0
          console.log('[mixer] created mic stream, handle =', this._micStream, 'error=', BassLib.BASS_ErrorGetCode ? BassLib.BASS_ErrorGetCode() : 'N/A')
          if (this._micStream && BassLib.BASS_ChannelSetAttribute) {
            BassLib.BASS_ChannelSetAttribute(this._micStream, BASS_ATTRIB_VOL, pct(this.state.micGain))
          }
        } catch (e) {
          console.error('[mixer] BASS_RecordStart failed:', e)
        }
      }

      // 6. 将 decode 音乐添加到混音器
      if (this._mixerStream && this._musicDecodeStream && BassLib.BASS_Mixer_StreamAddChannel) {
        try {
          const r = BassLib.BASS_Mixer_StreamAddChannel(this._mixerStream, this._musicDecodeStream, 0)
          console.log('[mixer] added music decode channel to mixer:', r)
        } catch (e) {
          console.error('[mixer] add music to mixer failed:', e)
        }
      }

      // 7. 将麦克风添加到混音器
      if (this._mixerStream && this._micStream && BassLib.BASS_Mixer_StreamAddChannel) {
        try {
          const r = BassLib.BASS_Mixer_StreamAddChannel(this._mixerStream, this._micStream, 0)
          console.log('[mixer] added mic channel to mixer:', r)
        } catch (e) {
          console.error('[mixer] add mic to mixer failed:', e)
        }
      }

      // 8. 播放混音器（输出到 VB-CABLE Input → 游戏队友听到）
      if (this._mixerStream && BassLib.BASS_ChannelPlay) {
        try {
          const r = BassLib.BASS_ChannelPlay(this._mixerStream, 0)
          console.log('[mixer] mixer stream playing on VB-CABLE, result:', r)
        } catch (e) {
          console.error('[mixer] BASS_ChannelPlay failed:', e)
        }
      }

      // 9. 切换回默认播放设备（扬声器/耳机）—— 用户听音乐和游戏声音走这里
      // 用 0xFFFFFFFF (-1) = BASS 默认设备，不依赖可能找不到的 _defaultDeviceId
      if (BassLib.BASS_SetDevice) {
        try {
          BassLib.BASS_SetDevice(0xFFFFFFFF)
          console.log('[mixer] switched back to default playback device (-1)')
        } catch (e) {
          console.error('[mixer] BASS_SetDevice back to default failed:', e)
        }
      }

      // 10. 确保音乐继续在默认扬声器上播放（用户听到）
      if (this._playing && this._musicStream && BassLib.BASS_ChannelPlay) {
        try {
          BassLib.BASS_ChannelPlay(this._musicStream, 0)
          console.log('[mixer] music still playing on default device')
        } catch (e) {
          console.error('[mixer] music playback on default device failed:', e)
        }
      }

      // 11. 创建本地监听流：把混音器的输出也送到默认扬声器（用户可听到混音效果）
      //     通过创建一个 decode 混音器副本，用 push 模式送到默认设备
      //     简化方案：直接把麦克风的录音也播放到默认设备（监听自己的声音）
      if (!this._monitorStream && BassLib.BASS_StreamCreateURL) {
        // 占位：监听功能在非完整 BASS 配置下不可用
      }

      console.log('[mixer] mixer loop started successfully')
    } catch (e) {
      console.error('[mixer] start error:', e)
    }
  }

  private _stopMixerLoop() {
    this._mixerRunning = false
    console.log('[mixer] stopping mixer loop...')
    try {
      // 停止混音器
      if (this._mixerStream && BassLib?.BASS_ChannelStop) {
        try {
          BassLib.BASS_ChannelStop(this._mixerStream)
          console.log('[mixer] mixer stream stopped')
        } catch (e) { console.error('[mixer] stop mixer failed:', e) }
      }
      // 停止麦克风录音
      if (this._micStream && BassLib?.BASS_ChannelStop) {
        try {
          BassLib.BASS_ChannelStop(this._micStream)
          console.log('[mixer] mic stream stopped')
        } catch (e) { console.error('[mixer] stop mic failed:', e) }
      }
      // 从混音器中移除通道
      if (this._mixerStream && this._musicDecodeStream && BassLib?.BASS_Mixer_ChannelRemove) {
        try {
          BassLib.BASS_Mixer_ChannelRemove(this._mixerStream, this._musicDecodeStream)
        } catch {}
      }
      if (this._mixerStream && this._micStream && BassLib?.BASS_Mixer_ChannelRemove) {
        try {
          BassLib.BASS_Mixer_ChannelRemove(this._mixerStream, this._micStream)
        } catch {}
      }
      // 释放 decode 音乐流
      if (this._musicDecodeStream && BassLib?.BASS_StreamFree) {
        try {
          BassLib.BASS_StreamFree(this._musicDecodeStream)
          console.log('[mixer] music decode stream freed')
        } catch {}
        this._musicDecodeStream = 0
      }
      // 确保切回默认播放设备
      if (BassLib?.BASS_SetDevice) {
        try { BassLib.BASS_SetDevice(0xFFFFFFFF) } catch {}
      }
    } catch (e) {
      console.error('[mixer] stop error:', e)
    }
  }

  private _onTick() {
    if (!(this.nativeOk && nativeBassActive()) || !BassLib) {
      if (this._playing && this._musicDurSec > 0) {
        this._musicPos = Math.min(this._musicDurSec, this._musicPos + 0.5)
      }
    } else {
      this.positionSec()
    }
    this.emitter.emit('state', this.getState())
    this.emitter.emit('levels', this.pollLevels())
  }
}
