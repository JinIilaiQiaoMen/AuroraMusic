import { describe, it, expect, beforeAll } from 'vitest'
import { tmpdir } from 'os'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'fs'
import { join, basename } from 'path'
import Database from 'better-sqlite3'
import { scanFolder } from '../src/main/services/scanner'

function makeTestDB(path: string) {
  const db = new Database(join(path, 'test.sqlite'))
  db.exec(readFileSync(join(process.cwd(), 'src/main/db/schema.sql'), 'utf-8'))
  return db
}

describe('scanner', () => {
  let tmp: string
  let db: Database.Database
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'aurora-test-'))
    mkdirSync(join(tmp, 'sub'))
    const f1 = join(tmp, 'song-a.mp3'); writeFileSync(f1, Buffer.alloc(4096))
    const f2 = join(tmp, 'song-b.flac'); writeFileSync(f2, Buffer.alloc(4096))
    const f3 = join(tmp, 'sub', 'readme.txt'); writeFileSync(f3, 'not audio')
    db = makeTestDB(tmp)
  })
  it('扫描音乐文件夹，入库至少 2 条（跳过 .txt）', () => {
    const inserted = scanFolder(tmp, db)
    expect(inserted).toBeGreaterThanOrEqual(2)
    const rows = db.prepare('SELECT path FROM songs').all() as { path: string }[]
    const names = rows.map(r => basename(r.path)).sort()
    expect(names).toContain('song-a.mp3')
    expect(names).toContain('song-b.flac')
    expect(names).not.toContain('readme.txt')
  })
  it('重复扫描不产生重复行', () => {
    scanFolder(tmp, db)
    const second = scanFolder(tmp, db)
    expect(second).toBe(0)
  })
})
