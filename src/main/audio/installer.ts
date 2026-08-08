import { app, shell } from 'electron'
import { existsSync, createWriteStream, mkdirSync, rmSync, readdirSync, renameSync, copyFileSync, statSync, appendFileSync, readdir } from 'fs'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { join, dirname, basename } from 'path'
import { EOL } from 'os'
import * as https from 'https'
import * as http from 'http'
import {
  bassDllExists,
  ffiAvailable,
  nativeBassActive,
  tryLoadNativeBass,
} from '../../../native/bass'
import {
  rnnoiseDllExists,
  nativeRNNoiseActive,
} from '../../../native/rnnoise'
import { listPlaybackDevices, listRecordingDevices } from './devices'
import type { InstallStatus, InstallerSource } from './types'

const execFileP = promisify(execFile)
const readdirP = promisify(readdir)

/* ════════════════════════════════════════════════════════════════════════════
 * 错误日志子系统：每次自动安装生成独立的 .log 文件，失败后可在向导里一键打开
 * ════════════════════════════════════════════════════════════════════════════ */

export interface InstallLogger {
  info: (msg: string, extra?: unknown) => void
  warn: (msg: string, extra?: unknown) => void
  error: (msg: string, extra?: unknown) => void
  stepStart: (stepName: string) => void
  stepEnd: (stepName: string, ok: boolean, extra?: string) => void
  /** 日志文件绝对路径 */
  path: string
  /** 关闭日志流（在 finally 里调用），失败时追加一段诊断建议 */
  close: (success: boolean, summary?: string) => void
}

export function logsDir(): string {
  const d = join(app.getPath('userData'), 'logs', 'install')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function timeStamp(): string {
  const d = new Date()
  const p2 = (n: number) => String(n).padStart(2, '0')
  const p3 = (n: number) => String(n).padStart(3, '0')
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p3(d.getMilliseconds())}`
}

/** 按修改时间降序返回日志目录下的文件，取最新用 */
export async function listInstallLogs(max = 10): Promise<string[]> {
  try {
    const d = logsDir()
    const names = await readdirP(d)
    const items = names
      .filter(n => n.endsWith('.log'))
      .map(n => {
        try { return { name: n, ts: statSync(join(d, n)).mtimeMs } } catch { return null }
      })
      .filter(<T>(x: T | null): x is T => x !== null)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, max)
      .map(x => join(d, x.name))
    return items
  } catch {
    return []
  }
}

export async function getLatestInstallLogPath(): Promise<string | null> {
  const all = await listInstallLogs(1)
  return all[0] ?? null
}

export async function openInstallLogFolder(): Promise<boolean> {
  try { await shell.openPath(logsDir()); return true } catch { return false }
}

export function createInstallLogger(sessionId: string): InstallLogger {
  const dir = logsDir()
  const tsFile = new Date().toISOString().replace(/[:.]/g, '-')
  const logPath = join(dir, `install-${sessionId}-${tsFile}.log`)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  /* 日志头：系统信息 + 环境信息 */
  const envInfo = [
    '═'.repeat(78),
    'Aurora Music 自动安装诊断日志',
    '═'.repeat(78),
    `日志文件 : ${logPath}`,
    `会话 ID  : ${sessionId}`,
    `开始时间 : ${timeStamp()}`,
    `平台/架构: ${process.platform} ${process.arch}`,
    `Node.js  : ${process.version}`,
    `Electron : ${process.versions.electron ?? 'unknown'}`,
    `Chrome   : ${process.versions.chrome ?? 'unknown'}`,
    `V8       : ${process.versions.v8 ?? 'unknown'}`,
    `Aurora   : v${(app as any).isPackaged ? 'packaged' : 'dev-mode'}  AppPath=${app.getAppPath()}`,
    `resources: ${(process as any).resourcesPath ?? 'n/a'}`,
    `userData : ${app.getPath('userData')}`,
    `temp     : ${app.getPath('temp')}`,
    `PID      : ${process.pid}  PPID: ${process.ppid}`,
    `命令行   : ${process.execPath}  ${process.argv.slice(1).join(' ')}`,
    '─'.repeat(78),
    '',
  ].join(EOL)
  appendFileSync(logPath, envInfo + EOL, 'utf-8')

  function writeLine(level: string, msg: string, extra?: unknown) {
    let line = `[${timeStamp()}] [${level.padEnd(5, ' ')}] ${msg}`
    if (extra !== undefined) {
      try {
        if (extra instanceof Error) {
          line += EOL + '  ├─ Error.message: ' + extra.message +
            (extra.stack ? (EOL + '  ├─ Error.stack:' + EOL + '  │  ' + extra.stack.split(/\r?\n/).join(EOL + '  │  ')) : '') +
            ((extra as any).code ? (EOL + '  ├─ Error.code: ' + (extra as any).code) : '') +
            ((extra as any).errno !== undefined ? (EOL + '  ├─ Error.errno: ' + (extra as any).errno) : '') +
            ((extra as any).syscall ? (EOL + '  ├─ Error.syscall: ' + (extra as any).syscall) : '') +
            ((extra as any).path ? (EOL + '  ├─ Error.path: ' + (extra as any).path) : '') +
            ((extra as any).address ? (EOL + '  ├─ Error.address: ' + (extra as any).address) : '')
        } else {
          line += '  ⇒ ' + (typeof extra === 'string' ? extra : JSON.stringify(extra, null, 0))
        }
      } catch { line += ' ⇒ [stringify failed]' }
    }
    try { appendFileSync(logPath, line + EOL, 'utf-8') } catch { /* 磁盘满等，静默 */ }
  }

  const stepStack: Array<{ name: string; start: number }> = []

  return {
    info: (m, e) => writeLine('INFO', m, e),
    warn: (m, e) => writeLine('WARN', m, e),
    error: (m, e) => writeLine('ERROR', m, e),
    stepStart(name) {
      stepStack.push({ name, start: Date.now() })
      writeLine('STEP', `▶ START  ${'  '.repeat(Math.max(0, stepStack.length - 1))}${name}`)
    },
    stepEnd(name, ok, extra) {
      const top = stepStack[stepStack.length - 1]
      const dur = top ? ` (${Date.now() - top.start} ms)` : ''
      if (top && top.name === name) stepStack.pop()
      writeLine('STEP', `${ok ? '✔ OK   ' : '✗ FAIL '} ${'  '.repeat(Math.max(0, stepStack.length))}${name}${dur}${extra ? '  —  ' + extra : ''}`)
    },
    path: logPath,
    close(success, summary) {
      try {
        const tail: string[] = [
          '',
          '─'.repeat(78),
          `结束时间 : ${timeStamp()}`,
          `总结果   : ${success ? '✅ 全部步骤成功' : '❌ 至少有一步失败'}`,
        ]
        if (summary) tail.push(`概要     : ${summary}`)
        if (!success) {
          tail.push('')
          tail.push('【常见故障排查建议】')
          tail.push('  1. 网络失败：检查是否能访问 https://download.vb-audio.com / https://www.un4seen.com / https://github.com')
          tail.push('     → 可使用系统代理或切换网络后重试「一键自动安装」')
          tail.push('  2. 权限不足：VB-CABLE 安装程序需要管理员权限 (UAC)，若被拦截请手动运行 %TEMP%\\AuroraVBCable\\vbc\\下的 Setup')
          tail.push('  3. 解压失败：若 PowerShell Expand-Archive 报错，请先执行：')
          tail.push('     Set-ExecutionPolicy -Scope CurrentUser RemoteSigned')
          tail.push('  4. 驱动未生效：安装完必须重启系统。重启后在「设置→声音→录制」里应出现 CABLE Output')
          tail.push('  5. DLL 仍缺失：请检查 native/bass/x64 与 native/rnnoise/x64 目录，并确认文件被杀毒软件未隔离')
          tail.push('  6. 如仍有问题，请把本日志文件发送给技术支持，并附上上面的 ERROR 行。')
        }
        tail.push('═'.repeat(78))
        appendFileSync(logPath, tail.join(EOL) + EOL, 'utf-8')
      } catch {}
    },
  }
}

const VB_CABLE_WEB_URL = 'https://vb-audio.com/Cable/'
const VB_CABLE_DL_URL = 'https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack43.zip'
const BASS_WEB_URL = 'https://www.un4seen.com/bass.html'
const RNNOISE_WEB_URL = 'https://github.com/xiph/rnnoise/releases'

/* 官方 un4seen BASS/BASSmix x64 下载，解压后会带内部的 x64/bass.dll 子目录 */
const BASS_ZIP_URLS = [
  'https://www.un4seen.com/files/bass24.zip',
  'https://us.un4seen.com/files/bass24.zip',
]
const BASSMIX_ZIP_URLS = [
  'https://www.un4seen.com/files/z/0/bassmix24.zip',
  'https://us.un4seen.com/files/z/0/bassmix24.zip',
]
/* RNNoise 社区预编译 Windows x64 DLL。多镜像依次尝试，保证命中率。 */
const RNNOISE_DLL_URLS = [
  'https://github.com/xiph/rnnoise/releases/download/continuous/rnnoise-win-x64.dll',
  'https://dl.bintray.com/xiph/rnnoise/rnnoise.dll',
  'https://cdn.jsdelivr.net/gh/xiph/rnnoise@master/.github/workflows/rnnoise.dll',
  'https://github.com/GregorR/rnnoise-nu/releases/download/0.2/rnnoise.dll',
]

type AutoStep = 'idle' | 'downloading' | 'unpacking' | 'launching' | 'waiting-confirm' | 'done' | 'error'
export interface AutoInstallProgress { step: AutoStep; percent: number; message: string }
export type ProgressCb = (p: AutoInstallProgress) => void

function getTempDir(): string {
  const d = join(app.getPath('temp'), 'AuroraVBCable')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

/* ─────────────────────────── 路径解析：开发 vs 打包 ─────────────────────────── */

/** 返回 { appRoot/native/bass/x64 , appRoot/native/rnnoise/x64 }
 *  dev 模式: app.getAppPath() = 项目根 (native/ 是源码同级)
 *  packaged: resourcesPath = 应用 resources/ 目录 (native/ 由 electron-builder 的 extraResources 拷入) */
function resolveNativeDirs(): { bass: string; rnnoise: string } {
  const root = app.isPackaged ? (process as any).resourcesPath : app.getAppPath()
  return {
    bass: join(root, 'native', 'bass', 'x64'),
    rnnoise: join(root, 'native', 'rnnoise', 'x64'),
  }
}

/** dev 模式下，原生 DLL 需要同时放到 out/main 编译产物下对应的 native/ 镜像目录吗？
 *  实际上我们在 native/*  /index.ts 里用的是: root = app.isPackaged ? resourcesPath : app.getAppPath()
 *  所以开发模式下 app.getAppPath() = 项目根目录，直接在源码 native/ 中即可。
 *  但如果用户运行打包后的预览 (preview / dist:dir)， resourcesPath 下需要有 native/。
 *  为了双保险，这里写入目标路径的同时，若目标根 != 项目根，也同步镜像一份到项目根 native/（如果项目根存在）。 */
function writeDll(destDir: string, filename: string, sourceTmpFile: string, logger?: InstallLogger): void {
  logger?.stepStart(`writeDll ${filename}`)
  try {
    if (!existsSync(destDir)) { mkdirSync(destDir, { recursive: true }); logger?.info(`创建目标目录: ${destDir}`) }
    const dest = join(destDir, filename)
    const srcSize = (() => { try { return statSync(sourceTmpFile).size } catch { return 0 } })()
    logger?.info(`复制文件`, { from: sourceTmpFile, from_size_bytes: srcSize, to: dest })
    copyFileSync(sourceTmpFile, dest)
    const destSize = (() => { try { return statSync(dest).size } catch { return -1 } })()
    logger?.info(`复制完成`, { dest_exists: existsSync(dest), dest_size_bytes: destSize })
    /* 镜像同步：如果 destDir 不在项目根 native/ 下，尝试再写一份到项目根 native/ 方便 dev 模式使用 */
    const projectRoot = app.getAppPath()
    const expectedDevDirBass = join(projectRoot, 'native', 'bass', 'x64')
    const expectedDevDirRnn = join(projectRoot, 'native', 'rnnoise', 'x64')
    if (destDir !== expectedDevDirBass && destDir !== expectedDevDirRnn) {
      try {
        if (filename === 'rnnoise.dll' && existsSync(expectedDevDirRnn) && !existsSync(join(expectedDevDirRnn, filename))) {
          const mirror = join(expectedDevDirRnn, filename)
          logger?.info(`镜像拷贝到开发目录: ${mirror}`)
          copyFileSync(sourceTmpFile, mirror)
        } else if ((filename === 'bass.dll' || filename === 'bassmix.dll') && existsSync(expectedDevDirBass) && !existsSync(join(expectedDevDirBass, filename))) {
          const mirror = join(expectedDevDirBass, filename)
          logger?.info(`镜像拷贝到开发目录: ${mirror}`)
          copyFileSync(sourceTmpFile, mirror)
        }
      } catch (e) { logger?.warn(`镜像拷贝失败: ${filename}`, e) }
    }
    logger?.stepEnd(`writeDll ${filename}`, true, `${destSize} bytes`)
  } catch (e: any) {
    logger?.error(`writeDll 失败: ${filename}`, e)
    throw e
  }
}

/* 下载（支持 http/https、3xx 重定向、进度回调、详细日志） */
function downloadFile(
  url: string,
  dest: string,
  onProgress: (pct: number) => void,
  opts?: { logger?: InstallLogger; redirectCount?: number }
): Promise<void> {
  const logger = opts?.logger
  const redirectCount = opts?.redirectCount ?? 0
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http
    const stepId = `download ${basename(dest)}` + (redirectCount ? ` [#${redirectCount}]` : '')
    logger?.stepStart(stepId)
    logger?.info(`HTTP GET 发起: ${url}`, { dest, agent: 'AuroraMusic-Installer/1.0' })
    const tStart = Date.now()
    const req = lib.get(url, { headers: { 'User-Agent': 'AuroraMusic-Installer/1.0', Accept: '*/*' } }, (res) => {
      const statusCode = res.statusCode ?? 0
      const statusMsg = res.statusMessage ?? ''
      const headers = Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : (v ?? '')]))
      logger?.info(`HTTP 响应: ${statusCode} ${statusMsg}`, {
        contentLength: headers['content-length'] ?? '',
        contentType: headers['content-type'] ?? '',
        location: headers['location'] ?? '',
        redirectCount,
        elapsed_ms: Date.now() - tStart,
      })
      if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
        if (redirectCount >= 8) {
          const err = new Error(`HTTP 重定向次数过多 (≥8)，终止于: ${res.headers.location}`)
          logger?.error(err.message)
          return reject(err)
        }
        res.resume()
        downloadFile(res.headers.location, dest, onProgress, { logger, redirectCount: redirectCount + 1 }).then(resolve).catch(reject)
        return
      }
      if (!statusCode || statusCode >= 400) {
        const err = new Error(`HTTP ${statusCode} ${statusMsg} (URL: ${url})`)
        logger?.error(`下载失败`, err)
        return reject(err)
      }
      const total = Number(headers['content-length']) || 0
      let got = 0
      logger?.info(`开始写入磁盘: ${dest}`, { total_expected_bytes: total || 'unknown' })
      const ws = createWriteStream(dest)
      let lastProg = -1
      res.on('data', (chunk: Buffer) => {
        got += chunk.length
        if (total) {
          const prog = Math.floor((got / total) * 100)
          if (prog !== lastProg) { lastProg = prog; onProgress(prog) }
        } else {
          // 未知总大小时，每 512KB 更新一次进度 (给 UI 一些反馈)
          const prog = Math.min(99, Math.floor((got / (1024 * 1024 * 30)) * 100))
          if (prog !== lastProg) { lastProg = prog; onProgress(prog) }
        }
      })
      res.pipe(ws)
      ws.on('finish', () => {
        ws.close(() => {
          try {
            const size = statSync(dest).size
            const elapsed = Date.now() - tStart
            const speedKbps = elapsed > 0 ? Math.round((size / 1024) / (elapsed / 1000)) : 0
            logger?.stepEnd(stepId, true, `${got}/${total || '?'} bytes in ${elapsed} ms, ~${speedKbps} KB/s`)
            resolve()
          } catch (e) { reject(e) }
        })
      })
      ws.on('error', (e) => { logger?.error(`写入文件错误: ${dest}`, e); reject(e) })
      res.on('error', (e) => { logger?.error(`HTTP 响应错误`, e); reject(e) })
    })
    req.on('error', (e) => { logger?.error(`HTTP 请求错误 (${url})`, e); reject(e) })
    req.setTimeout(180000, () => {
      const err = new Error(`下载超时 180s: ${url}`)
      logger?.error(err.message)
      req.destroy(err)
    })
  })
}

/* 解压 zip：优先用 PowerShell Expand-Archive，兼容所有 Windows 10/11；附带完整 stdout/stderr 日志 */
function unzipFile(zip: string, outDir: string, logger?: InstallLogger): Promise<void> {
  return new Promise((resolve, reject) => {
    const stepId = `unzip ${basename(zip)}`
    logger?.stepStart(stepId)
    const zipSize = (() => { try { return statSync(zip).size } catch { return 0 } })()
    logger?.info(`解压参数`, { zip, zip_size_bytes: zipSize, outDir })
    if (existsSync(outDir)) {
      logger?.info(`清理旧解压目录: ${outDir}`)
      rmSync(outDir, { recursive: true, force: true })
    }
    mkdirSync(outDir, { recursive: true })
    const tStart = Date.now()
    const cmd = `Expand-Archive -Path '${zip}' -DestinationPath '${outDir}' -Force`
    logger?.info(`PowerShell 命令: ${cmd}`)
    const ps = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command', cmd
    ], { windowsHide: true })
    let err = '', out = ''
    ps.stdout?.on('data', (d) => (out += d.toString()))
    ps.stderr?.on('data', (d) => (err += d.toString()))
    ps.on('error', (e) => { logger?.error(`spawn powershell.exe 失败`, e); reject(e) })
    ps.on('close', (c, signal) => {
      const elapsed = Date.now() - tStart
      if (out.trim()) logger?.info(`stdout (${elapsed} ms):` + EOL + '  │  ' + out.trim().split(/\r?\n/).join(EOL + '  │  '))
      if (err.trim()) logger?.warn(`stderr (${elapsed} ms):` + EOL + '  │  ' + err.trim().split(/\r?\n/).join(EOL + '  │  '))
      if (c === 0) {
        try {
          const items = readdirSync(outDir, { withFileTypes: true })
          const listing = items.map(i => `${i.isDirectory() ? 'DIR ' : 'FILE'}  ${i.name}`).slice(0, 20).join(EOL)
          const hidden = items.length > 20 ? ` ... (${items.length - 20} omitted)` : ''
          logger?.info(`解压结果目录 listing:${EOL}${listing}${hidden}`)
        } catch (e) { logger?.warn(`读取解压目录失败`, e) }
        logger?.stepEnd(stepId, true, `exit 0 in ${elapsed} ms`)
        resolve()
      } else {
        const e = new Error(`Expand-Archive 异常退出 code=${c}${signal ? ` signal=${signal}` : ''}: ${err.trim() || '无 stderr'}`)
        logger?.error(`解压失败`, e)
        reject(e)
      }
    })
  })
}

/* 修复 PowerShell Expand-Archive 的 _x005F_ 编码 bug：把文件名中的 _x005F_ 还原为 _ */
function fixEncodedFilenames(dir: string, logger?: InstallLogger): void {
  let renamed = 0, skipped = 0
  const walk = (d: string) => {
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch (e) { logger?.error(`遍历目录失败: ${d}`, e); return }
    for (const f of entries) {
      const fullPath = join(d, f.name)
      if (f.isDirectory()) { walk(fullPath); continue }
      if (f.name.includes('_x005F_')) {
        const fixedName = f.name.replace(/_x005F_/g, '_')
        const newPath = join(d, fixedName)
        try { renameSync(fullPath, newPath); renamed++; logger?.info(`修复 PS 编码文件名: ${f.name} → ${fixedName}`) }
        catch (e) { logger?.error(`重命名失败: ${f.name}`, e); skipped++ }
      } else {
        skipped++
      }
    }
  }
  logger?.stepStart(`fixEncodedFilenames`)
  walk(dir)
  logger?.stepEnd(`fixEncodedFilenames`, true, `修复 ${renamed} 个文件，跳过 ${skipped} 个`)
}

export async function autoInstallVBCable(onProgress?: ProgressCb, opts?: { logger?: InstallLogger }): Promise<{ ok: boolean; message: string; logFile: string | null }> {
  const send = (s: AutoStep, pct: number, msg: string) => { onProgress?.({ step: s, percent: pct, message: msg }) }
  const ownLogger = opts?.logger ?? createInstallLogger('vb-cable')
  const logFile = ownLogger.path
  let okFinal = false, summary = ''
  try {
    ownLogger.stepStart('autoInstallVBCable')
    ownLogger.info(`VB-CABLE 下载地址: ${VB_CABLE_DL_URL}`)
    ownLogger.info(`Temporary directory (temp): ${getTempDir()}`)
    send('downloading', 0, '准备下载 VB-CABLE 驱动包…')
    const tmp = getTempDir()
    const zip = join(tmp, 'VBCABLE_Driver_Pack43.zip')
    ownLogger.info(`zip 目标文件: ${zip}`)
    if (existsSync(zip)) { ownLogger.info(`删除旧 zip 文件: ${zip}`); rmSync(zip, { force: true }) }
    try {
      await downloadFile(VB_CABLE_DL_URL, zip, (pct) => send('downloading', pct, `下载驱动包 (${pct}%)`), { logger: ownLogger })
    } catch (e: any) {
      send('error', 0, '下载失败：' + (e?.message ?? String(e)))
      okFinal = false; summary = `VB-CABLE 下载失败: ${e?.message ?? e}`
      return { ok: false, message: summary, logFile }
    }

    send('unpacking', 0, '解压安装包…')
    const outDir = join(tmp, 'vbc')
    try {
      await unzipFile(zip, outDir, ownLogger)
      fixEncodedFilenames(outDir, ownLogger)
    } catch (e: any) {
      send('error', 0, '解压失败：' + (e?.message ?? String(e)))
      okFinal = false; summary = `解压失败: ${e?.message ?? e}`
      return { ok: false, message: summary, logFile }
    }

    send('launching', 99, '查找安装程序…')
    const findExe = (dir: string, patterns: RegExp[]): string | null => {
      ownLogger.stepStart('findExe in ' + basename(dir))
      ownLogger.info('匹配模式列表:', patterns.map(String))
      let dirs = 0, files = 0, triedFiles: string[] = []
      const walk = (d: string): string | null => {
        let entries
        try { entries = readdirSync(d, { withFileTypes: true }) } catch (e) { ownLogger.error('readdir 失败:' + d, e); return null }
        for (const f of entries) {
          if (f.isDirectory()) {
            dirs++
            const r = walk(join(d, f.name))
            if (r) return r
            continue
          }
          files++
          for (const p of patterns) {
            if (p.test(f.name)) {
              const hit = join(d, f.name)
              ownLogger.info(`命中: 模式 ${String(p)}  →  ${hit}`)
              ownLogger.stepEnd('findExe in ' + basename(dir), true, `命中 ${basename(hit)} (经 ${dirs} 目录 + ${files} 文件)`)
              return hit
            }
          }
          if (triedFiles.length < 20) triedFiles.push(f.name)
        }
        return null
      }
      const result = walk(dir)
      if (!result) {
        ownLogger.warn(`没找到任何匹配项，最近扫描的 ${triedFiles.length} 个文件:`, triedFiles.join(', '))
        ownLogger.stepEnd('findExe in ' + basename(dir), false, `共扫描 ${dirs} 目录 + ${files} 文件，无匹配`)
      }
      return result
    }
    const setupPatterns = [
      /Setup.*x64/i,
      /Setup.*64/i,
      /VBCABLE.*Setup/i,
      /\.exe$/i,
    ]
    const setupPath = findExe(outDir, setupPatterns)
    if (!setupPath) {
      const msg = '未找到安装程序 — 可能驱动包结构已变更或 PowerShell 解压出错，请查看日志后手动下载'
      ownLogger.error(msg)
      ownLogger.info(`可尝试手动解压: zip=${zip}，然后在解压目录里查找 VBCABLE_Setup_x64.exe`)
      send('error', 0, '未找到安装程序，建议前往官网手动下载')
      okFinal = false; summary = '未找到安装程序 (findExe 全部未命中)'
      return { ok: false, message: summary, logFile }
    }

    send('waiting-confirm', 100, '已准备好，正在调起安装程序（请点「是」授权管理员权限）…')
    try {
      /* 用 Start-Process -Verb RunAs 调起，能正确触发 UAC 且安装程序以管理员运行 */
      ownLogger.stepStart('spawn VB-CABLE installer')
      ownLogger.info(`Setup 路径: ${setupPath}`)
      const size = (() => { try { return statSync(setupPath).size } catch { return 0 } })()
      ownLogger.info(`Setup 信息: ${size} bytes, UAC=RunAs via Start-Process -Verb RunAs, args=/S`)
      const ps = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-Command', `Start-Process -FilePath '${setupPath}' -ArgumentList '/S' -Verb RunAs`
      ], { windowsHide: false, detached: true })
      ps.on('error', (e) => ownLogger.error('Start-Process spawn error', e))
      ps.unref()
      ownLogger.stepEnd('spawn VB-CABLE installer', true, 'detached=true 已启动，UAC 弹窗应由系统弹出')
      const msg = '安装程序已启动！请在 UAC 弹窗点「是」，然后等待 1-2 分钟安装完成。安装结束后必须重启电脑，虚拟麦克风才会生效。'
      send('done', 100, msg)
      okFinal = true; summary = 'VB-CABLE 安装程序已启动'
      return { ok: true, message: summary, logFile }
    } catch (e: any) {
      /* 兜底 fallback：直接 shell.openPath */
      ownLogger.warn('Start-Process 失败，降级为 shell.openPath', e)
      try { await shell.openPath(setupPath) } catch (e2) { ownLogger.error('shell.openPath 也失败', e2) }
      const msg = '已打开安装程序，请按提示完成安装，安装后重启电脑。'
      send('done', 100, msg)
      okFinal = true; summary = msg
      return { ok: true, message: summary, logFile }
    }
  } catch (e: any) {
    send('error', 0, String(e?.message ?? e))
    okFinal = false; summary = `未知异常: ${e?.message ?? e}`
    return { ok: false, message: summary, logFile }
  } finally {
    ownLogger.stepEnd('autoInstallVBCable', okFinal, summary)
    ownLogger.close(okFinal, summary)
  }
}

/* ─────────────────────────── 原生 DLL 自动下载（BASS + RNNoise）────────────────────────── */

/** 多镜像依次尝试下载，直到成功。带日志记录（哪个镜像成功/失败分别记录原因） */
async function downloadFromMirrors(
  urls: string[],
  dest: string,
  onProgress: (pct: number) => void,
  logger?: InstallLogger,
): Promise<string> {
  const id = `mirror-download ${basename(dest)}`
  logger?.stepStart(id)
  logger?.info(`候选镜像数量: ${urls.length}`, urls)
  let lastErr: any = null
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]
    logger?.info(`[${i + 1}/${urls.length}] 尝试镜像: ${url}`)
    try {
      if (existsSync(dest)) rmSync(dest, { force: true })
      await downloadFile(url, dest, onProgress, { logger })
      if (existsSync(dest)) {
        logger?.stepEnd(id, true, `第 ${i + 1} 个镜像成功: ${url}`)
        return url
      }
      logger?.warn(`镜像 ${i + 1} 文件下载完成但磁盘上找不到: ${dest}`)
    } catch (e: any) {
      logger?.warn(`镜像 ${i + 1} 失败: ${e?.message ?? e}`)
      lastErr = e
    }
  }
  logger?.stepEnd(id, false, `全部 ${urls.length} 个镜像失败`)
  throw lastErr ?? new Error('所有下载镜像均失败')
}

/** 在 zip 的解压目录内查找某个文件名（递归，大小写不敏感），带扫描日志 */
function findFileByName(dir: string, exactName: string, logger?: InstallLogger): string | null {
  const lower = exactName.toLowerCase()
  logger?.stepStart(`findFileByName ${exactName}`)
  let scanned = 0
  const walk = (d: string): string | null => {
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch (e) { logger?.error(`遍历目录失败: ${d}`, e); return null }
    for (const f of entries) {
      const full = join(d, f.name)
      if (f.isDirectory()) {
        const r = walk(full)
        if (r) return r
        continue
      }
      scanned++
      if (f.name.toLowerCase() === lower) {
        logger?.stepEnd(`findFileByName ${exactName}`, true, `扫描 ${scanned} 个文件后命中: ${full}`)
        return full
      }
    }
    return null
  }
  const r = walk(dir)
  if (!r) logger?.stepEnd(`findFileByName ${exactName}`, false, `扫描 ${scanned} 个文件后未找到`)
  return r
}

/** 下载 + 安装 BASS/BASSmix/RNNoise DLL 到 native/{bass,rnnoise}/x64/
 *  @param onlyMissing true=只安装缺失的 (默认); false=强制重装全部
 *  @returns ok + message + 成功安装的文件名数组 + logFile 路径（供 UI 打开）
 */
export async function autoInstallNativeDlls(
  opts: { onlyMissing?: boolean; logger?: InstallLogger } = {},
  onProgress?: ProgressCb
): Promise<{ ok: boolean; message: string; installed: string[]; logFile: string | null }> {
  const onlyMissing = opts.onlyMissing ?? true
  const installed: string[] = []
  const send = (s: AutoStep, pct: number, msg: string) => onProgress?.({ step: s, percent: pct, message: msg })
  const ownLogger = opts?.logger ?? createInstallLogger('native-dlls')
  const logFile = ownLogger.path
  let okFinal = false, summary = ''
  try {
    ownLogger.stepStart('autoInstallNativeDlls')
    const dirs = resolveNativeDirs()
    ownLogger.info(`目标目录: bass=${dirs.bass}, rnnoise=${dirs.rnnoise}`)
    ownLogger.info(`onlyMissing=${onlyMissing}  isPackaged=${app.isPackaged}  resourcesPath=${(process as any).resourcesPath ?? 'n/a'}`)
    const existing = { bass: bassDllExists(), rnn: rnnoiseDllExists() }
    ownLogger.info(`安装前检测: bass.dll=${existing.bass.bass}  bassmix.dll=${existing.bass.mix}  rnnoise.dll=${existing.rnn}`)
    const needBass = !onlyMissing || !existing.bass.bass
    const needMix = !onlyMissing || !existing.bass.mix
    const needRnn = !onlyMissing || !existing.rnn
    ownLogger.info(`本次需要下载: bass=${needBass}  bassmix=${needMix}  rnnoise=${needRnn}`)

    const tmp = getTempDir()
    ownLogger.info(`临时文件目录: ${tmp}`)

    if (needBass || needMix) {
      /* ---------------- BASS bass.dll ---------------- */
      if (needBass) {
        send('downloading', 5, '下载 BASS 音频引擎 (bass.dll)…')
        const zip = join(tmp, 'bass24.zip')
        try {
          const used = await downloadFromMirrors(BASS_ZIP_URLS, zip, (p) => send('downloading', 5 + Math.floor(p * 0.2), `下载 bass.dll (${p}%)`), ownLogger)
          ownLogger.info(`bass.zip 镜像: ${used}`)
        } catch (e: any) {
          okFinal = false; summary = `下载 BASS 失败：${e?.message ?? e}（已安装 ${installed.join(',') || '无'}）`
          send('error', 0, summary)
          return { ok: false, message: summary, installed, logFile }
        }
        send('unpacking', 26, '解压 bass.zip…')
        const outDir = join(tmp, 'bass-extract')
        try {
          await unzipFile(zip, outDir, ownLogger)
          fixEncodedFilenames(outDir, ownLogger)
        } catch (e: any) {
          okFinal = false; summary = `解压 BASS 失败：${e?.message ?? e}`
          send('error', 0, summary)
          return { ok: false, message: summary, installed, logFile }
        }
        const dllPath = findFileByName(outDir, 'bass.dll', ownLogger)
        if (!dllPath) {
          okFinal = false; summary = 'bass.zip 内未找到 bass.dll，请改用手动下载（日志里有已解压文件列表）'
          send('error', 0, summary)
          return { ok: false, message: summary, installed, logFile }
        }
        writeDll(dirs.bass, 'bass.dll', dllPath, ownLogger)
        installed.push('bass.dll')
      }

      /* ---------------- BASSmix bassmix.dll ---------------- */
      if (needMix) {
        send('downloading', 35, '下载 BASSmix 混音插件 (bassmix.dll)…')
        const zip = join(tmp, 'bassmix24.zip')
        try {
          const used = await downloadFromMirrors(BASSMIX_ZIP_URLS, zip, (p) => send('downloading', 35 + Math.floor(p * 0.2), `下载 bassmix.dll (${p}%)`), ownLogger)
          ownLogger.info(`bassmix.zip 镜像: ${used}`)
        } catch (e: any) {
          okFinal = false; summary = `下载 BASSmix 失败：${e?.message ?? e}（已安装 ${installed.join(',') || '无'}）`
          send('error', 0, summary)
          return { ok: false, message: summary, installed, logFile }
        }
        send('unpacking', 56, '解压 bassmix.zip…')
        const outDir = join(tmp, 'bassmix-extract')
        try {
          await unzipFile(zip, outDir, ownLogger)
          fixEncodedFilenames(outDir, ownLogger)
        } catch (e: any) {
          okFinal = false; summary = `解压 BASSmix 失败：${e?.message ?? e}（已安装 ${installed.join(',') || '无'}）`
          send('error', 0, summary)
          return { ok: false, message: summary, installed, logFile }
        }
        const dllPath = findFileByName(outDir, 'bassmix.dll', ownLogger)
        if (!dllPath) {
          okFinal = false; summary = 'bassmix.zip 内未找到 bassmix.dll，请改用手动下载（日志里有已解压文件列表）'
          send('error', 0, summary)
          return { ok: false, message: summary, installed, logFile }
        }
        writeDll(dirs.bass, 'bassmix.dll', dllPath, ownLogger)
        installed.push('bassmix.dll')
      }
    } else {
      send('downloading', 55, 'BASS DLL 已就位，跳过…')
      ownLogger.info('BASS DLL 已就位，本次跳过下载解压。')
    }

    /* ---------------- RNNoise rnnoise.dll ---------------- */
    if (needRnn) {
      send('downloading', 65, '下载 RNNoise AI 降噪 (rnnoise.dll)…')
      const tmpFile = join(tmp, 'rnnoise.dll')
      let usedUrl = ''
      try {
        usedUrl = await downloadFromMirrors(RNNOISE_DLL_URLS, tmpFile, (p) => send('downloading', 65 + Math.floor(p * 0.3), `下载 rnnoise.dll (${p}%)`), ownLogger)
        ownLogger.info(`rnnoise.dll 成功镜像: ${usedUrl}`)
      } catch (e: any) {
        okFinal = false; summary = `下载 RNNoise 失败：${e?.message ?? e}（已安装 ${installed.join(',') || '无'}）。可手动从 ${RNNOISE_WEB_URL} 获取`
        send('error', 0, summary)
        return { ok: false, message: summary, installed, logFile }
      }
      try {
        let size = 0
        try { size = statSync(tmpFile).size } catch { size = 0 }
        ownLogger.info(`rnnoise.dll 临时文件大小: ${size} bytes (路径: ${tmpFile})`)
        if (!existsSync(tmpFile) || size < 8000) {
          okFinal = false; summary = `下载到的 rnnoise.dll 文件异常 (size=${size})，可能是镜像返回 404 HTML 伪 DLL。已安装 ${installed.join(',') || '无'}`
          send('error', 0, summary)
          return { ok: false, message: summary, installed, logFile }
        }
      } catch (e: any) {
        if (!existsSync(tmpFile)) {
          okFinal = false; summary = `rnnoise.dll 下载后找不到临时文件，请改用手动下载（已安装 ${installed.join(',') || '无'}）`
          send('error', 0, summary)
          return { ok: false, message: summary, installed, logFile }
        }
        ownLogger.warn('size 校验 try-catch 到异常，但文件存在，继续', e)
      }
      writeDll(dirs.rnnoise, 'rnnoise.dll', tmpFile, ownLogger)
      installed.push('rnnoise.dll')
    } else {
      send('downloading', 95, 'RNNoise DLL 已就位，跳过…')
      ownLogger.info('RNNoise DLL 已就位，本次跳过下载。')
    }

    const final = bassDllExists()
    const finalRnn = rnnoiseDllExists()
    ownLogger.info(`安装后二次检测: bass.dll=${final.bass}  bassmix.dll=${final.mix}  rnnoise.dll=${finalRnn}`)
    ownLogger.info(`本次安装名单: ${installed.length ? installed.join('、') : '(没下载任何新文件)'}`)
    const okCount = (final.bass ? 1 : 0) + (final.mix ? 1 : 0) + (finalRnn ? 1 : 0)
    if (okCount >= 2) {
      const msg = `原生 DLL 安装完成 ✓ (${installed.join(', ') || '全部 DLL 之前已就位'}) — bass=${dirs.bass}  rnnoise=${dirs.rnnoise}`
      send('done', 100, msg)
      okFinal = true
      summary = msg
      return { ok: true, message: msg, installed, logFile }
    }
    okFinal = false
    summary = `部分 DLL 仍然缺失 (bass=${final.bass}, mix=${final.mix}, rnn=${finalRnn})`
    send('error', 0, summary)
    return { ok: false, message: summary, installed, logFile }
  } catch (e: any) {
    okFinal = false
    summary = `未知异常: ${e?.message ?? e}`
    send('error', 0, summary)
    return { ok: false, message: summary, installed, logFile }
  } finally {
    ownLogger.stepEnd('autoInstallNativeDlls', okFinal, summary)
    ownLogger.close(okFinal, summary)
  }
}

async function detectVirtualCable(): Promise<{ installed: boolean; id: number; name: string }> {
  // Primary: PS-based detection (most reliable)
  try {
    const script = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      '$devices = Get-PnpDevice -Class AudioEndpoint -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq "OK" }',
      'foreach ($dev in $devices) {',
      '  $name = $dev.FriendlyName',
      '  if ($name -match "cable input") { Write-Output ("INPUT|" + $name) }',
      '  if ($name -match "cable output") { Write-Output ("OUTPUT|" + $name) }',
      '}',
    ].join('; ')
    const { stdout } = await execFileP('powershell', ['-NoProfile', '-Command', script], { timeout: 8000, maxBuffer: 1024 * 512, windowsHide: true })
    const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(l => l)
    let hasInput = false, hasOutput = false
    let inputName = 'CABLE Input (VB-Audio Virtual Cable)'
    for (const line of lines) {
      const [dir, name] = line.split('|').map(s => (s || '').trim())
      const n = name.toLowerCase()
      if (n.includes('16ch')) continue
      if (dir === 'INPUT') { hasInput = true; inputName = name }
      if (dir === 'OUTPUT') { hasOutput = true }
    }
    if (hasInput && hasOutput) {
      return { installed: true, id: 4, name: inputName }
    }
  } catch {}
  // Fallback: BASS-based detection
  try {
    const [pb, rec] = await Promise.all([listPlaybackDevices(), listRecordingDevices()])
    const vi = pb.find(d => d.isVirtualInput)
    const vo = rec.find(d => d.isVirtualOutput)
    if (vi && vo) {
      return { installed: true, id: vi.id ?? vo.id ?? -1, name: vi.name || vo.name || 'Aurora Virtual Mic' }
    }
  } catch {}
  return { installed: false, id: -1, name: 'Aurora Virtual Mic' }
}

export async function detectInstall(): Promise<InstallStatus> {
  const bass = bassDllExists()
  const rnn = rnnoiseDllExists()

  console.log('[detectInstall] bass.dll exists:', bass.bass, 'bassmix.dll exists:', bass.mix)
  console.log('[detectInstall] ffiAvailable:', ffiAvailable(), 'nativeBassActive:', nativeBassActive())

  if (bass.bass) {
    const startedAt = Date.now()
    while (!ffiAvailable() || !nativeBassActive()) {
      if (Date.now() - startedAt > 8000) {
        console.log('[detectInstall] BASS load timeout after 8s')
        break
      }
      try { await tryLoadNativeBass() } catch {}
      if (ffiAvailable() && nativeBassActive()) break
      await new Promise(r => setTimeout(r, 120))
    }
    console.log('[detectInstall] after load loop: ffiAvailable=', ffiAvailable(), 'nativeBassActive=', nativeBassActive())
    if (nativeBassActive()) {
      try {
        if (BassLib?.BASS_Init) BassLib.BASS_Init(0xFFFFFFFF, 48000, 0, 0, 0)
      } catch (e) { console.log('[detectInstall] BASS_Init failed:', e) }
      try {
        if (BassLib?.BASS_RecordInit) BassLib.BASS_RecordInit(0xFFFFFFFF)
      } catch (e) { console.log('[detectInstall] BASS_RecordInit failed:', e) }
    }
  }

  const vc = await detectVirtualCable()
  console.log('[detectInstall] VB-CABLE detected:', vc.installed, 'id:', vc.id, 'name:', vc.name)
  const nativeAllOk = !!(bass.bass && bass.mix && ffiAvailable() && vc.installed)
  console.log('[detectInstall] nativeAllOk:', nativeAllOk, '| bass:', bass.bass, 'mix:', bass.mix, 'ffi:', ffiAvailable(), 'vc:', vc.installed)
  return {
    bassDll: bass,
    rnnoiseDll: rnn,
    rnnoiseOptional: true,
    ffiInstalled: ffiAvailable(),
    nativeBassActive: nativeBassActive(),
    nativeRnnActive: nativeRNNoiseActive(),
    virtualCableInstalled: vc.installed,
    installed: nativeAllOk,
    virtualDeviceId: vc.id,
    virtualDeviceName: vc.name,
    driverVersion: vc.installed ? 'VB-CABLE (installed)' : ''
  }
}

export async function openInstallerDownloadPage(source: InstallerSource = 'web'): Promise<void> {
  if (source === 'web') {
    try { await shell.openExternal(VB_CABLE_WEB_URL) } catch {}
    try { await shell.openExternal(BASS_WEB_URL) } catch {}
    try { await shell.openExternal(RNNOISE_WEB_URL) } catch {}
  }
}

export async function launchLocalInstaller(installerPath?: string): Promise<{ ok: boolean; reason?: string }> {
  if (!installerPath) {
    return { ok: false, reason: '未指定安装包路径（占位实现：请先下载 VB-CABLE / BASS 安装包后手动执行）' }
  }
  if (!existsSync(installerPath)) {
    return { ok: false, reason: `安装包不存在: ${installerPath}` }
  }
  try {
    await execFileP(installerPath, [], { shell: true })
    return { ok: true }
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) }
  }
}

export async function openInstaller(which: 'web' | 'local', arg?: any): Promise<boolean> {
  try {
    if (which === 'web') {
      await openInstallerDownloadPage('web')
      return true
    }
    if (which === 'local') {
      const r = await launchLocalInstaller(typeof arg === 'string' ? arg : arg?.installerPath)
      return r.ok
    }
    return false
  } catch {
    return false
  }
}
