import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { Song } from './library'

export const usePlayerStore = defineStore('player', () => {
  const queue = ref<Song[]>([])
  const queueIndex = ref(-1)
  const currentSong = ref<Song | null>(null)
  const playing = ref(false)
  const progress = ref(0)
  const duration = ref(0)
  const volume = ref(0.65)
  const playbackRate = ref(1)
  const playbackRates = [0.25, 0.5, 1, 1.5, 1.75, 2, 3, 4, 5] as const
  const mode = ref<'random' | 'order' | 'list' | 'one'>('random')
  const needReload = ref(0)
  const lastSavedSongId = ref<number | null>(null)
  const lastSavedPosition = ref(0)

  async function restoreFromSettings() {
    try {
      const sid = await window.api.settings.get<number | null>('lastSongId', null)
      const pos = await window.api.settings.get<number>('lastPosition', 0)
      const m   = await window.api.settings.get<string>('defaultPlayMode', 'order')
      const vol = await window.api.settings.get<number>('defaultVolume', 0.65)
      const rate = await window.api.settings.get<number>('defaultPlaybackRate', 1)
      lastSavedSongId.value = sid; lastSavedPosition.value = pos
      if (m === 'order' || m === 'list' || m === 'one' || m === 'random') mode.value = m
      if (typeof vol === 'number' && vol >= 0 && vol <= 1) volume.value = vol
      const allowed = new Set<number>(playbackRates as readonly number[])
      if (typeof rate === 'number' && allowed.has(rate)) playbackRate.value = rate
    } catch {}
  }
  function restoreFromLoaded(songs: Song[]) {
    if (!songs?.length) return
    let idx = 0
    if (lastSavedSongId.value != null) {
      const i = songs.findIndex(s => s.id === lastSavedSongId.value)
      if (i >= 0) idx = i
    }
    playSongs(songs, songs[idx]?.id ?? null)
  }

  function playSongs(songs: Song[], startSongId: number | null = null) {
    if (!songs.length) { queue.value = []; queueIndex.value = -1; currentSong.value = null; return }
    queue.value = [...songs]
    let idx = startSongId != null ? songs.findIndex(s => s.id === startSongId) : 0
    if (idx < 0) idx = 0
    queueIndex.value = idx
    currentSong.value = songs[idx]
    playing.value = true
    needReload.value++
  }
  function playIndex(idx: number) {
    if (idx < 0 || idx >= queue.value.length) return
    queueIndex.value = idx
    currentSong.value = queue.value[idx]
    playing.value = true
    needReload.value++
  }
  function playPauseFlip(forcePlay?: boolean) {
    if (forcePlay === true) { playing.value = true; return }
    if (forcePlay === false) { playing.value = false; return }
    playing.value = !playing.value
  }
  function next(user: boolean = false) {
    if (!queue.value.length) return
    const q = queue.value, n = q.length
    let idx = queueIndex.value
    if (mode.value === 'one' && !user) {
      // 单曲循环自动结束：重新加载当前首（需要复位进度）
      needReload.value++; return
    }
    if (mode.value === 'random') {
      if (n <= 1) { playIndex(0); return }
      let i = Math.floor(Math.random() * n)
      // 避免连续随机到同一首
      if (i === idx) i = (i + 1) % n
      idx = i
    } else if (mode.value === 'list') {
      idx = (idx + 1) % n
    } else {
      // order 模式：顺序往下
      if (idx >= n - 1) {
        if (!user) {
          // 自动播完最后一首 → 停止，不重播
          progress.value = Math.max(0, Math.min(1, duration.value || 0))
          playing.value = false
          return
        }
        // 手动 next 到了最后一首就停留
        idx = n - 1
      } else {
        idx = idx + 1
      }
    }
    playIndex(idx)
  }
  function prev(user: boolean = false) {
    if (!queue.value.length) return
    const q = queue.value, n = q.length
    let idx = queueIndex.value
    if (mode.value === 'random') {
      if (n <= 1) { playIndex(0); return }
      let i = Math.floor(Math.random() * n)
      if (i === idx) i = (i - 1 + n) % n
      idx = i
    } else if (mode.value === 'list') {
      idx = (idx - 1 + n) % n
    } else if (mode.value === 'one' && !user) {
      // 单曲模式下按"上一首"或自动回退 → 重新从头放当前首
      needReload.value++; return
    } else {
      idx = Math.max(idx - 1, 0)
    }
    playIndex(idx)
  }
  function cycleMode() {
    const order: typeof mode.value[] = ['order','list','one','random']
    mode.value = order[(order.indexOf(mode.value) + 1) % order.length]
    try { window.api.settings.set('defaultPlayMode', mode.value) } catch {}
  }
  function removeFromQueue(idx: number) {
    if (idx < 0 || idx >= queue.value.length) return
    if (idx === queueIndex.value) {
      queue.value.splice(idx, 1)
      if (queue.value.length) {
        queueIndex.value = Math.min(idx, queue.value.length - 1)
        currentSong.value = queue.value[queueIndex.value]
        needReload.value++
      } else {
        queueIndex.value = -1; currentSong.value = null; playing.value = false
      }
    } else {
      queue.value.splice(idx, 1)
      if (idx < queueIndex.value) queueIndex.value--
    }
  }
  function reorderQueue(newIds: number[]) {
    const byId = new Map(queue.value.map(s => [s.id, s] as const))
    const next: Song[] = []
    for (const id of newIds) { const s = byId.get(id); if (s) next.push(s) }
    const newIdx = currentSong.value ? next.findIndex(s => s.id === currentSong.value!.id) : -1
    queue.value = next
    queueIndex.value = Math.max(0, newIdx)
    if (queueIndex.value >= 0 && queue.value[queueIndex.value]) currentSong.value = queue.value[queueIndex.value]
  }
  async function persistProgress() {
    if (currentSong.value) {
      try {
        await Promise.all([
          window.api.settings.set('lastSongId', currentSong.value.id),
          window.api.settings.set('lastPosition', progress.value),
          window.api.library.addPlayHistory(currentSong.value.id, progress.value).catch(()=>{})
        ])
      } catch {}
    }
  }
  setInterval(persistProgress, 20000)
  watch(() => currentSong.value?.id, () => persistProgress())
  watch(mode, v => { try { window.api.settings.set('defaultPlayMode', v) } catch {} })
  watch(volume, v => { try { window.api.settings.set('defaultVolume', v) } catch {} })
  watch(playbackRate, v => {
    try { window.api.settings.set('defaultPlaybackRate', v) } catch {}
    try {
      if (typeof window.api?.audio?.engine?.rate === 'function') {
        window.api.audio.engine.rate(Number(v) || 1).catch(() => {})
      }
    } catch {}
  })

  const modeIcon = computed(() => ({ order:'➡️', list:'🔁', one:'🔂', random:'🔀'} as any)[mode.value])
  const loopActive = computed(() => mode.value === 'list' || mode.value === 'one')

  return {
    queue, queueIndex, currentSong, playing, progress, duration, volume, playbackRate, playbackRates, mode, needReload,
    lastSavedSongId, lastSavedPosition, loopActive,
    restoreFromSettings, restoreFromLoaded,
    playSongs, playIndex, playPauseFlip, next, prev, cycleMode, persistProgress,
    removeFromQueue, reorderQueue,
    modeIcon
  }
})
