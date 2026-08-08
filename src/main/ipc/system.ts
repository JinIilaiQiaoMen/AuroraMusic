import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog } from 'electron'
import { registerAllHotkeys, unregisterAllHotkeys, sendHotkeyToRenderer, setHotkey as writeHotkey, type HotkeyAction } from '../services/shortcuts'

let tray: Tray | null = null
export function ensureTray(mainWindow: () => BrowserWindow | null) {
  if (tray) return tray
  const empty = nativeImage.createEmpty()
  try { tray = new Tray(empty) } catch { return null }
  if (!tray) return null
  rebuildTrayMenu(mainWindow)
  tray.setToolTip('Aurora Music')
  tray.on('click', () => toggleWindow(mainWindow()))
  return tray
}
export function rebuildTrayMenu(mainWindow: () => BrowserWindow | null) {
  if (!tray) return
  const show = () => { const w = mainWindow(); if (w) { w.show(); w.focus() } }
  const send = (channel: string, arg?: any) => {
    const w = mainWindow(); if (w && !w.isDestroyed()) w.webContents.send(channel, arg)
  }
  const menu = Menu.buildFromTemplate([
    { label: '显示 Aurora Music', click: show },
    { type: 'separator' },
    { label: '⏯ 播放 / 暂停', click: () => send('menu:action', 'playPause') },
    { label: '⏮ 上一首',     click: () => send('menu:action', 'prev') },
    { label: '⏭ 下一首',     click: () => send('menu:action', 'next') },
    { type: 'separator' },
    { label: '🎮 切到 开黑模式',   click: () => send('menu:preset', 'gaming') },
    { label: '🎧 切到 听歌模式',   click: () => send('menu:preset', 'listening') },
    { label: '🎤 切到 主播模式',   click: () => send('menu:preset', 'streamer') },
    { label: '📺 切到 观影模式',   click: () => send('menu:preset', 'watching') },
    { label: '🎙️ 切到 会议模式',   click: () => send('menu:preset', 'meeting') },
    { type: 'separator' },
    { label: '🎚️ 混音开关',        click: () => send('menu:action', 'toggleMix') },
    { label: '🛑 紧急停止混音',    click: () => send('menu:action', 'emergencyStop') },
    { type: 'separator' },
    { label: '退出', click: () => { (app as any).isQuiting = true; app.quit() } }
  ])
  tray.setContextMenu(menu)
}
function toggleWindow(w: BrowserWindow | null) {
  if (!w) return
  if (w.isVisible() && w.isFocused()) w.hide(); else { w.show(); w.focus() }
}

export function initSystem(mainWindow: () => BrowserWindow | null) {
  ensureTray(mainWindow)
  registerAllHotkeys(a => sendHotkeyToRenderer(mainWindow(), a))
  app.on('will-quit', () => unregisterAllHotkeys())
}

export function registerSystemIpc(mainWindow: () => BrowserWindow | null) {
  ipcMain.handle('system:getHotkeys', () => require('../services/shortcuts').getHotkeys())
  ipcMain.handle('system:setHotkey', (_e, action: HotkeyAction, accelerator: string | null) => {
    writeHotkey(action, accelerator)
    ensureTray(mainWindow)
    rebuildTrayMenu(mainWindow)
    registerAllHotkeys(a => sendHotkeyToRenderer(mainWindow(), a))
    return true
  })
  ipcMain.handle('system:pickLibraryFolders', async () => {
    const w = mainWindow()
    const r = await dialog.showOpenDialog(w ?? undefined as any, {
      title: '选择音乐库文件夹',
      properties: ['openDirectory', 'multiSelections']
    })
    if (r.canceled) return [] as string[]
    return r.filePaths
  })
  ipcMain.handle('system:refreshTrayAndHotkeys', () => {
    ensureTray(mainWindow)
    rebuildTrayMenu(mainWindow)
    registerAllHotkeys(a => sendHotkeyToRenderer(mainWindow(), a))
    return true
  })
  ipcMain.handle('system:showMainWindow', () => { const w = mainWindow(); w?.show(); w?.focus(); return true })
  ipcMain.handle('system:hideMainWindow', () => { mainWindow()?.hide(); return true })
  ipcMain.handle('system:minimizeWindow', () => { mainWindow()?.minimize(); return true })
  ipcMain.handle('system:toggleMaximize', () => {
    const w = mainWindow(); if (!w) return { maximized: false }
    if (w.isMaximized()) { w.unmaximize(); return { maximized: false } }
    w.maximize(); return { maximized: true }
  })
  ipcMain.handle('system:isMaximized', () => { return mainWindow()?.isMaximized() ?? false })
}

declare module 'electron' {
  interface App { isQuiting?: boolean }
}
