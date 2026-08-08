import { app, globalShortcut, BrowserWindow } from 'electron'
import { readConfig, writeConfig } from './storage'

export type HotkeyAction =
  | 'playPause' | 'prev' | 'next' | 'volUp' | 'volDown'
  | 'toggleMix' | 'presetGaming' | 'presetListening' | 'presetStreamer' | 'presetWatching' | 'presetMeeting'
  | 'toggleFav' | 'toggleWindow' | 'emergencyStop'

export const DEFAULT_HOTKEYS: Record<HotkeyAction, string> = {
  playPause: 'Ctrl+Alt+P',
  prev: 'Ctrl+Alt+Left',
  next: 'Ctrl+Alt+Right',
  volUp: 'Ctrl+Alt+Up',
  volDown: 'Ctrl+Alt+Down',
  toggleMix: 'Ctrl+Alt+M',
  presetGaming: 'Ctrl+Alt+1',
  presetListening: 'Ctrl+Alt+2',
  presetStreamer: 'Ctrl+Alt+3',
  presetWatching: 'Ctrl+Alt+4',
  presetMeeting: 'Ctrl+Alt+5',
  toggleFav: 'Ctrl+Alt+F',
  toggleWindow: 'Ctrl+Alt+H',
  emergencyStop: 'Ctrl+Alt+Shift+S'
}

export function getHotkeys(): Record<HotkeyAction, string> {
  const cfg = readConfig()
  return { ...DEFAULT_HOTKEYS, ...(cfg.hotkeys ?? {}) } as Record<HotkeyAction, string>
}
export function setHotkey(action: HotkeyAction, accelerator: string | null) {
  const cfg = readConfig()
  const hotkeys = { ...(cfg.hotkeys ?? {}) }
  if (accelerator) hotkeys[action] = accelerator; else delete hotkeys[action]
  cfg.hotkeys = hotkeys as any
  writeConfig(cfg)
}

type ActionHandler = (a: HotkeyAction) => void
let installed = new Map<HotkeyAction, string>()

export function registerAllHotkeys(handler: ActionHandler) {
  unregisterAllHotkeys()
  const map = getHotkeys()
  for (const action of Object.keys(map) as HotkeyAction[]) {
    const acc = map[action]
    if (!acc) continue
    try {
      const ok = globalShortcut.register(acc, () => handler(action))
      if (ok) installed.set(action, acc)
    } catch {}
  }
}
export function unregisterAllHotkeys() {
  try { globalShortcut.unregisterAll() } catch {}
  installed.clear()
}
export function installedHotkeys() { return new Map(installed) }

export function sendHotkeyToRenderer(w: BrowserWindow | null, a: HotkeyAction) {
  if (w && !w.isDestroyed()) w.webContents.send('hotkey', a)
}
