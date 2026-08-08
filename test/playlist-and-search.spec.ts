import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { tmpdir } from 'os'
import { mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'
import { scanFolder } from '../src/main/services/scanner'

function makeDB(dir: string) {
  const db = new Database(join(dir, 't.sqlite'))
  const { readFileSync } = require('fs')
  db.exec(readFileSync(join(process.cwd(), 'src/main/db/schema.sql'), 'utf-8'))
  const names = ['A - a.mp3','A - b.mp3','B - c.mp3','B - d.flac']
  for (const n of names) writeFileSync(join(dir, n), Buffer.alloc(1024))
  scanFolder(dir, db)
  return db
}

describe('playlist CRUD', () => {
  let tmp: string, db: Database.Database
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'aurora-m2-'))
    db = makeDB(tmp)
  })
  afterAll(() => db.close())

  it('新建歌单返回自增 id，至少有 1 个默认歌单', () => {
    const before = (db.prepare('SELECT COUNT(*) n FROM playlists').get() as any).n
    expect(before).toBeGreaterThanOrEqual(1)
    const info = db.prepare('INSERT INTO playlists (name, created_at, updated_at) VALUES (?,?,?)')
      .run('测试歌单', Date.now(), Date.now())
    expect(info.lastInsertRowid).toBeGreaterThan(0)
  })
  it('向歌单里添加三首歌，order_index 从 1..3 升序', () => {
    const pid = (db.prepare('SELECT id FROM playlists WHERE name=?').get('测试歌单') as any).id
    const songIds = (db.prepare('SELECT id FROM songs ORDER BY id LIMIT 3').all() as {id:number}[]).map(r=>r.id)
    expect(songIds.length).toBe(3)
    const ins = db.prepare('INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id, order_index) VALUES (?,?,?)')
    songIds.forEach((sid, i) => ins.run(pid, sid, i+1))
    const rows = db.prepare('SELECT song_id, order_index FROM playlist_songs WHERE playlist_id=? ORDER BY order_index').all(pid) as any[]
    expect(rows.map(r => r.order_index)).toEqual([1,2,3])
  })
  it('从歌单移除一首，之后 count = 2', () => {
    const pid = (db.prepare('SELECT id FROM playlists WHERE name=?').get('测试歌单') as any).id
    const sid = db.prepare('SELECT song_id FROM playlist_songs WHERE playlist_id=? ORDER BY order_index LIMIT 1').pluck().get(pid) as number
    db.prepare('DELETE FROM playlist_songs WHERE playlist_id=? AND song_id=?').run(pid, sid)
    const n = (db.prepare('SELECT COUNT(*) n FROM playlist_songs WHERE playlist_id=?').get(pid) as any).n
    expect(n).toBe(2)
  })
  it('歌曲切换收藏 favorite = 1 返回 true', () => {
    const sid = db.prepare('SELECT id FROM songs LIMIT 1').pluck().get() as number
    db.prepare('UPDATE songs SET favorite=1 WHERE id=?').run(sid)
    const fav = db.prepare('SELECT favorite FROM songs WHERE id=?').pluck().get(sid) as number
    expect(fav).toBe(1)
  })
  it('LIKE 搜索 title/artist', () => {
    const found = db.prepare("SELECT title,artist FROM songs WHERE title LIKE '%a%' OR artist LIKE '%A%'").all() as any[]
    expect(found.length).toBeGreaterThanOrEqual(1)
  })
  it('播放历史写入后能查到最新一条', () => {
    const sid = db.prepare('SELECT id FROM songs LIMIT 1').pluck().get() as number
    const info = db.prepare('INSERT INTO play_history (song_id, played_at, duration_sec) VALUES (?,?,?)').run(sid, Date.now(), 42.5)
    const last = db.prepare('SELECT id, song_id FROM play_history WHERE id=?').get(info.lastInsertRowid) as any
    expect(last.song_id).toBe(sid)
  })
})
