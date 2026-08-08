import { readdirSync, statSync, existsSync, readFileSync } from 'fs'
import { join, extname, parse, dirname, basename } from 'path'
import type Database from 'better-sqlite3'
import { parseFile } from 'music-metadata'

/**
 * 音频格式支持清单（按优先级分层）
 *
 * 1️⃣ 必实现（强制兼容）
 *    .mp3  MPEG-1/2 Layer-3  有损  行业通用，必须完整支持VBR/CBR
 *    .wav  PCM              无损  支持8-48kHz，多比特深度
 *    .m4a  AAC-LC           有损  主流手机音频，注意区分封装（ALAC/AAC）
 *
 * 2️⃣ 推荐实现（主流无损，升级重点）
 *    .flac FLAC             无损  互联网无损资源最主流
 *    .ogg  Vorbis           有损  开源
 *
 * 3️⃣ 可选扩展（HiFi / 小众资源）
 *    .ape  Monkey's Audio   无损  解码开销大，容错差
 *    .wv   WavPack          无损  小众无损
 *    .dsf  DSD              HiFi  SACD音频，需软解码转PCM
 *    .dff  DSD              HiFi  SACD音频，需软解码转PCM
 *    .opus Opus             有损  网络流媒体
 *    .aac  AAC              有损  纯AAC裸流
 *    .aiff AIFF             无损  Apple格式
 *
 * 4️⃣ 不建议接入（已移除）
 *    .wma  WMA              —   微软旧格式，授权复杂
 *    .ra/.rm RealAudio      —   几乎无现实资源
 */
const AUDIO_EXT = new Set([
  // 1️⃣ 必实现
  '.mp3', '.wav', '.m4a',
  // 2️⃣ 推荐
  '.flac', '.ogg',
  // 3️⃣ 可选
  '.ape', '.wv', '.dsf', '.dff', '.opus', '.aac', '.aiff',
])

/** 辅助文件后缀（不作为独立歌曲入库，但需关联处理） */
const CUE_EXT = '.cue'
const LRC_EXT = '.lrc'

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
  const cueFiles: string[] = []
  const lrcFiles: string[] = []
  function walk(dir: string) {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase()
        if (AUDIO_EXT.has(ext)) {
          filesToProcess.push(p)
        } else if (ext === CUE_EXT) {
          cueFiles.push(p)
        } else if (ext === LRC_EXT) {
          lrcFiles.push(p)
        }
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

  // 3) 处理 CUE Sheet：整轨音频分轨入库
  if (cueFiles.length) {
    try {
      const cueRows = processCueSheets(cueFiles, db)
      if (cueRows.length) {
        const cueTx = db.transaction((rows: any[]) => {
          for (const r of rows) {
            const info = ins.run(r)
            if (info.changes) inserted++
          }
        })
        try { cueTx(cueRows) } catch (e) { console.warn('[scanner] cue tx failed:', e) }
      }
    } catch (e) { console.warn('[scanner] cue processing failed:', e) }
  }

  // 4) 处理 LRC 歌词：关联到已有歌曲
  if (lrcFiles.length) {
    try {
      const lrcCount = processLrcFiles(lrcFiles, db)
      console.log(`[scanner] associated ${lrcCount} lrc files with songs`)
    } catch (e) { console.warn('[scanner] lrc processing failed:', e) }
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
    codec: ext,
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
  let codec = ''  // 实际编码（如 AAC/ALAC/FLAC/MP3/PCM/Vorbis/Opus/Monkey's Audio/WavPack/DSD）
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
    // 解析实际编码：m4a 容器可能包含 AAC 或 ALAC，不能只看后缀
    codec = detectCodec(ext, meta)
  } catch {
    // metadata 读不出就算了，至少保证文件条目能进库
  }

  return {
    path: p, title, artist, album,
    duration: isFinite(duration) ? duration : 0,
    bitrate: isFinite(bitrate) ? bitrate : 0,
    format: ext,
    codec: codec || ext,  // 优先存实际编码，fallback 存后缀
    cover_path: null,
    favorite: 0,
    created_at: Math.floor(Date.now() / 1000),
    modified_at: Math.floor(stat.mtimeMs / 1000)
  }
}

/**
 * 从 music-metadata 解析结果中提取实际编码名称
 * 关键：m4a 容器同时包含 AAC（有损）和 ALAC（无损），不能只看后缀
 */
function detectCodec(ext: string, meta: any): string {
  const fmt = meta?.format
  if (!fmt) return ext
  // codec 字段优先（music-metadata 提供的标准编码名）
  const codecStr = fmt.codec
  const container = fmt.container?.toLowerCase() || ''

  // m4a 容器：区分 AAC vs ALAC
  if (ext === 'm4a' || ext === 'mp4' || container.includes('mp4') || container.includes('isom')) {
    if (codecStr?.toLowerCase().includes('alac')) return 'ALAC'
    if (codecStr?.toLowerCase().includes('aac')) return 'AAC'
    // 通过 lossless 标志判断
    if (fmt.lossless === true) return 'ALAC'
    return 'AAC'
  }

  // 其他格式直接用 codec 字段
  if (codecStr) {
    const c = codecStr.toLowerCase()
    if (c.includes('flac')) return 'FLAC'
    if (c.includes('mpeg') && c.includes('layer3')) return 'MP3'
    if (c.includes('mpeg')) return 'MP3'
    if (c.includes('pcm') || c.includes('pcm_int')) return 'PCM'
    if (c.includes('vorbis')) return 'Vorbis'
    if (c.includes('opus')) return 'Opus'
    if (c.includes('monkey')) return "Monkey's Audio"
    if (c.includes('wavpack')) return 'WavPack'
    if (c.includes('dsd')) return 'DSD'
    if (c.includes('aiff')) return 'PCM'
    return codecStr
  }

  // fallback：通过 lossless + container 推断
  if (fmt.lossless === true) {
    if (ext === 'flac') return 'FLAC'
    if (ext === 'wav') return 'PCM'
    if (ext === 'ape') return "Monkey's Audio"
    if (ext === 'wv') return 'WavPack'
    if (ext === 'dsf' || ext === 'dff') return 'DSD'
    if (ext === 'aiff') return 'PCM'
  }

  return ext
}

// ============================================================
// CUE Sheet 解析：整轨 FLAC/APE/WAV/WV 分轨入库
// CUE 格式参考：https://en.wikipedia.org/wiki/Cue_sheet_(computing)
// ============================================================

interface CueTrack {
  index: number       // 曲目序号（从1开始）
  title: string       // 曲目标题
  artist: string      // 表演者（可选，默认用专辑表演者）
  album: string       // 专辑名
  startSec: number    // 起始时间（秒）
  endSec: number      // 结束时间（秒，0 = 直到下一轨或文件结束）
  audioFile: string   // 对应的音频文件路径
  audioExt: string    // 音频文件后缀（用于检测编码）
}

/**
 * 解析 CUE Sheet 文本，返回分轨信息
 * 支持 REM/PERFORMER/TITLE/FILE/TRACK/INDEX 命令
 */
function parseCueSheet(cueText: string, cueFilePath: string): { tracks: CueTrack[]; albumTitle: string; albumArtist: string } {
  const lines = cueText.split(/\r?\n/).map(l => l.trim())
  const tracks: CueTrack[] = []
  let albumTitle = ''
  let albumArtist = ''
  let fileLine = ''  // CUE 内引用的音频文件名
  let curTitle = ''
  let curArtist = ''
  let curTrackNum = 0
  let curIndex00 = -1  // pregap 位置
  let curIndex01 = -1  // 音频起始位置

  for (const line of lines) {
    if (!line) continue
    // REM 注释行
    if (line.toUpperCase().startsWith('REM ')) {
      const rem = line.slice(4).trim()
      if (rem.toUpperCase().startsWith('GENRE ')) continue
      if (rem.toUpperCase().startsWith('DATE ')) continue
      if (rem.toUpperCase().startsWith('COMMENT ')) continue
      if (rem.toUpperCase().startsWith('REPLAYGAIN_')) continue
      continue
    }
    // 全局 PERFORMER
    if (line.toUpperCase().startsWith('PERFORMER ') && curTrackNum === 0) {
      albumArtist = stripQuotes(line.slice(10).trim())
      continue
    }
    // 全局 TITLE（专辑名）
    if (line.toUpperCase().startsWith('TITLE ') && curTrackNum === 0) {
      albumTitle = stripQuotes(line.slice(6).trim())
      continue
    }
    // FILE 行：音频文件引用
    if (line.toUpperCase().startsWith('FILE ')) {
      // 如果之前已收集了一轨且没有 INDEX 01，用 INDEX 00
      if (curTrackNum > 0 && curIndex01 < 0 && curIndex00 >= 0) {
        curIndex01 = curIndex00
      }
      if (curTrackNum > 0 && curIndex01 >= 0) {
        finalizeTrack()
      }
      fileLine = stripQuotes(line.slice(5).trim().replace(/\s+\w+$/, ''))  // 去掉末尾的文件类型（WAVE/MP3/APE...）
      curTrackNum = 0
      continue
    }
    // TRACK 行
    if (line.toUpperCase().startsWith('TRACK ')) {
      // 收尾上一轨
      if (curTrackNum > 0 && curIndex01 < 0 && curIndex00 >= 0) {
        curIndex01 = curIndex00
      }
      if (curTrackNum > 0 && curIndex01 >= 0) {
        finalizeTrack()
      }
      const parts = line.slice(6).trim().split(/\s+/)
      curTrackNum = parseInt(parts[0], 10) || (tracks.length + 1)
      curTitle = ''
      curArtist = ''
      curIndex00 = -1
      curIndex01 = -1
      continue
    }
    // 曲目级 TITLE
    if (line.toUpperCase().startsWith('TITLE ') && curTrackNum > 0) {
      curTitle = stripQuotes(line.slice(6).trim())
      continue
    }
    // 曲目级 PERFORMER
    if (line.toUpperCase().startsWith('PERFORMER ') && curTrackNum > 0) {
      curArtist = stripQuotes(line.slice(10).trim())
      continue
    }
    // INDEX 行：MM:SS:FF（分:秒:帧，75帧/秒）
    if (line.toUpperCase().startsWith('INDEX ')) {
      const parts = line.slice(6).trim().split(/\s+/)
      const idx = parseInt(parts[0], 10)
      const timeStr = parts[1] || ''
      const sec = cueTimeToSec(timeStr)
      if (idx === 0) curIndex00 = sec
      else if (idx === 1) curIndex01 = sec
      continue
    }
  }
  // 收尾最后一轨
  if (curTrackNum > 0 && curIndex01 < 0 && curIndex00 >= 0) {
    curIndex01 = curIndex00
  }
  if (curTrackNum > 0 && curIndex01 >= 0) {
    finalizeTrack()
  }

  function finalizeTrack() {
    // 计算结束时间 = 下一轨的起始时间（后面再修正）
    tracks.push({
      index: curTrackNum,
      title: curTitle || `Track ${curTrackNum}`,
      artist: curArtist || albumArtist,
      album: albumTitle,
      startSec: curIndex01,
      endSec: 0,  // 稍后填充
      audioFile: '',  // 稍后填充
      audioExt: '',
    })
  }

  // 计算每轨的结束时间 = 下一轨的起始时间
  for (let i = 0; i < tracks.length; i++) {
    if (i < tracks.length - 1) {
      tracks[i].endSec = tracks[i + 1].startSec
    }
    // endSec = 0 表示最后一轨，播放到文件结束
  }

  // 解析音频文件路径（CUE 内引用的 FILE 通常是相对路径）
  if (fileLine) {
    const cueDir = dirname(cueFilePath)
    // 尝试相对路径解析
    const resolved = join(cueDir, fileLine)
    if (existsSync(resolved)) {
      for (const t of tracks) {
        t.audioFile = resolved
        t.audioExt = extname(resolved).toLowerCase().slice(1)
      }
    } else {
      // 尝试在同级目录找同名音频文件（不同后缀）
      for (const ext of ['.flac', '.ape', '.wav', '.wv', '.m4a', '.mp3', '.ogg', '.aiff']) {
        const candidate = join(cueDir, basename(fileLine, extname(fileLine)) + ext)
        if (existsSync(candidate)) {
          for (const t of tracks) {
            t.audioFile = candidate
            t.audioExt = ext.slice(1)
          }
          break
        }
      }
    }
  }

  return { tracks, albumTitle, albumArtist }
}

/** CUE 时间格式 MM:SS:FF → 秒（75帧/秒） */
function cueTimeToSec(timeStr: string): number {
  const m = timeStr.match(/^(\d+):(\d+):(\d+)$/)
  if (!m) {
    // 尝试 MM:SS 格式
    const m2 = timeStr.match(/^(\d+):(\d+)$/)
    if (m2) return parseInt(m2[1], 10) * 60 + parseInt(m2[2], 10)
    return 0
  }
  const min = parseInt(m[1], 10)
  const sec = parseInt(m[2], 10)
  const frames = parseInt(m[3], 10)
  return min * 60 + sec + frames / 75
}

/** 去掉 CUE 值两端的引号 */
function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, '').trim()
}

/**
 * 处理所有 CUE 文件，返回分轨行数据用于入库
 * 每个分轨条目的 path = "音频文件路径#cue=起始秒-结束秒"
 * 播放器通过 path 中的 cue 参数 seek 到正确位置
 */
function processCueSheets(cueFiles: string[], db: Database.Database): any[] {
  const rows: any[] = []
  const now = Math.floor(Date.now() / 1000)

  for (const cuePath of cueFiles) {
    try {
      const cueText = readFileSync(cuePath, 'utf-8')
      // 跳过 BOM
      const cleanText = cueText.replace(/^\uFEFF/, '')
      const { tracks, albumTitle, albumArtist } = parseCueSheet(cleanText, cuePath)

      for (const t of tracks) {
        if (!t.audioFile) {
          console.warn(`[cue] no audio file found for track ${t.index} in ${cuePath}`)
          continue
        }
        // path 格式：音频文件路径#cue=起始秒-结束秒
        const endSec = t.endSec > 0 ? t.endSec : 0
        const songPath = `${t.audioFile}#cue=${t.startSec.toFixed(3)}-${endSec.toFixed(3)}`

        // 检查是否已存在（避免重复入库）
        const exists = db.prepare('SELECT id FROM songs WHERE path = ?').get(songPath)
        if (exists) continue

        const duration = endSec > 0 ? Math.round((endSec - t.startSec) * 10) / 10 : 0
        rows.push({
          path: songPath,
          title: t.title,
          artist: t.artist || albumArtist || '',
          album: albumTitle || '',
          duration,
          bitrate: 0,
          format: t.audioExt,
          codec: t.audioExt,  // CUE 分轨暂时用后缀，播放时由 BASS 自动检测
          cover_path: null,
          favorite: 0,
          created_at: now,
          modified_at: now,
        })
      }
    } catch (e) {
      console.warn(`[cue] failed to parse ${cuePath}:`, e)
    }
  }
  return rows
}

// ============================================================
// LRC 歌词解析与关联
// ============================================================

interface LrcLine {
  time: number   // 秒
  text: string  // 歌词文本
}

/**
 * 解析 LRC 歌词文件
 * 支持多时间标签行：[00:01.00][00:15.00]同一行歌词
 * 支持元数据：[ti:标题][ar:歌手][al:专辑]
 */
function parseLrc(lrcText: string): { lines: LrcLine[]; title: string; artist: string } {
  const lines = lrcText.replace(/^\uFEFF/, '').split(/\r?\n/)
  const result: LrcLine[] = []
  let title = ''
  let artist = ''

  const timeRe = /\[(\d+):(\d+)(?:[.:](\d+))?\]/g

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // 元数据标签
    const metaMatch = trimmed.match(/^\[(ti|ar|al|by|offset):(.*)\]$/i)
    if (metaMatch) {
      const key = metaMatch[1].toLowerCase()
      const val = metaMatch[2].trim()
      if (key === 'ti') title = val
      else if (key === 'ar') artist = val
      continue
    }

    // 时间标签行（可能多个时间标签在同一行）
    const times: number[] = []
    let match: RegExpExecArray | null
    let lastIndex = 0
    timeRe.lastIndex = 0
    while ((match = timeRe.exec(trimmed)) !== null) {
      const min = parseInt(match[1], 10)
      const sec = parseInt(match[2], 10)
      const ms = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0
      times.push(min * 60 + sec + ms / 1000)
      lastIndex = timeRe.lastIndex
    }

    if (times.length > 0) {
      const text = trimmed.slice(lastIndex).trim()
      for (const t of times) {
        result.push({ time: t, text })
      }
    }
  }

  // 按时间排序
  result.sort((a, b) => a.time - b.time)
  return { lines: result, title, artist }
}

/**
 * 处理所有 LRC 文件，将歌词关联到数据库中的歌曲
 * 关联策略：LRC 文件名与音频文件名匹配（不含后缀）
 * 例如：song.flac + song.lrc → 关联
 */
function processLrcFiles(lrcFiles: string[], db: Database.Database): number {
  let count = 0
  const insLyric = db.prepare(`
    INSERT OR REPLACE INTO lyrics (song_id, lrc_path, lines_json, title, artist)
    VALUES (?, ?, ?, ?, ?)
  `)
  const findSongByPath = db.prepare(`
    SELECT id FROM songs WHERE path LIKE ? LIMIT 1
  `)

  for (const lrcPath of lrcFiles) {
    try {
      const lrcText = readFileSync(lrcPath, 'utf-8')
      const { lines, title, artist } = parseLrc(lrcText)

      // 找到与 LRC 同名的音频文件
      const lrcBase = basename(lrcPath, '.lrc')
      const dir = dirname(lrcPath)
      let songId: number | null = null

      // 1) 精确匹配：同目录下同名的音频文件
      for (const ext of ['.mp3', '.flac', '.wav', '.ape', '.m4a', '.aac', '.ogg', '.wv', '.aiff', '.opus', '.dsf', '.dff']) {
        const candidate = join(dir, lrcBase + ext)
        const found = db.prepare('SELECT id FROM songs WHERE path = ? OR path LIKE ?').get(candidate, candidate + '%')
        if (found) {
          songId = (found as any).id
          break
        }
      }

      // 2) 模糊匹配：按文件名关键词搜索
      if (!songId) {
        const found = db.prepare(`
          SELECT id FROM songs
          WHERE title LIKE ? OR path LIKE ?
          ORDER BY id LIMIT 1
        `).get(`%${lrcBase}%`, `%${lrcBase}%`) as any
        if (found) songId = found.id
      }

      if (songId) {
        insLyric.run(songId, lrcPath, JSON.stringify(lines), title, artist)
        count++
      } else {
        console.warn(`[lrc] no matching song for ${lrcPath}`)
      }
    } catch (e) {
      console.warn(`[lrc] failed to parse ${lrcPath}:`, e)
    }
  }
  return count
}
