<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import GlassCard from './GlassCard.vue'
import { usePlayerStore } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import { useAudioStore } from '@/stores/audio'
import { fmtTime } from '@/utils/format'

const player = usePlayerStore()
const ui = useUiStore()
const lib = useLibraryStore()
const audio = useAudioStore()

const { currentSong, playing, progress, duration, volume, playbackRate, needReload, modeIcon, loopActive, mode } = storeToRefs(player)

const playbackRates = [0.25, 0.5, 1, 1.5, 1.75, 2, 3, 4, 5]

const audioEl = ref<HTMLAudioElement | null>(null)
const rateOpen = ref(false)
const rateWrap = ref<HTMLElement | null>(null)

const w = window as any
// IPC 存在只是基础，真正要启用引擎必须 engine load 后能给出有效 duration
const engineIpcAvailable = typeof w.api?.audio?.engine?.load === 'function'
const engineWorking = ref(false)

// 防 race condition：记录当前 audio 元素实际加载的歌曲路径
const loadedPath = ref<string>('')
// 防无限切歌 / 重复切歌：ended + timer 兜底都可能同时触发 next，加锁避免一次歌曲结束跳 2 首
const nextTriggeredAt = ref(0)
const MIN_NEXT_GAP_MS = 1200
// 刚切歌的保护时间（按歌曲真实时长 20%，至少 700ms）避免刚起播立即 ended
function minGuardMs() {
  const d = Number(duration.value) || 0
  return Math.max(700, isFinite(d) && d > 0 ? Math.floor(d * 200) : 700)
}

const ensureUrl = async (s: any) => {
  if (!s) return ''
  if (!(s as any)._url) (s as any)._url = await window.api.library.resolvePath((s as any).path)
  return (s as any)._url
}

const engineLoad = async (path: string) => {
  try {
    if (engineIpcAvailable) {
      const result = await w.api.audio.engine.load(path)
      const ok = typeof result === 'boolean' ? result : result?.ok
      const isNative = typeof result === 'object' ? result?.native : false
      // 只要 native BASS 加载成功且创建流成功，就走 BASS 引擎
      if (ok && isNative) {
        engineWorking.value = true
        // 获取 duration 用于 UI 显示（失败不影响播放）
        try {
          const d = Number(await w.api.audio.engine.duration()) || 0
          if (d > 0) player.duration = d
        } catch {}
      } else {
        engineWorking.value = false
        // stub 模式下仍获取 duration
        try {
          const d = Number(await w.api.audio.engine.duration()) || 0
          if (d > 0) player.duration = d
        } catch {}
      }
      return !!ok
    }
  } catch { engineWorking.value = false }
  return false
}

const enginePlay = async () => {
  try { if (engineIpcAvailable) await w.api.audio.engine.play() } catch {}
}
const enginePause = async () => {
  try { if (engineIpcAvailable) await w.api.audio.engine.pause() } catch {}
}
const engineVolume = (v: number) => {
  // v is 0-1 (player volume), convert to 0-100 for audio engine musicGain
  try { if (engineIpcAvailable) w.api.audio.engine.volume(Math.max(0, Math.min(100, v * 100))) } catch {}
}
const engineSeek = (sec: number) => {
  try { if (engineIpcAvailable) w.api.audio.engine.seek(sec) } catch {}
}
const enginePosition = async () => {
  try { if (engineIpcAvailable) return Number(await w.api.audio.engine.position()) || 0 } catch {}
  return 0
}
const engineDuration = async () => {
  try { if (engineIpcAvailable) {
    const d = Number(await w.api.audio.engine.duration()) || 0
    if (d > 0) return d
  } } catch {}
  return 0
}

watch(needReload, async () => {
  if (!currentSong.value) return
  const pos = player.lastSavedPosition
  const sid = player.lastSavedSongId
  const seekOnce = pos && Math.abs(pos) > 1 && sid === currentSong.value.id

  const path = currentSong.value.path
  // 记录本次切歌时间（下次自动切歌需要 MIN_NEXT_GAP_MS 间隔，避免重复触发）
  nextTriggeredAt.value = Date.now()
  // engineWorking = 引擎 load 之后能返回有效 duration；否则一律走 HTML5 audio 保底
  const loadedOk = engineIpcAvailable ? await engineLoad(path) : false
  const useEngine = loadedOk && engineWorking.value

  // 即使 stub 模式下也获取 duration 用于显示
  if (loadedOk && !useEngine) {
    const d = await engineDuration()
    if (d > 0) player.duration = d
  }

  if (!useEngine && audioEl.value) {
    const url = await ensureUrl(currentSong.value)
    loadedPath.value = path
    // 先 pause，防止浏览器把上一首的 ended 事件在 src 赋值瞬间又抛一次
    try { audioEl.value.pause() } catch {}
    try { audioEl.value.currentTime = 0 } catch {}
    audioEl.value.src = url
    // 标记已加载的路径，watch(playing) 会检查这个值
    try { if (playing.value) await audioEl.value.play() } catch { playing.value = false }
    if (seekOnce) {
      const doSeek = () => {
        try { if (audioEl.value) { audioEl.value.currentTime = pos; player.lastSavedPosition = 0 } } catch {}
      }
      audioEl.value.addEventListener('loadedmetadata', doSeek, { once: true })
    }
  } else {
    loadedPath.value = path
    if (seekOnce) engineSeek(pos)
    if (playing.value) await enginePlay()
  }
}, { flush: 'post' })

watch(playing, async (v) => {
  const useEngine = engineIpcAvailable && engineWorking.value
  if (useEngine) {
    if (v) await enginePlay()
    else await enginePause()
  } else if (audioEl.value) {
    if (v) {
      // 防 race condition：只有当前 audio 源匹配当前歌曲时才播放
      if (loadedPath.value === currentSong.value?.path) {
        audioEl.value.play().catch(() => { playing.value = false })
      }
      // 否则等 watch(needReload) 加载完新源后会自动调用 play
    } else {
      audioEl.value.pause()
    }
  }
})

watch(volume, (v) => {
  engineVolume(v)
  applyAudioElVolume()
}, { immediate: true })

// 混音面板的 musicGain / monitorGain 变化时，同步 HTML5 audio 元素音量
// 混音关闭：本地音量 = player.volume × musicGain
// 混音开启：本地音量 = player.volume × monitorGain（musicGain 只控制给队友的混音器音量）
watch(() => [audio.state.on, audio.state.musicGain, audio.state.monitorGain], () => {
  applyAudioElVolume()
})

function applyAudioElVolume() {
  if (!audioEl.value) return
  const baseVol = volume.value // player.volume, 0-1
  const mixOn = audio.state.on
  // 混音关闭时：musicGain 控制本地音量；混音开启时：monitorGain 控制本地监听音量
  const gainPct = mixOn ? (audio.state.monitorGain / 100) : (audio.state.musicGain / 100)
  audioEl.value.volume = Math.max(0, Math.min(1, baseVol * gainPct))
}

watch(playbackRate, (v) => {
  // 1) HTML5 audio 保底：设置 playbackRate
  if (audioEl.value) {
    try { audioEl.value.playbackRate = Number(v) || 1 } catch {}
  }
  // 2) native engine：player store 的 watch 已经调用过一次 rate；这里再做一次兜底同步（保证切歌/刷新后仍生效）
  try {
    if (engineIpcAvailable && typeof w.api?.audio?.engine?.rate === 'function') {
      w.api.audio.engine.rate(Number(v) || 1).catch(() => {})
    }
  } catch {}
}, { immediate: true })

const rateLabel = computed(() => {
  const v = Number(playbackRate.value) || 1
  return `${v === 1 ? '1.0x' : v.toFixed(2).replace(/\.?0+$/, '') + 'x'}`
})

const rateMenuUp = ref(false)
function closeRateMenu() { rateOpen.value = false }
function toggleRate(e: MouseEvent) {
  e?.stopPropagation?.()
  rateOpen.value = !rateOpen.value
  if (rateOpen.value) {
    // 智能定位：如果按钮靠近屏幕底部，菜单在上方显示
    try {
      const r = rateWrap.value?.getBoundingClientRect()
      if (r) {
        const spaceBelow = window.innerHeight - r.bottom
        rateMenuUp.value = spaceBelow < 280
      }
    } catch {}
    setTimeout(() => {
      const onMouseDown = (ev: MouseEvent) => {
        if (!rateOpen.value) return
        const t = ev.target as Node | null
        if (t && rateWrap.value && !rateWrap.value.contains(t)) closeRateMenu()
      }
      const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') closeRateMenu()
      }
      const cleanup = () => {
        document.removeEventListener('mousedown', onMouseDown, true)
        document.removeEventListener('keydown', onKeyDown, true)
        closeRateMenu.removeListener?.(cleanup)
      }
      closeRateMenu.removeListener = cleanup
      // 监听 rateOpen 关闭时清理
      const stopWatch = watch(rateOpen, (v) => {
        if (!v) { stopWatch(); cleanup() }
      })
      document.addEventListener('mousedown', onMouseDown, true)
      document.addEventListener('keydown', onKeyDown, true)
    }, 0)
  }
}
function pickRate(e: MouseEvent, r: number) {
  e?.stopPropagation?.()
  playbackRate.value = r
  closeRateMenu()
}
const locateSong = () => { ui.navigateToCurrentSong() }


// 统一自动切歌入口（防重入 + 生效时间窗口判断）
// 两条触发链路：audio onEnded 事件、以及计时器兜底检测 progress>=duration-0.1
function safeAutoNext(src: 'ended'|'timer-engine'|'timer-html5') {
  const now = Date.now()
  // 1) 全局防重入：任何自动切歌 1.2s 内只允许一次（避免 ended+timer 同时触发，跳过两首）
  if (now - nextTriggeredAt.value < MIN_NEXT_GAP_MS) return
  // 2) 刚切完歌的保护窗口（避免刚加载 src 立即被某些浏览器抛 ended 导致立即切）
  const guard = minGuardMs()
  if (now - nextTriggeredAt.value < guard) return
  // 3) 进度-时长有效性校验：进度必须接近或超过时长
  const p = Number(progress.value) || 0
  const d = Number(duration.value) || 0
  if (!isFinite(p) || !isFinite(d) || d <= 0 || p < 0) return
  // 空文件（<0.3s）不切，避免 duration 估算错误导致死循环
  if (d < 0.3) return
  // 进度必须到达末尾（>=99.6% 或 >= duration-0.2s，任一条满足）
  if (!(p >= d - 0.2 || (d > 0 && p / d >= 0.996))) {
    // onEnded 特殊：即使 HTML5 audio 报 ended，但进度没到（例如流异常），也要放行——因为 ended 是浏览器官方结论
    if (src !== 'ended') return
  }
  nextTriggeredAt.value = now
  player.next(false)
}

let progressTimer: ReturnType<typeof setInterval> | null = null
const startProgressPoll = () => {
  if (progressTimer) return
  progressTimer = setInterval(async () => {
    const useEngine = engineIpcAvailable && engineWorking.value
    if (useEngine) {
      // 引擎模式：主进程轮询 position/duration
      const [p, d] = await Promise.all([enginePosition(), engineDuration()])
      const np = isFinite(p) && p >= 0 ? p : 0
      const nd = isFinite(d) && d > 0 ? d : 0
      player.progress = np
      player.duration = nd
      if (nd > 0.3 && np >= nd - 0.2) safeAutoNext('timer-engine')
      return
    }
    // HTML5 audio 模式：onTime 每 250ms 也做一次播完兜底检测
    // （防止 Windows 下某些 MP3 解码器 ended 事件不触发，导致"播完不切"）
    if (audioEl.value) {
      const a = audioEl.value
      let ap = 0, ad = 0
      try { ap = a.currentTime || 0 } catch {}
      try { ad = a.duration || 0 } catch {}
      const np = isFinite(ap) && ap >= 0 ? ap : 0
      const nd = isFinite(ad) && ad > 0 ? ad : 0
      player.progress = np
      player.duration = nd
      // 浏览器如果已经 paused 并且 currentTime 到达末尾，等价于 ended
      const looksEnded = nd > 0.3 && np >= nd - 0.2
      if (looksEnded) safeAutoNext('timer-html5')
    }
  }, 250)
}
const stopProgressPoll = () => {
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null }
}
startProgressPoll()

const onTime = () => {
  const useEngine = engineIpcAvailable && engineWorking.value
  if (useEngine) return
  if (!audioEl.value) return
  const p = audioEl.value.currentTime
  const d = audioEl.value.duration || 0
  const np = isFinite(p) && p >= 0 ? p : 0
  const nd = isFinite(d) && d > 0 ? d : 0
  // 只同步显示；真正的切歌由 progressTimer 兜底 + ended 事件双保险触发
  if (np > 0 || player.progress === 0) player.progress = np
  if (nd > 0) player.duration = nd
}
const onLoaded = () => {
  const useEngine = engineIpcAvailable && engineWorking.value
  if (useEngine) return
  if (!audioEl.value) return
  const d = audioEl.value.duration || 0
  if (isFinite(d) && d > 0) player.duration = d
}
const onEnded = () => {
  const useEngine = engineIpcAvailable && engineWorking.value
  if (useEngine) return
  safeAutoNext('ended')
}
const onError = () => {
  // 音频加载失败：不自动切歌（避免死循环），停在当前位置、playing=false
  if (engineIpcAvailable && engineWorking.value) return
  try { playing.value = false } catch {}
}

function seek(e: MouseEvent) {
  if (!duration.value) return
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  const tgt = duration.value * ratio
  const useEngine = engineIpcAvailable && engineWorking.value
  if (useEngine) {
    engineSeek(tgt)
    player.progress = tgt
  } else if (audioEl.value) {
    audioEl.value.currentTime = tgt
    player.progress = audioEl.value.currentTime
  }
}

const toggleFav = () => { if (currentSong.value) lib.toggleFavorite(currentSong.value.id) }
const favActive = computed(() => (currentSong.value as any)?.favorite === 1)
const openQueue = () => { ui.queueOpen = true }
const modeName = computed(() => ({order:'顺序播放', list:'列表循环', one:'单曲循环', random:'随机播放'} as any)[mode.value])
// 快速切换是否循环（不经过单曲/随机）
function quickToggleLoop() {
  mode.value = (mode.value === 'order') ? 'list' : 'order'
  try { window.api.settings.set('defaultPlayMode', mode.value) } catch {}
}

let offs: (void | (() => void))[] = []
onMounted(() => {
  try { offs.push((window.api as any).system?.onMenuAction?.((a: string) => handleAction(a))) } catch {}
  try { offs.push((window.api as any).system?.onHotkey?.((a: string) => handleAction(a))) } catch {}
  try { offs.push((window.api as any).system?.onMenuPreset?.((p: string) => handlePreset(p))) } catch {}
})
onUnmounted(() => {
  stopProgressPoll()
  offs.forEach(f => typeof f === 'function' && f())
  // 卸载时确保倍速菜单的全局监听器也被清理
  closeRateMenu()
  ;(closeRateMenu as any).removeListener?.()
})

function handlePreset(p: string) {
  const id = p as any
  if (id === 'gaming' || id === 'listening' || id === 'streamer' || id === 'watching' || id === 'meeting') {
    audio.applyPreset(id)
  }
}

function handleAction(a: string) {
  switch (a) {
    case 'playPause': player.playPauseFlip(); break
    case 'prev': player.prev(true); break
    case 'next': player.next(true); break
    case 'toggleFav': if (currentSong.value) lib.toggleFavorite(currentSong.value.id); break
    case 'volUp':   player.volume = Math.min(1, player.volume + 0.1); break
    case 'volDown': player.volume = Math.max(0, player.volume - 0.1); break
    case 'toggleMix': audio.applyPatch({ on: !audio.state.on }); break
    case 'presetGaming': audio.applyPreset('gaming'); break
    case 'presetListening': audio.applyPreset('listening'); break
    case 'presetStreamer': audio.applyPreset('streamer'); break
    case 'presetWatching': audio.applyPreset('watching'); break
    case 'presetMeeting': audio.applyPreset('meeting'); break
    case 'emergencyStop': audio.emergencyStop(); break
  }
}
</script>

<template>
  <GlassCard radius="lg" class="bp">
    <audio ref="audioEl" preload="metadata" @timeupdate="onTime" @loadedmetadata="onLoaded" @ended="onEnded" @error="onError" />

    <div class="now">
      <div class="mc">{{ currentSong ? '🎼' : '—' }}</div>
      <div class="mi">
        <div class="mt">{{ currentSong?.title ?? '未在播放' }}</div>
        <div class="ma">{{ currentSong?.artist ?? '—' }}</div>
      </div>
      <div class="fav" :class="{on:favActive}" @click="toggleFav">♡</div>
    </div>

    <div class="ctrl">
      <div class="btns">
        <div class="btn mode-switch active-mode" :title="modeName" @click="player.cycleMode()">{{ modeIcon }} <span class="mode-label">{{ modeName }}</span></div>
        <div class="btn" @click="player.prev(true)">⏮</div>
        <div class="btn play" @click="player.playPauseFlip()">{{ playing ? '⏸' : '▶' }}</div>
        <div class="btn" @click="player.next(true)">⏭</div>
        <div class="btn" :class="{on: loopActive}" title="循环开关（顺序/列表循环）" @click="quickToggleLoop()">🔁</div>
      </div>
      <div class="prow">
        <span class="t">{{ fmtTime(isFinite(progress) && progress>=0 ? progress : 0) }}</span>
        <div class="pg" @click="seek">
          <div class="pg-fill" :style="{ width: ( (duration>0 && isFinite(duration) && isFinite(progress) && progress>=0) ? Math.max(0, Math.min(100, progress/duration*100)) : 0) + '%' }"></div>
        </div>
        <span class="t e">{{ fmtTime(isFinite(duration) && duration>0 ? duration : 0) }}</span>
      </div>
    </div>

    <div class="right">
      <div class="mix" :class="{off: !audio.state.on}" @click="audio.applyPatch({ on: !audio.state.on })">
        {{ audio.state.on ? '混音中' : '混音关' }}
      </div>
      <button class="locate-btn" title="定位当前歌曲在歌单中的位置" @click="locateSong">🎯 定位</button>
      <div class="rate-wrap" ref="rateWrap">
        <button class="rate-btn" :class="{on: playbackRate !== 1}" :title="`播放速度 ${rateLabel}`" @click="toggleRate($event)">{{ rateLabel }}</button>
        <div class="rate-menu" :class="{open: rateOpen, up: rateMenuUp}">
          <button
            v-for="r in playbackRates"
            :key="r"
            class="rate-item"
            :class="{active: playbackRate === r}"
            @click="pickRate($event, r)"
          >{{ r === 1 ? '1.0x 正常' : (r.toFixed(2).replace(/\.?0+$/, '') + 'x') }}</button>
        </div>
      </div>
      <div class="v">
        <span class="vi">🔊</span>
        <input type="range" v-model.number="volume" min="0" max="1" step="0.01" class="vs">
      </div>
      <button class="q" title="播放队列" @click="openQueue">☰</button>
    </div>
  </GlassCard>
</template>

<style lang="scss" scoped>
.bp { padding: 12px 22px; display: grid; grid-template-columns: 1.2fr 1.6fr 1fr; gap: 18px; align-items: center; }
@media (max-width: 1080px) {
  .bp { grid-template-columns: 1fr 2fr 1.2fr; gap: 14px; }
  .btn.mode-switch { min-width: 90px; }
  .mode-label { font-size: 11px; }
  .vs { width: 70px; }
}
@media (max-width: 900px) {
  .bp { grid-template-columns: 1fr; gap: 10px; padding: 12px 14px; }
  .now { justify-content: flex-start; }
  .btns { justify-content: center; gap: 10px; }
  .right { flex-wrap: wrap; justify-content: center; gap: 8px; }
}
.now { display: flex; align-items: center; gap: 11px; min-width: 0; }
.mc { width: 44px; height: 44px; border-radius: 11px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: 19px;
  background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2)); box-shadow: 0 4px 12px rgba(255,126,95,.3); }
.mi { min-width: 0; flex: 1; }
.mt { font-size: 13px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ma { font-size: 11px; color: rgba(255,255,255,.5); margin-top: 2px; }
.fav { margin-left: auto; color: rgba(255,255,255,.4); font-size: 16px; cursor: pointer; }
.fav.on { color: #ef4444; }
.ctrl { display: flex; flex-direction: column; gap: 9px; }
.btns { display: flex; align-items: center; justify-content: center; gap: 16px; }
.btn { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  color: rgba(255,255,255,.75); font-size: 15px; cursor: pointer; }
.btn:hover { background: rgba(255,255,255,.08); color: #fff; }
.btn.active-mode, .btn.on { color: var(--c-accent-1); }
.btn.play { width: 46px; height: 46px; font-size: 17px; color: #fff;
  background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2)); box-shadow: 0 6px 18px rgba(255,126,95,.45); }
.btn.play:hover { transform: scale(1.05); }
.btn.mode-switch { width: auto; min-width: 118px; padding: 0 12px; border-radius: 18px; gap: 6px;
  background: linear-gradient(135deg, rgba(255,126,95,.12), rgba(254,180,123,.08));
  border: 1px solid rgba(255,126,95,.22); }
.mode-label { font-size: 12px; font-weight: 600; font-family: inherit; letter-spacing: .2px; }
.prow { display: flex; align-items: center; gap: 10px; width: 100%; }
.t { font-size: 11px; color: rgba(255,255,255,.5); font-variant-numeric: tabular-nums; min-width: 36px; }
.t.e { text-align: right; }
.pg { flex: 1; height: 5px; border-radius: 3px; background: rgba(255,255,255,.1); cursor: pointer; position: relative; overflow: hidden; }
.pg-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--c-accent-1), var(--c-accent-2)); }
.right { display: flex; align-items: center; justify-content: flex-end; gap: 9px; }
.mix { display: flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 9px; cursor: pointer; font-size: 11px; color: #4ade80;
  background: linear-gradient(135deg, rgba(34,197,94,.15), rgba(22,163,74,.1)); border: 1px solid rgba(34,197,94,.25); }
.mix::before { content:''; width: 7px; height: 7px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 8px rgba(34,197,94,.8); animation: blink 1.2s ease-in-out infinite; }
.mix.off { background: rgba(255,255,255,.05); border-color: rgba(255,255,255,.08); color: rgba(255,255,255,.4); }
.mix.off::before { background: rgba(255,255,255,.3); box-shadow: none; animation: none; }
@keyframes blink { 0%,100% {opacity:1;} 50%{opacity:.4;} }

.locate-btn {
  height: 28px; padding: 0 11px; border-radius: 14px; border: 1px solid rgba(255,255,255,.1);
  background: linear-gradient(135deg, rgba(96,165,250,.12), rgba(59,130,246,.08));
  color: rgba(255,255,255,.78); font-size: 12px; cursor: pointer; letter-spacing: .3px;
}
.locate-btn:hover { color: #fff; border-color: rgba(96,165,250,.3); background: linear-gradient(135deg, rgba(96,165,250,.2), rgba(59,130,246,.14)); }

.rate-wrap { position: relative; }
.rate-btn {
  height: 28px; padding: 0 11px; border-radius: 14px; border: 1px solid rgba(255,255,255,.1);
  background: rgba(255,255,255,.05); color: rgba(255,255,255,.75); font-size: 12px; cursor: pointer;
  font-variant-numeric: tabular-nums; min-width: 52px; font-weight: 600;
}
.rate-btn:hover { color: #fff; }
.rate-btn.on { color: var(--c-accent-1); border-color: rgba(255,126,95,.25); background: linear-gradient(135deg, rgba(255,126,95,.12), rgba(254,180,123,.08)); }
.rate-menu {
  position: absolute; top: calc(100% + 8px); right: 0; min-width: 120px; z-index: 40;
  display: none;
  background: rgba(20,20,30,.92); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
  border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 6px;
  box-shadow: 0 10px 30px rgba(0,0,0,.45);
}
.rate-menu.open { display: block; }
.rate-menu.up { top: auto; bottom: calc(100% + 8px); }
.rate-item {
  display: block; width: 100%; padding: 7px 11px; border: none; background: transparent;
  color: rgba(255,255,255,.7); text-align: left; border-radius: 8px; cursor: pointer; font-size: 12px;
}
.rate-item:hover { background: rgba(255,255,255,.08); color: #fff; }
.rate-item.active { color: var(--c-accent-1); background: linear-gradient(135deg, rgba(255,126,95,.14), rgba(254,180,123,.08)); font-weight: 600; }

.v { display: flex; align-items: center; gap: 7px; }
.vi { font-size: 14px; color: rgba(255,255,255,.65); }
.vs { width: 88px; -webkit-appearance: none; height: 4px; border-radius: 2px; background: rgba(255,255,255,.1); cursor: pointer; }
.vs::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: #fff; }
.q { width: 34px; height: 34px; border-radius: 9px; border: 1px solid rgba(255,255,255,.08); cursor: pointer;
  background: rgba(255,255,255,.05); color: rgba(255,255,255,.75); font-size: 15px; }
</style>
