import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const APP_DIR = 'AuroraMusic'

export function appDataDir(): string {
  const dir = join(app.getPath('appData'), APP_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
export function coversDir(): string {
  const dir = join(appDataDir(), 'covers')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
export function dbPath(): string { return join(appDataDir(), 'database.sqlite') }
export function configPath(): string { return join(appDataDir(), 'config.json') }

export interface Config {
  theme: string
  accentGradient: [string, string]
  libraryFolders: string[]
  virtualMicDevice: string
  sampleRate: number
  hotkeys: Record<string, string>
  defaultPreset: string
  lastPlaylistId: number | null
  lastSongId: number | null
  lastPosition: number
}
const DEF_CONFIG: Config = {
  theme: 'warm-orange',
  accentGradient: ['#ff7e5f', '#feb47b'],
  libraryFolders: [],
  virtualMicDevice: 'Aurora Virtual Mic',
  sampleRate: 44100,
  hotkeys: { playPause: 'Ctrl+Alt+P', toggleMix: 'Ctrl+Alt+M' },
  defaultPreset: 'gaming',
  lastPlaylistId: null,
  lastSongId: null,
  lastPosition: 0
}
export function readConfig(): Config {
  try {
    if (existsSync(configPath())) {
      const raw = JSON.parse(readFileSync(configPath(), 'utf-8'))
      return { ...DEF_CONFIG, ...raw }
    }
  } catch {}
  writeConfig(DEF_CONFIG)
  return DEF_CONFIG
}
export function writeConfig(cfg: Config) { writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf-8') }
