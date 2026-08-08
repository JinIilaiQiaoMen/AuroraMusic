import { existsSync } from 'fs'
import path from 'path'
import { app } from 'electron'

export const RNNoiseFrameSize = 480

function dllDir() {
  const root = app.isPackaged ? (process as any).resourcesPath : app.getAppPath()
  return path.join(root, 'native', 'rnnoise', 'x64')
}

export function rnnoiseDllExists() {
  try { return existsSync(path.join(dllDir(), 'rnnoise.dll')) } catch { return false }
}

let loaded = false
let lib: any = null

function makeStubLib() {
  return {
    rnnoise_get_size: () => 8,
    rnnoise_init: (buf: any) => buf ?? Buffer.alloc(8),
    rnnoise_destroy: () => {},
    rnnoise_process_frame: (_state: any, out: Buffer, inp: Buffer) => {
      const n = Math.min(RNNoiseFrameSize, inp.length >> 1, out.length >> 1)
      let peak = 0
      for (let i = 0; i < n; i++) {
        const v = inp.readInt16LE(i * 2)
        const g = Math.min(32767, Math.max(-32768, Math.round(v * 0.97)))
        out.writeInt16LE(g, i * 2)
        peak = Math.max(peak, Math.abs(g))
      }
      return peak / 32768
    },
    rnnoise_get_frame_size: () => RNNoiseFrameSize,
  }
}
lib = makeStubLib()

export async function tryLoadNativeRNNoise(): Promise<{ ok: boolean; reason?: string; mode?: string }> {
  let koffi: any = null
  try { koffi = require('koffi') } catch { return { ok: false, reason: 'koffi not installed' } }
  if (!rnnoiseDllExists()) {
    return { ok: true, mode: 'stub-bypass' }
  }
  try {
    const dll = koffi.load(path.join(dllDir(), 'rnnoise'))
    lib = {
      rnnoise_get_size: dll.func('uint32 __stdcall rnnoise_get_size()'),
      rnnoise_init: dll.func('void *__stdcall rnnoise_init(void *buf)'),
      rnnoise_destroy: dll.func('void __stdcall rnnoise_destroy(void *st)'),
      rnnoise_process_frame: dll.func('float __stdcall rnnoise_process_frame(void *st, void *out, void *inp)'),
      rnnoise_get_frame_size: dll.func('int __stdcall rnnoise_get_frame_size()'),
    }
    loaded = true
    return { ok: true, mode: 'native' }
  } catch (e: any) {
    return { ok: true, mode: 'stub-bypass', reason: e?.message ?? String(e) }
  }
}
export function nativeRNNoiseActive() { return loaded }
export function loadRNNoise() { return lib }
export type RnnState = any
