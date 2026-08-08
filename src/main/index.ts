import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { initDatabase } from './db'
import { registerLibraryIpc } from './ipc/library'
import { registerSettingsIpc } from './ipc/settings'
import { initSystem, registerSystemIpc } from './ipc/system'
import { AuroraAudioEngine } from './audio/engine'
import { registerAudioIpc } from './ipc/audio'

let mainWindow: BrowserWindow | null = null
const getWin = () => mainWindow

const audioEngine = new AuroraAudioEngine()

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hidden',
    vibrancy: 'under-window',
    backgroundMaterial: 'mica',
    title: 'Aurora Music',
    resizable: true,
    minimizable: true,
    maximizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  mainWindow.on('close', (e) => {
    if (!(app as any).isQuiting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(async () => {
  // 各模块独立容错：任何一处失败都不应阻止窗口出现
  try { initDatabase() } catch (e) { console.error('[main] initDatabase failed:', e) }
  try { registerLibraryIpc() } catch (e) { console.error('[main] registerLibraryIpc failed:', e) }
  try { registerSettingsIpc() } catch (e) { console.error('[main] registerSettingsIpc failed:', e) }
  // 音频引擎和 IPC 必须在 createWindow 之前就绪，否则 renderer 挂载时 checkInstall 会因 IPC 未注册而失败
  try { await Promise.resolve(audioEngine.start()) } catch (e) { console.error('[main] audioEngine.start failed:', e) }
  try { registerAudioIpc(() => audioEngine, getWin) } catch (e) { console.error('[main] registerAudioIpc failed:', e) }
  createWindow()
  try { initSystem(getWin) } catch (e) { console.error('[main] initSystem failed:', e) }
  try { registerSystemIpc(getWin) } catch (e) { console.error('[main] registerSystemIpc failed:', e) }
  audioEngine.emitter.on('state', (s) => {
    const w = getWin()
    if (w && !w.isDestroyed()) try { w.webContents.send('audio:state', s) } catch {}
  })
  audioEngine.emitter.on('levels', (l) => {
    const w = getWin()
    if (w && !w.isDestroyed()) try { w.webContents.send('audio:levels', l) } catch {}
  })
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { /* 由 close-to-tray 控制，此处不退出 */ })
app.on('before-quit', () => { (app as any).isQuiting = true })
