import { contextBridge, ipcRenderer } from 'electron'

const api = {
  library: {
    scanFolders: (paths: string[]) => ipcRenderer.invoke('library:scanFolders', paths),
    getSongs: () => ipcRenderer.invoke('library:getSongs'),
    getPlaylists: () => ipcRenderer.invoke('library:getPlaylists'),
    resolvePath: (p: string) => ipcRenderer.invoke('library:resolvePath', p),
    createPlaylist: (name: string, desc?: string) => ipcRenderer.invoke('library:createPlaylist', name, desc),
    updatePlaylist: (id: number, patch: {name?: string; description?: string}) => ipcRenderer.invoke('library:updatePlaylist', id, patch),
    deletePlaylist: (id: number) => ipcRenderer.invoke('library:deletePlaylist', id),
    addSongsToPlaylist: (playlistId: number, songIds: number[]) => ipcRenderer.invoke('library:addSongsToPlaylist', playlistId, songIds),
    removeSongsFromPlaylist: (playlistId: number, songIds: number[]) => ipcRenderer.invoke('library:removeSongsFromPlaylist', playlistId, songIds),
    reorderPlaylist: (playlistId: number, order: number[]) => ipcRenderer.invoke('library:reorderPlaylist', playlistId, order),
    toggleFavorite: (songId: number) => ipcRenderer.invoke('library:toggleFavorite', songId),
    removeSongsFromLibrary: (songIds: number[]) => ipcRenderer.invoke('library:removeSongsFromLibrary', songIds),
    getFavorites: () => ipcRenderer.invoke('library:getFavorites'),
    search: (kw: string, limit?: number) => ipcRenderer.invoke('library:search', kw, limit),
    addPlayHistory: (songId: number, durationSec: number) => ipcRenderer.invoke('library:addPlayHistory', songId, durationSec),
    getLyrics: (songId: number) => ipcRenderer.invoke('library:getLyrics', songId)
  },
  settings: {
    get: <T = unknown>(k: string, def?: T) => ipcRenderer.invoke('settings:get', k, def),
    set: (k: string, v: unknown) => ipcRenderer.invoke('settings:set', k, v)
  },
  system: {
    getHotkeys: () => ipcRenderer.invoke('system:getHotkeys'),
    setHotkey: (action: string, acc: string | null) => ipcRenderer.invoke('system:setHotkey', action, acc),
    pickLibraryFolders: () => ipcRenderer.invoke('system:pickLibraryFolders'),
    refreshTrayAndHotkeys: () => ipcRenderer.invoke('system:refreshTrayAndHotkeys'),
    show: () => ipcRenderer.invoke('system:showMainWindow'),
    hide: () => ipcRenderer.invoke('system:hideMainWindow'),
    minimize: () => ipcRenderer.invoke('system:minimizeWindow'),
    toggleMaximize: () => ipcRenderer.invoke('system:toggleMaximize'),
    isMaximized: () => ipcRenderer.invoke('system:isMaximized'),
    onHotkey: (cb: (a: string) => void) => {
      const handler = (_e: any, a: any) => cb(a)
      ipcRenderer.on('hotkey', handler); return () => ipcRenderer.off('hotkey', handler)
    },
    onMenuAction: (cb: (a: string) => void) => {
      const h = (_e: any, a: any) => cb(a)
      ipcRenderer.on('menu:action', h); return () => ipcRenderer.off('menu:action', h)
    },
    onMenuPreset: (cb: (p: string) => void) => {
      const h = (_e: any, p: any) => cb(p)
      ipcRenderer.on('menu:preset', h); return () => ipcRenderer.off('menu:preset', h)
    }
  },
  audio: {
    listDevices:  () => ipcRenderer.invoke('audio:listDevices'),
    checkInstall: () => ipcRenderer.invoke('audio:checkInstall'),
    openInstaller: (which: 'web'|'local', arg?: any) => ipcRenderer.invoke('audio:openInstaller', which, arg),
    autoInstallVBCable: () => ipcRenderer.invoke('audio:autoInstallVBCable'),
    autoInstallNativeDlls: (opts?: { onlyMissing?: boolean }) => ipcRenderer.invoke('audio:autoInstallNativeDlls', opts),
    getInstallLogPath:      (scope: 'latest'|'all' = 'latest') => ipcRenderer.invoke('audio:getInstallLogPath', scope),
    openInstallLogFolder:   (logFile?: string) => ipcRenderer.invoke('audio:openInstallLogFolder', logFile),
    openInstallLogFile:     (logFile?: string) => ipcRenderer.invoke('audio:openInstallLogFile', logFile),
    engine: {
      load:     (p: string) => ipcRenderer.invoke('audio:engine:load', p),
      play:     () => ipcRenderer.invoke('audio:engine:play'),
      pause:    () => ipcRenderer.invoke('audio:engine:pause'),
      position: () => ipcRenderer.invoke('audio:engine:position'),
      duration: () => ipcRenderer.invoke('audio:engine:duration'),
      seek:     (s:number) => ipcRenderer.invoke('audio:engine:seek', s),
      volume:   (v:number) => ipcRenderer.invoke('audio:engine:volume', v),
      rate:     (r:number) => ipcRenderer.invoke('audio:engine:rate', r),
    },
    mixer: {
      getState: () => ipcRenderer.invoke('audio:mixer:getState'),
      apply:    (p: any) => ipcRenderer.invoke('audio:mixer:apply', p),
      preset:   (id: string) => ipcRenderer.invoke('audio:mixer:applyPreset', id),
      levels:   () => ipcRenderer.invoke('audio:mixer:levels'),
      emergencyStop: () => ipcRenderer.invoke('audio:mixer:emergencyStop'),
      onLevels: (cb: (l: any) => void) => { const h = (_:any, v:any)=>cb(v); ipcRenderer.on('audio:levels', h); return ()=>ipcRenderer.off('audio:levels', h) },
      onState:  (cb: (s: any) => void) => { const h = (_:any, v:any)=>cb(v); ipcRenderer.on('audio:state', h); return ()=>ipcRenderer.off('audio:state', h) },
      onAutoInstallProgress: (cb: (p: any) => void) => { const h = (_:any, v:any)=>cb(v); ipcRenderer.on('audio:autoInstallProgress', h); return ()=>ipcRenderer.off('audio:autoInstallProgress', h) }
    }
  }
} as const

contextBridge.exposeInMainWorld('api', api)

export type ApiShape = typeof api
