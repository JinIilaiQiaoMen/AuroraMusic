import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  BassLib,
  nativeBassActive,
  BASS_DEVICE_ENABLED,
  BASS_DEVICE_DEFAULT,
  BASS_DEVICE_INIT,
  BASS_DEVICE_LOOPBACK,
  BASS_DEVICE_TYPE_MASK,
  BASS_DEVICE_TYPE_NETWORK,
  BASS_DEVICE_TYPE_SPEAKERS,
  BASS_DEVICE_TYPE_LINELEVEL,
  BASS_DEVICE_TYPE_HEADPHONES,
  BASS_DEVICE_TYPE_MICROPHONE,
  BASS_DEVICE_TYPE_HEADSET,
  BASS_DEVICE_TYPE_DIGITAL,
} from '../../../native/bass'
import type { AudioDevice, AudioDeviceType, DeviceSnapshot } from './types'

const execFileP = promisify(execFile)

function mapType(flags: number, isRecording: boolean): AudioDeviceType {
  const t = flags & BASS_DEVICE_TYPE_MASK
  if (t === BASS_DEVICE_TYPE_SPEAKERS) return 'speaker'
  if (t === BASS_DEVICE_TYPE_HEADPHONES) return 'headphones'
  if (t === BASS_DEVICE_TYPE_HEADSET) return 'headset'
  if (t === BASS_DEVICE_TYPE_MICROPHONE) return 'microphone'
  if (t === BASS_DEVICE_TYPE_LINELEVEL) return 'linelevel'
  if (t === BASS_DEVICE_TYPE_DIGITAL) return 'digital'
  if (t === BASS_DEVICE_TYPE_NETWORK) return 'network'
  return isRecording ? 'microphone' : 'speaker'
}

function isVirtualInputByName(name: string): boolean {
  const n = name.toLowerCase()
  if (n.includes('cable input')) return true
  if (n.includes('voicemeeter')) return n.includes('input') || n.includes('virtual')
  if (n.includes('vb-audio')) return n.includes('input') && !n.includes('16ch')
  return false
}

function isVirtualOutputByName(name: string): boolean {
  const n = name.toLowerCase()
  if (n.includes('cable output')) return true
  if (n.includes('voicemeeter')) return n.includes('output') || n.includes('virtual')
  return false
}

function makeDevice(
  id: number,
  name: string,
  driver: string,
  flags: number,
  isRecording: boolean
): AudioDevice {
  return {
    id,
    name,
    driver,
    type: mapType(flags, isRecording),
    isEnabled: (flags & BASS_DEVICE_ENABLED) !== 0,
    isDefault: (flags & BASS_DEVICE_DEFAULT) !== 0,
    isInitialized: (flags & BASS_DEVICE_INIT) !== 0,
    isLoopback: (flags & BASS_DEVICE_LOOPBACK) !== 0,
    isVirtualInput: !isRecording && isVirtualInputByName(name),
    isVirtualOutput: isRecording && isVirtualOutputByName(name),
  }
}

/** Use PowerShell to enumerate Windows audio endpoint friendly names as a reliable primary source
 *  Simple script without slow Get-PnpDeviceProperty calls */
async function getPowershellDeviceNames(): Promise<{ playback: string[]; recording: string[] }> {
  try {
    // Simple enumeration - just get friendly names with direction hints via script
    const script = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      '$devices = Get-PnpDevice -Class AudioEndpoint -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq "OK" }',
      'foreach ($dev in $devices) {',
      '  $name = $dev.FriendlyName',
      '  $isCapture = $name -match "microphone|capture|输入|麦克风|cable output"',
      '  $isRender = $name -match "speaker|render|输出|扬声器|cable input"',
      '  # 16ch devices are multichannel, skip',
      '  if ($name -match "16ch") { continue }',
      '  $dir = if ($isCapture) { "Capture" } elseif ($isRender) { "Render" } else { "Unknown" }',
      '  Write-Output ("{0}|{1}" -f $name, $dir)',
      '}',
    ].join('; ')
    const out = await execFileP('powershell', ['-NoProfile', '-Command', script], {
      timeout: 8000, maxBuffer: 1024 * 512, windowsHide: true,
    })
    const lines = out.stdout.split(/\r?\n/).map(l => l.trim()).filter(l => l)
    const playback: string[] = []
    const recording: string[] = []
    for (const line of lines) {
      const [name, direction] = line.split('|').map(s => (s || '').trim())
      if (!name) continue
      const n = name.toLowerCase()
      if (n.includes('16ch')) continue
      if (direction === 'Capture') {
        recording.push(name)
      } else {
        playback.push(name)
      }
    }
    return { playback, recording }
  } catch {
    return { playback: [], recording: [] }
  }
}

/** Merge BASS-enumerated devices with PS names (PS is more reliable for names) */
function mergeWithPsNames(bassDevices: AudioDevice[], psNames: string[], isRecording: boolean): AudioDevice[] {
  if (bassDevices.length === 0) return bassDevices
  // If BASS names look valid (non-empty for most), keep them
  const validCount = bassDevices.filter(d => d.name && d.name.length >= 2).length
  if (validCount >= bassDevices.length / 2) return bassDevices

  // BASS names are mostly empty/invalid - replace with PS names
  return psNames.map((psName, i) => {
    const existing = bassDevices.find(d => d.name && (d.name.toLowerCase().includes(psName.slice(0, 6).toLowerCase()) || psName.toLowerCase().includes(d.name.slice(0, 6).toLowerCase())))
    if (existing) {
      return { ...existing, name: psName }
    }
    return makeDevice(i, psName, '', BASS_DEVICE_ENABLED, isRecording)
  })
}

export async function listPlaybackDevices(): Promise<AudioDevice[]> {
  // Primary: PowerShell enumeration (reliable names)
  const ps = await getPowershellDeviceNames()
  if (ps.playback.length > 0) {
    return ps.playback.map((name, i) => makeDevice(i, name, '', BASS_DEVICE_ENABLED, false))
  }

  // Fallback: BASS enumeration
  const useStubFallback = !nativeBassActive()
  if (useStubFallback && typeof BassLib._stubListDevices === 'function') {
    const stub = BassLib._stubListDevices()
    return stub.playback.map((d: any, i: number) =>
      makeDevice(i, d.name, d.driver, d.flags, false)
    )
  }
  const result: AudioDevice[] = []
  let gotAny = false
  try {
    for (let i = 0; i < 64; i++) {
      try {
        const info = BassLib.BASS_GetDeviceInfo(i)
        if (!info) break
        gotAny = true
        result.push(makeDevice(i, info.name || '', info.driver || '', info.flags || 0, false))
      } catch { break }
    }
  } catch {}

  // 如果 BASS 已加载但枚举失败，退回 stub
  if (!gotAny && typeof BassLib._stubListDevices === 'function') {
    const stub = BassLib._stubListDevices()
    return stub.playback.map((d: any, i: number) =>
      makeDevice(i, d.name, d.driver, d.flags, false)
    )
  }
  return result
}

export async function listRecordingDevices(): Promise<AudioDevice[]> {
  // Primary: PowerShell enumeration (reliable names)
  const ps = await getPowershellDeviceNames()
  if (ps.recording.length > 0) {
    return ps.recording.map((name, i) => makeDevice(i, name, '', BASS_DEVICE_ENABLED, true))
  }

  // Fallback: BASS enumeration
  const useStubFallback = !nativeBassActive()
  if (useStubFallback && typeof BassLib._stubListDevices === 'function') {
    const stub = BassLib._stubListDevices()
    return stub.recording.map((d: any, i: number) =>
      makeDevice(i, d.name, d.driver, d.flags, true)
    )
  }
  const result: AudioDevice[] = []
  let gotAny = false
  try {
    for (let i = 0; i < 64; i++) {
      try {
        const info = BassLib.BASS_RecordGetDeviceInfo(i)
        if (!info) break
        gotAny = true
        result.push(makeDevice(i, info.name || '', info.driver || '', info.flags || 0, true))
      } catch { break }
    }
  } catch {}
  if (!gotAny && typeof BassLib._stubListDevices === 'function') {
    const stub = BassLib._stubListDevices()
    return stub.recording.map((d: any, i: number) =>
      makeDevice(i, d.name, d.driver, d.flags, true)
    )
  }
  return result
}

export async function deviceSnapshot(): Promise<DeviceSnapshot> {
  const playback = await listPlaybackDevices()
  const recording = await listRecordingDevices()
  const virtualInputId = playback.find(d => d.isVirtualInput)?.id ?? -1
  const virtualOutputId = recording.find(d => d.isVirtualOutput)?.id ?? -1
  const micDefaultId = recording.find(d => d.isDefault)?.id ?? -1
  return { playback, recording, virtualInputId, virtualOutputId, micDefaultId }
}
