import { defineStore } from 'pinia'
import { nextTick, ref, watch } from 'vue'
import { usePlayerStore } from './player'
import { useLibraryStore } from './library'

export const THEMES: { id: string; name: string; c1: string; c2: string }[] = [
  { id: 'warm-orange', name: '暖橙',     c1: '#ff7e5f', c2: '#feb47b' },
  { id: 'violet',      name: '紫罗兰',   c1: '#667eea', c2: '#764ba2' },
  { id: 'neon-pink',   name: '霓虹粉',   c1: '#f093fb', c2: '#f5576c' },
  { id: 'glacier',     name: '冰川蓝',   c1: '#4facfe', c2: '#00f2fe' },
  { id: 'mint',        name: '薄荷绿',   c1: '#43e97b', c2: '#38f9d7' }
]

export const useUiStore = defineStore('ui', () => {
  const activeTab = ref<'library'|'playlists'|'favorites'|'mix'>('library')
  const theme = ref('warm-orange')
  const queueOpen = ref(false)
  const settingsOpen = ref(false)
  const searchOpen = ref(false)
  const searchKeyword = ref('')
  const selectedPlaylistId = ref<number | null>(null)
  const selectedSongIds = ref<Set<number>>(new Set())

  // —— 滚动定位当前播放歌曲 ——
  // 每次请求定位时自增 1；PlaylistPanel / 其他组件监听它 + locateSongId 做 scrollIntoView
  const locateSongRequest = ref(0)
  const locateSongId = ref<number | null>(null)

  async function locateInList(songId: number, playlistId?: number | null, tab?: 'library'|'playlists'|'favorites') {
    if (tab && tab !== activeTab.value) activeTab.value = tab
    if (selectedPlaylistId.value !== (playlistId ?? null)) selectedPlaylistId.value = playlistId ?? null
    locateSongId.value = songId
    await nextTick()
    locateSongRequest.value++
  }

  /** 根据当前播放歌曲，判定它在哪个列表（歌单/收藏/全部音乐），然后切换 Tab + 滚动定位。 */
  async function navigateToCurrentSong() {
    const player = usePlayerStore()
    const lib = useLibraryStore()
    const cur = player.currentSong
    if (!cur) return
    const id = cur.id
    // 1) 当前选中歌单 → 如果此歌单包含当前歌曲，就留在歌单 Tab
    if (selectedPlaylistId.value != null) {
      const pl = lib.playlists.find(p => p.id === selectedPlaylistId.value)
      if (pl?.songs?.some(s => s.id === id)) {
        await locateInList(id, pl.id, 'playlists')
        return
      }
    }
    // 2) 收藏 Tab：歌曲收藏状态为 1
    if ((cur.favorite ?? 0) === 1) {
      await locateInList(id, null, 'favorites')
      return
    }
    // 3) 其他歌单是否包含当前歌曲（选第一个命中）
    const hit = lib.playlists.find(p => (p.songs ?? []).some(s => s.id === id))
    if (hit) {
      await locateInList(id, hit.id, 'playlists')
      return
    }
    // 4) 兜底：全部音乐
    await locateInList(id, null, 'library')
  }

  function applyTheme(id: string) {
    const t = THEMES.find(x => x.id === id) ?? THEMES[0]
    document.documentElement.setAttribute('data-theme', t.id)
    document.documentElement.style.setProperty('--c-accent-1', t.c1)
    document.documentElement.style.setProperty('--c-accent-2', t.c2)
    theme.value = t.id
    try { window.api.settings.set('theme', t.id) } catch {}
  }

  async function initUiFromSettings() {
    try {
      const savedTheme = await window.api.settings.get<string>('theme', 'warm-orange')
      applyTheme(savedTheme)
      const lastPid = await window.api.settings.get<number | null>('lastPlaylistId', null)
      if (lastPid) selectedPlaylistId.value = lastPid
    } catch {}
  }

  watch(selectedPlaylistId, v => { try { window.api.settings.set('lastPlaylistId', v) } catch {} })

  return {
    activeTab, theme, queueOpen, settingsOpen, searchOpen, searchKeyword, selectedPlaylistId, selectedSongIds,
    locateSongRequest, locateSongId,
    applyTheme, initUiFromSettings, navigateToCurrentSong, locateInList
  }
})
