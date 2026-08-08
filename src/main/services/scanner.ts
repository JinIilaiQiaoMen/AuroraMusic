import { readdirSync, statSync, existsSync } from 'fs'
import { join, extname, parse } from 'path'
import type Database from 'better-sqlite3'
import { parseFile } from 'music-metadata'

const AUDIO_EXT = new Set(['.mp3','.flac','.wav','.ape','.m4a','.aac','.ogg','.wma','.aiff','.opus'])

export async function scanFolder(rootFolder: string, db: Database.Database): Promise<number> {
  let inserted = 0
  const ins = db.prepare(`
    INSERT OR IGNORE INTO songs (path,title,artist,album,duration,bitrate,format,cover_path,favorite,created_at,modified_at)
    VALUES (@path,@title,@artist,@album,@duration,@bitrate,@format,@cover_path,@favorite,@created_at,@modified_at)
  `)
  // 重扫时更新已有歌曲的时长和比特率（之前可能因 OneDrive 同步/文件锁导致解析失败）
  const upd = db.prepare(`
    UPDATE songs SET duration = @duration, bitrate = @bitrate, title = @title, artist = @artist, album = @album
    WHERE path = @path AND (duration = 0 OR duration IS NULL)
  `)
  const tx = db.transaction((rows: any[]) => {
    for (const r of rows) {
      const info = ins.run(r)
      if (info.changes) inserted++
      else {
        // 已存在但时长为0 → 更新
        if (!r.duration) continue
        try { upd.run(r) } catch {}
      }
    }
  })

  // 1) 先用同步 walk 收齐待处理文件（只做目录遍历，不做重 IO）
  const filesToProcess: string[] = []
  function walk(dir: string) {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.isFile() && AUDIO_EXT.has(extname(entry.name).toLowerCase())) {
        filesToProcess.push(p)
      }
    }
  }
  try { walk(rootFolder) } catch (e) { console.warn('[scanner] walk failed for', rootFolder, e) }

  // 2) 异步读 metadata，每 25 条让步一次事件循环 + 批量入库
  //    防止扫描大文件夹时阻塞 Electron IPC，导致 UI "卡死/跳动 loading 动画"
  const batch: any[] = []
  for (let i = 0; i < filesToProcess.length; i++) {
    const p = filesToProcess[i]
    try {
      batch.push(await toRow(p))
    } catch (e) {
      // metadata 解析失败：退回文件名回退行
      try { batch.push(await toRowFallback(p)) } catch {}
    }
    if (batch.length >= 25 || i === filesToProcess.length - 1) {
      if (batch.length) {
        try { tx(batch) } catch (e) { console.warn('[scanner] tx failed:', e) }
        batch.length = 0
      }
      // 给渲染进程和 IPC 让一次事件循环，避免 loading 图标卡住不动/进程看起来假死
      await new Promise(r => setTimeout(r, 0))
    }
  }
  return inserted
}

function toRowFallback(p: string) {
  const ext = extname(p).toLowerCase().slice(1)
  const parsed = parse(p)
  let title = parsed.name
  let artist = ''
  const sep = parsed.name.indexOf(' - ')
  if (sep > 0) { artist = parsed.name.slice(0, sep).trim(); title = parsed.name.slice(sep + 3).trim() }
  const stat = statSync(p)
  return {
    path: p, title, artist,
    album: '',
    duration: 0,
    bitrate: 0,
    format: ext,
    cover_path: null,
    favorite: 0,
    created_at: Math.floor(Date.now() / 1000),
    modified_at: Math.floor(stat.mtimeMs / 1000)
  }
}

async function toRow(p: string) {
  const ext = extname(p).toLowerCase().slice(1)
  const parsed = parse(p)
  let title = parsed.name
  let artist = ''
  const sep = parsed.name.indexOf(' - ')
  if (sep > 0) { artist = parsed.name.slice(0, sep).trim(); title = parsed.name.slice(sep + 3).trim() }
  const stat = statSync(p)

  // 用 music-metadata 解析 ID3/vorbis tag — duration 必须拿到（否则进度条 NaN 乱跳）
  let duration = 0
  let bitrate = 0
  let album = ''
  try {
    const meta = await parseFile(p, { duration: true, skipCovers: true })
    if (typeof meta.format?.duration === 'number' && isFinite(meta.format.duration) && meta.format.duration > 0) {
      duration = Math.round(meta.format.duration * 10) / 10 // 保留 1 位小数
    }
    if (typeof meta.format?.bitrate === 'number' && meta.format.bitrate > 0) {
      bitrate = Math.round(meta.format.bitrate / 1000) // kbps
    }
    if (meta.common?.title) title = meta.common.title
    if (meta.common?.artist) artist = meta.common.artist
    if (meta.common?.album) album = meta.common.album
  } catch {
    // metadata 读不出就算了，至少保证文件条目能进库
  }

  return {
    path: p, title, artist, album,
    duration: isFinite(duration) ? duration : 0,
    bitrate: isFinite(bitrate) ? bitrate : 0,
    format: ext,
    cover_path: null,
    favorite: 0,
    created_at: Math.floor(Date.now() / 1000),
    modified_at: Math.floor(stat.mtimeMs / 1000)
  }
}
