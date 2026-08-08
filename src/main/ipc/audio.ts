import { ipcMain, type BrowserWindow, shell } from 'electron'
import type { AuroraAudioEngine } from '../audio/engine'
import { deviceSnapshot } from '../audio/devices'
import { detectInstall, openInstaller, autoInstallVBCable, autoInstallNativeDlls, getLatestInstallLogPath, logsDir } from '../audio/installer'
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { nativeBassActive } from '../../../native/bass'

export function bindAudioEngine(
  engine: AuroraAudioEngine,
  getWin: () => BrowserWindow | null
): () => void {
  const offState = () => {
    const w = getWin()
    if (w && !w.isDestroyed()) w.webContents.send('audio:state', engine.getState())
  }
  const offLevels = (l: any) => {
    const w = getWin()
    if (w && !w.isDestroyed()) w.webContents.send('audio:levels', l)
  }
  engine.emitter.on('state', offState)
  engine.emitter.on('levels', offLevels)
  return () => {
    engine.emitter.off('state', offState)
    engine.emitter.off('levels', offLevels)
  }
}

export function registerAudioIpc(
  getEngine: () => AuroraAudioEngine,
  getWin: () => BrowserWindow | null
) {
  ipcMain.handle('audio:listDevices', async () => await deviceSnapshot())

  ipcMain.handle('audio:checkInstall', async () => await detectInstall())

  ipcMain.handle('audio:autoInstallVBCable', async (e) => {
    const win = getWin()
    return await autoInstallVBCable((p) => {
      try { e.sender.send('audio:autoInstallProgress', p) } catch {}
      try { if (win && !win.isDestroyed()) win.webContents.send('audio:autoInstallProgress', p) } catch {}
    })
  })

  ipcMain.handle('audio:autoInstallNativeDlls', async (e, opts?: { onlyMissing?: boolean }) => {
    const win = getWin()
    return await autoInstallNativeDlls(opts ?? {}, (p) => {
      try { e.sender.send('audio:autoInstallProgress', p) } catch {}
      try { if (win && !win.isDestroyed()) win.webContents.send('audio:autoInstallProgress', p) } catch {}
    })
  })

  ipcMain.handle('audio:openInstaller', async (_e, which: 'web' | 'local', arg?: any) =>
    await openInstaller(which, arg)
  )

  // ---------- 安装日志：查询 / 打开 ----------
  ipcMain.handle('audio:getInstallLogPath', async (_e, scope: 'latest' | 'all' = 'latest') => {
    try {
      const dir = logsDir()
      if (!existsSync(dir)) return scope === 'latest' ? null : { dir, files: [] }
      const files = readdirSync(dir)
        .filter(f => f.startsWith('install-') && f.endsWith('.log'))
        .map(name => {
          const p = join(dir, name)
          let mtime = 0
          try { mtime = statSync(p).mtimeMs } catch {}
          return { name, path: p, mtime }
        })
        .sort((a, b) => b.mtime - a.mtime)
      if (scope === 'all') return { dir, files }
      if (files[0]) return files[0].path
      return await getLatestInstallLogPath()
    } catch {
      return scope === 'latest' ? null : { dir: '', files: [] }
    }
  })

  ipcMain.handle('audio:openInstallLogFolder', async (_e, logFile?: string) => {
    try {
      if (logFile && existsSync(logFile)) {
        // 打开该文件所在文件夹并高亮（Windows 支持 select-file-in-folder）
        const r = await shell.showItemInFolder(logFile)
        if (r) return { ok: true, method: 'showItemInFolder' }
        // 兜底直接打开文件
        const err = await shell.openPath(logFile)
        if (err) return { ok: false, message: err }
        return { ok: true, method: 'openPath' }
      }
      const dir = logsDir()
      if (!existsSync(dir)) return { ok: false, message: 'logsDir not found: ' + dir }
      const err = await shell.openPath(dir)
      if (err) return { ok: false, message: err }
      return { ok: true, method: 'openPath', dir }
    } catch (e: any) {
      return { ok: false, message: String(e?.message ?? e) }
    }
  })

  ipcMain.handle('audio:openInstallLogFile', async (_e, logFile?: string) => {
    try {
      let target: string | null = (logFile && existsSync(logFile)) ? logFile : null
      if (!target) target = await getLatestInstallLogPath()
      if (!target || !existsSync(target)) return { ok: false, message: 'log not found' }
      const err = await shell.openPath(target)
      if (err) return { ok: false, message: err }
      return { ok: true, path: target }
    } catch (e: any) {
      return { ok: false, message: String(e?.message ?? e) }
    }
  })

  ipcMain.handle('audio:engine:load', async (_e, path: string) => {
    const engine = getEngine()
    const ok = await engine.loadMusicFile(path)
    return { ok, native: engine.nativeOk && nativeBassActive() }
  })

  ipcMain.handle('audio:engine:play', () => {
    const engine = getEngine()
    return engine.play()
  })

  ipcMain.handle('audio:engine:pause', () => {
    const engine = getEngine()
    return engine.pause()
  })

  ipcMain.handle('audio:engine:position', () => {
    const engine = getEngine()
    return engine.positionSec()
  })

  ipcMain.handle('audio:engine:duration', () => {
    const engine = getEngine()
    return engine.durationSec()
  })

  ipcMain.handle('audio:engine:seek', (_e, s: number) => {
    const engine = getEngine()
    return engine.seek(s)
  })

  ipcMain.handle('audio:engine:volume', (_e, v: number) => {
    const engine = getEngine()
    return engine.setMusicVolume(v)
  })

  ipcMain.handle('audio:engine:rate', (_e, r: number) => {
    const engine = getEngine()
    return {
      ok: engine.setPlaybackRate(r),
      rate: engine.getPlaybackRate()
    }
  })

  ipcMain.handle('audio:mixer:getState', () => {
    const engine = getEngine()
    return engine.getState()
  })

  ipcMain.handle('audio:mixer:apply', (_e, patch: any) => {
    const engine = getEngine()
    engine.applyState(patch)
    return engine.getState()
  })

  ipcMain.handle('audio:mixer:applyPreset', (_e, id: any) => {
    const engine = getEngine()
    engine.applyPreset(id)
    return engine.getState()
  })

  ipcMain.handle('audio:mixer:levels', () => {
    const engine = getEngine()
    return engine.pollLevels()
  })

  ipcMain.handle('audio:mixer:emergencyStop', () => {
    const engine = getEngine()
    return engine.stopAll()
  })

  const pushTimer = setInterval(() => {
    const w = getWin()
    if (!w || w.isDestroyed()) return
    const engine = getEngine()
    try { w.webContents.send('audio:state', engine.getState()) } catch {}
    try { w.webContents.send('audio:levels', engine.pollLevels()) } catch {}
  }, 500)

  const cleanup = bindAudioEngine(getEngine(), getWin)
  return () => {
    clearInterval(pushTimer)
    cleanup()
  }
}
