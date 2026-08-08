import { ipcMain } from 'electron'
import { readConfig, writeConfig } from '../services/storage'

export function registerSettingsIpc() {
  ipcMain.handle('settings:get', async (_e, k: string, def?: unknown) => {
    const cfg = readConfig() as any
    return k in cfg ? cfg[k] : (def ?? null)
  })
  ipcMain.handle('settings:set', async (_e, k: string, v: unknown) => {
    const cfg = readConfig() as any
    cfg[k] = v
    writeConfig(cfg)
    return true
  })
}
