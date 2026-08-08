import { existsSync } from 'fs'
import path from 'path'
import { app } from 'electron'

export type BassHandle = number

export interface BassDeviceInfo {
  name: string
  driver: string
  flags: number
}

export const BASS_DEVICE_ENABLED = 1
export const BASS_DEVICE_DEFAULT = 2
export const BASS_DEVICE_INIT    = 4
export const BASS_DEVICE_LOOPBACK = 8
export const BASS_DEVICE_TYPE_MASK = -256
export const BASS_DEVICE_TYPE_NETWORK    = 12582912
export const BASS_DEVICE_TYPE_SPEAKERS   = 67108864
export const BASS_DEVICE_TYPE_LINELEVEL  = 50331648
export const BASS_DEVICE_TYPE_HEADPHONES = 33554432
export const BASS_DEVICE_TYPE_MICROPHONE = 16777216
export const BASS_DEVICE_TYPE_HEADSET    = 524288000
export const BASS_DEVICE_TYPE_DIGITAL    = 83886080
export const BASS_POS_BYTE = 0
export const BASS_ATTRIB_VOL = 2
export const BASS_ATTRIB_FREQ = 1
export const BASS_ACTIVE_STOPPED = 0
export const BASS_ACTIVE_PLAYING = 1
export const BASS_ACTIVE_PAUSED  = 3
export const BASS_STREAM_AUTOFREE = 0x40000
export const BASS_SAMPLE_FLOAT = 0x100
export const BASS_STREAM_DECODE = 0x200000

function x64Dir() {
  const root = app.isPackaged ? (process as any).resourcesPath : app.getAppPath()
  return path.join(root, 'native', 'bass', 'x64')
}
export function bassDllExists(): { bass: boolean; mix: boolean } {
  try {
    const d = x64Dir()
    return { bass: existsSync(path.join(d, 'bass.dll')), mix: existsSync(path.join(d, 'bassmix.dll')) }
  } catch { return { bass: false, mix: false } }
}

let _koffi: any = null
let _bassLib: any = null
let _bassLibLoaded = false
export function ffiAvailable() { return !!_koffi }

function loadKoffiIfPossible(): boolean {
  if (_koffi !== null) return true
  try {
    _koffi = require('koffi')
    return true
  } catch { _koffi = null; return false }
}

function makeStub() {
  const dev: BassDeviceInfo[] = [
    { name: '默认扬声器 (Realtek(R) Audio)', driver: 'RTKVHD64.sys', flags: BASS_DEVICE_ENABLED | BASS_DEVICE_DEFAULT | BASS_DEVICE_INIT },
    { name: 'CABLE Input (VB-Audio Virtual Cable)', driver: 'VBCABLE_Setup_x64.sys', flags: BASS_DEVICE_ENABLED },
    { name: '耳机 (HyperX Cloud II)', driver: 'USBAUDIO.sys', flags: BASS_DEVICE_ENABLED | BASS_DEVICE_TYPE_HEADPHONES },
  ]
  const rec: BassDeviceInfo[] = [
    { name: '默认麦克风 (Realtek(R) Audio)', driver: 'RTKVHD64.sys', flags: BASS_DEVICE_ENABLED | BASS_DEVICE_DEFAULT | BASS_DEVICE_TYPE_MICROPHONE },
    { name: 'CABLE Output (VB-Audio Virtual Cable)', driver: 'VBCABLE_Setup_x64.sys', flags: BASS_DEVICE_ENABLED },
    { name: '耳机麦克风 (HyperX Cloud II)', driver: 'USBAUDIO.sys', flags: BASS_DEVICE_ENABLED | BASS_DEVICE_TYPE_MICROPHONE },
  ]
  let musicHandleCounter = 1000
  const channels = new Map<number, {path?:string; pos:number; dur:number; vol:number; active:number; paused:boolean}>()

  return {
    BASS_GetVersion: () => 0x02040F00,
    BASS_ErrorGetCode: () => 0,
    BASS_Init: () => 1,
    BASS_Free: () => 1,
    BASS_SetDevice: () => 1,
    BASS_RecordInit: () => 1,
    BASS_RecordSetDevice: () => 1,
    BASS_GetDeviceCount: () => dev.length,
    BASS_RecordGetDeviceCount: () => rec.length,
    BASS_GetDeviceInfo: (i: number) => {
      if (i < 0 || i >= dev.length) return null
      return dev[i]
    },
    BASS_RecordGetDeviceInfo: (i: number) => {
      if (i < 0 || i >= rec.length) return null
      return rec[i]
    },
    _stubListDevices: () => ({ playback: dev, recording: rec }),
    BASS_StreamCreateFile: (_mem: any, _ptr: any, _off: any, _len: any, _flags: any) => {
      const h = ++musicHandleCounter
      channels.set(h, { pos: 0, dur: 240, vol: 0.9, active: 0, paused: true })
      return h
    },
    BASS_StreamCreateFileW: (_mem: any, _ptr: any, _off: any, _len: any, _flags: any) => {
      const h = ++musicHandleCounter
      channels.set(h, { pos: 0, dur: 240, vol: 0.9, active: 0, paused: true })
      return h
    },
    BASS_StreamFree: (h: number) => { const e = channels.delete(h); return e ? 1 : 0 },
    BASS_ChannelPlay: (h: number, _r: any) => { const c = channels.get(h); if (c) { c.active = 1; c.paused = false; return 1 } return 0 },
    BASS_ChannelPause: (h: number) => { const c = channels.get(h); if (c) { c.active = 3; c.paused = true; return 1 } return 0 },
    BASS_ChannelStop: (h: number) => { const c = channels.get(h); if (c) { c.active = 0; c.paused = true; c.pos = 0; return 1 } return 0 },
    BASS_ChannelIsActive: (h: number) => channels.get(h)?.active ?? 0,
    BASS_ChannelSetAttribute: (h: number, att: number, v: number) => {
      const c = channels.get(h); if (!c) return 0
      if (att === BASS_ATTRIB_VOL) c.vol = v
      return 1
    },
    BASS_ChannelGetAttribute: (h: number, att: number) => {
      const c = channels.get(h); if (!c) return -1
      if (att === BASS_ATTRIB_VOL) return c.vol
      return -1
    },
    BASS_ChannelGetLength: (h: number) => channels.get(h)?.dur ?? 0,
    BASS_ChannelGetPosition: (h: number) => channels.get(h)?.pos ?? 0,
    BASS_ChannelSetPosition: (h: number, p: number) => { const c = channels.get(h); if (c) { c.pos = p; return 1 } return 0 },
    BASS_Mixer_StreamCreate: () => 2001,
    BASS_Mixer_StreamAddChannel: () => 1,
    BASS_Mixer_ChannelRemove: () => 1,
    BASS_RecordStart: () => 3001,
    BASS_ChannelSetDSP: () => 1,
    BASS_ChannelRemoveDSP: () => 1,
  } as any
}

export const BassLib = makeStub() as any

export async function tryLoadNativeBass(): Promise<{ ok: boolean; reason?: string }> {
  const koffiOk = loadKoffiIfPossible()
  if (!koffiOk) return { ok: false, reason: 'koffi not installed (run: npm i koffi)' }
  const { bass, mix } = bassDllExists()
  if (!bass) return { ok: false, reason: `bass.dll missing at ${x64Dir()}. See native/bass/x64/README.txt` }

  try {
    const koffi = _koffi

    // BASS_DEVICEINFO layout (x64): name (8B ptr) + driver (8B ptr) + flags (4B) + padding (4B) = 24B
    const BASS_DEVICEINFO = koffi.struct({
      name: 'char *',
      driver: 'char *',
      flags: 'uint32',
    })

    // Note: We skip BASS string reading (unreliable pointer access from koffi v3)
    // Device names are obtained via PowerShell enumeration in devices.ts instead.
    // BASS is still used for flags/device detection via the struct's flags field.
    const HANDLE = 'uintptr'
    const QWORD = 'uint64'

    const bassDll = koffi.load(path.join(x64Dir(), 'bass'))

    const bassFns: any = {}
    bassFns.BASS_GetVersion = bassDll.func('uint32 __stdcall BASS_GetVersion()')
    bassFns.BASS_ErrorGetCode = bassDll.func('uint32 __stdcall BASS_ErrorGetCode()')
    bassFns.BASS_Init = bassDll.func('int __stdcall BASS_Init(uint32 device, uint32 freq, uint32 flags, void *win, void *clsid)')
    bassFns.BASS_Free = bassDll.func('int __stdcall BASS_Free()')
    bassFns.BASS_SetDevice = bassDll.func('int __stdcall BASS_SetDevice(uint32 device)')
    bassFns.BASS_RecordInit = bassDll.func('int __stdcall BASS_RecordInit(uint32 device)')
    bassFns.BASS_RecordFree = bassDll.func('int __stdcall BASS_RecordFree()')
    bassFns.BASS_RecordSetDevice = bassDll.func('int __stdcall BASS_RecordSetDevice(uint32 device)')
    // Use void* + decode pattern since koffi `_Out_` qualifier does not work for structs in v3
    const _rawGetDeviceInfo = bassDll.func('int __stdcall BASS_GetDeviceInfo(uint32 dev, void *info)')
    const _rawGetRecDeviceInfo = bassDll.func('int __stdcall BASS_RecordGetDeviceInfo(uint32 dev, void *info)')
    bassFns.BASS_GetDeviceInfo = (dev: number) => {
      const buf = Buffer.alloc(24)
      const r = _rawGetDeviceInfo(dev, buf)
      if (!r) return null
      const flags = buf.readUInt32LE(16)
      // Note: name/driver strings from BASS are unreliable via koffi v3 pointer reading.
      // Names will be populated by PowerShell enumeration in devices.ts.
      return { name: '', driver: '', flags }
    }
    bassFns.BASS_RecordGetDeviceInfo = (dev: number) => {
      const buf = Buffer.alloc(24)
      const r = _rawGetRecDeviceInfo(dev, buf)
      if (!r) return null
      const flags = buf.readUInt32LE(16)
      return { name: '', driver: '', flags }
    }
    bassFns.BASS_StreamCreateFile = bassDll.func(`${HANDLE} __stdcall BASS_StreamCreateFile(int mem, void *file, ${QWORD} offset, ${QWORD} length, uint32 flags)`)
    bassFns.BASS_StreamCreateFileW = bassDll.func(`${HANDLE} __stdcall BASS_StreamCreateFileW(int mem, void *file, ${QWORD} offset, ${QWORD} length, uint32 flags)`)
    bassFns.BASS_StreamFree = bassDll.func('int __stdcall BASS_StreamFree(uintptr handle)')
    bassFns.BASS_ChannelPlay = bassDll.func('int __stdcall BASS_ChannelPlay(uintptr handle, int restart)')
    bassFns.BASS_ChannelPause = bassDll.func('int __stdcall BASS_ChannelPause(uintptr handle)')
    bassFns.BASS_ChannelStop = bassDll.func('int __stdcall BASS_ChannelStop(uintptr handle)')
    bassFns.BASS_ChannelIsActive = bassDll.func('uint32 __stdcall BASS_ChannelIsActive(uintptr handle)')
    // BASS_CHANNELINFO: freq (4B) + chans (4B) + flags (4B) + ctype (4B) + orig (4B) + origHandle (4B)
    //                    + decoder (8B ptr) + visa (4B) + _pad (4B)  = 40 bytes
    //                    + dither (4B) + _pad2 (4B) = 48 bytes (newer versions)
    // Use 64 bytes to be safe
    const _rawChannelGetInfo = bassDll.func('int __stdcall BASS_ChannelGetInfo(uintptr handle, void *info)')
    bassFns.BASS_ChannelGetInfo = (handle: number) => {
      const buf = Buffer.alloc(64)
      const r = _rawChannelGetInfo(handle, buf)
      if (!r) return null
      // freq (uint32 LE at offset 0)
      const freq = buf.readUInt32LE(0)
      const chans = buf.readUInt32LE(4)
      const flags = buf.readUInt32LE(8)
      return { freq, chans, flags }
    }
    bassFns.BASS_ChannelSetAttribute = bassDll.func('int __stdcall BASS_ChannelSetAttribute(uintptr handle, uint32 attr, float value)')
    // BASS_ChannelGetAttribute returns the value directly, no _Out_ needed
    bassFns.BASS_ChannelGetAttribute = bassDll.func('float __stdcall BASS_ChannelGetAttribute(uintptr handle, uint32 attr)')
    bassFns.BASS_ChannelGetLength = bassDll.func(`${QWORD} __stdcall BASS_ChannelGetLength(uintptr handle, uint32 mode)`)
    bassFns.BASS_ChannelGetPosition = bassDll.func(`${QWORD} __stdcall BASS_ChannelGetPosition(uintptr handle, uint32 mode)`)
    bassFns.BASS_ChannelSetPosition = bassDll.func('int __stdcall BASS_ChannelSetPosition(uintptr handle, ${QWORD} pos, uint32 mode)')
    bassFns.BASS_RecordStart = bassDll.func(`${HANDLE} __stdcall BASS_RecordStart(uint32 freq, uint32 chans, uint32 flags, void *proc, void *user)`)
    bassFns.BASS_ChannelSetDSP = bassDll.func('uint32 __stdcall BASS_ChannelSetDSP(uintptr handle, void *dsp, uintptr priority)')
    bassFns.BASS_ChannelRemoveDSP = bassDll.func('int __stdcall BASS_ChannelRemoveDSP(uintptr handle, void *dsp)')

    if (mix) {
      const mixDll = koffi.load(path.join(x64Dir(), 'bassmix'))
      bassFns.BASS_Mixer_StreamCreate = mixDll.func(`${HANDLE} __stdcall BASS_Mixer_StreamCreate(uint32 freq, uint32 chans, uint32 flags)`)
      bassFns.BASS_Mixer_StreamAddChannel = mixDll.func('int __stdcall BASS_Mixer_StreamAddChannel(uintptr mixer, uintptr channel, uint32 flags)')
      bassFns.BASS_Mixer_ChannelRemove = mixDll.func('int __stdcall BASS_Mixer_ChannelRemove(uintptr mixer, uintptr channel)')
    }

    Object.assign(BassLib, bassFns)

    // 关键修复：加载完成后立即初始化默认设备，确保 BASS_GetDeviceInfo 能正常工作
    try {
      if (bassFns.BASS_Init) bassFns.BASS_Init(0xFFFFFFFF, 48000, 0, 0, 0)
    } catch {}
    try {
      if (bassFns.BASS_RecordInit) bassFns.BASS_RecordInit(0xFFFFFFFF)
    } catch {}

    _bassLib = true
    return { ok: true }
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) }
  }
}

export function nativeBassActive() { return !!_bassLib }
