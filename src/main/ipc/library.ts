import { ipcMain } from 'electron'
import { scanFolder } from '../services/scanner'
import { getDB } from '../db'

export function registerLibraryIpc() {
  ipcMain.handle('library:scanFolders', async (_e, paths: string[]) => {
    const db = getDB()
    let n = 0
    for (const p of paths) n += await scanFolder(p, db)
    const songs = db.prepare(`
      SELECT id,path,title,artist,album,duration,format,codec,favorite FROM songs ORDER BY artist,title LIMIT 2000
    `).all()
    return { inserted: n, songs }
  })
  ipcMain.handle('library:getSongs', async () => {
    return getDB().prepare(`SELECT id,path,title,artist,album,duration,format,codec,favorite FROM songs ORDER BY artist,title LIMIT 2000`).all()
  })
  ipcMain.handle('library:getPlaylists', async () => {
    const db = getDB()
    const playlists = db.prepare('SELECT * FROM playlists ORDER BY id').all()
    const playlistWithSongs = (playlists as any[]).map((pl: any) => ({
      ...pl,
      songs: db.prepare(`
        SELECT s.* FROM playlist_songs ps JOIN songs s ON s.id = ps.song_id
        WHERE ps.playlist_id = ? ORDER BY ps.order_index, s.id LIMIT 500
      `).all(pl.id)
    }))
    return playlistWithSongs
  })
  ipcMain.handle('library:resolvePath', async (_e, p: string) => {
    try { return 'file:///' + p.replace(/\\/g, '/') } catch { return '' }
  })

  ipcMain.handle('library:createPlaylist', async (_e, name: string, description?: string) => {
    const db = getDB()
    const now = Date.now()
    const r = db.prepare('INSERT INTO playlists (name,description,created_at,updated_at) VALUES (?,?,?,?)').run(name, description ?? '', now, now)
    return { id: Number(r.lastInsertRowid), name, description }
  })
  ipcMain.handle('library:updatePlaylist', async (_e, id: number, patch: {name?: string; description?: string}) => {
    const db = getDB()
    const fields = Object.keys(patch) as (keyof typeof patch)[]
    if (!fields.length) return false
    const sets = fields.map(f => `${f}=?`).join(',')
    const stmt = db.prepare(`UPDATE playlists SET ${sets}, updated_at=? WHERE id=?`)
    const params: any[] = fields.map(f => patch[f]).concat([Date.now(), id])
    stmt.run(...params)
    return true
  })
  ipcMain.handle('library:deletePlaylist', async (_e, id: number) => {
    const db = getDB()
    db.prepare('DELETE FROM playlists WHERE id=?').run(id)
    return true
  })
  ipcMain.handle('library:addSongsToPlaylist', async (_e, playlistId: number, songIds: number[]) => {
    const db = getDB()
    const maxIdx = (db.prepare('SELECT COALESCE(MAX(order_index),0) n FROM playlist_songs WHERE playlist_id=?').get(playlistId) as any).n
    const ins = db.prepare('INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id, order_index) VALUES (?,?,?)')
    const tx = db.transaction((ids: number[]) => ids.forEach((sid, i) => ins.run(playlistId, sid, maxIdx + i + 1)))
    tx(songIds)
    return true
  })
  ipcMain.handle('library:removeSongsFromPlaylist', async (_e, playlistId: number, songIds: number[]) => {
    const db = getDB()
    const stmt = db.prepare('DELETE FROM playlist_songs WHERE playlist_id=? AND song_id=?')
    const tx = db.transaction((ids: number[]) => ids.forEach(sid => stmt.run(playlistId, sid)))
    tx(songIds)
    return true
  })
  ipcMain.handle('library:reorderPlaylist', async (_e, playlistId: number, order: number[]) => {
    const db = getDB()
    const upd = db.prepare('UPDATE playlist_songs SET order_index=? WHERE playlist_id=? AND song_id=?')
    const tx = db.transaction((ids: number[]) => ids.forEach((sid, i) => upd.run(i + 1, playlistId, sid)))
    tx(order)
    return true
  })

  ipcMain.handle('library:toggleFavorite', async (_e, songId: number) => {
    const db = getDB()
    const cur = db.prepare('SELECT favorite FROM songs WHERE id=?').pluck().get(songId) as number
    const next = cur ? 0 : 1
    db.prepare('UPDATE songs SET favorite=? WHERE id=?').run(next, songId)
    return next === 1
  })
  ipcMain.handle('library:removeSongsFromLibrary', async (_e, songIds: number[]) => {
    const db = getDB()
    const ids = Array.isArray(songIds) ? songIds.filter((n: any) => Number.isFinite(n) && n > 0) : []
    if (!ids.length) return 0
    const delPl = db.prepare('DELETE FROM playlist_songs WHERE song_id=?')
    const delHist = db.prepare('DELETE FROM play_history WHERE song_id=?')
    const delSong = db.prepare('DELETE FROM songs WHERE id=?')
    const tx = db.transaction((list: number[]) => {
      let n = 0
      for (const id of list) {
        delPl.run(id); delHist.run(id)
        const info = delSong.run(id)
        if (info && typeof (info as any).changes === 'number') n += (info as any).changes
      }
      return n
    })
    return tx(ids)
  })
  ipcMain.handle('library:getFavorites', async () => {
    return getDB().prepare('SELECT * FROM songs WHERE favorite=1 ORDER BY id DESC').all()
  })

  ipcMain.handle('library:search', async (_e, keyword: string, limit = 200) => {
    const k = `%${keyword.trim()}%`
    return getDB().prepare(`
      SELECT * FROM songs
      WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? OR path LIKE ?
      ORDER BY CASE WHEN title LIKE ? THEN 0 ELSE 1 END, artist, title LIMIT ?
    `).all(k, k, k, k, k, limit)
  })

  ipcMain.handle('library:addPlayHistory', async (_e, songId: number, durationSec: number) => {
    getDB().prepare('INSERT INTO play_history (song_id,played_at,duration_sec) VALUES (?,?,?)').run(songId, Date.now(), durationSec)
    return true
  })

  // 获取歌曲关联的歌词
  ipcMain.handle('library:getLyrics', async (_e, songId: number) => {
    const row = getDB().prepare('SELECT * FROM lyrics WHERE song_id = ?').get(songId) as any
    if (!row) return null
    return {
      lrcPath: row.lrc_path,
      lines: JSON.parse(row.lines_json || '[]'),
      title: row.title,
      artist: row.artist,
    }
  })
}
