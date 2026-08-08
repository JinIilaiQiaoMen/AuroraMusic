import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { useUiStore } from './ui'
import { usePlayerStore } from './player'

export interface Song { id: number; path: string; title: string; artist: string; album: string; duration: number; format: string; favorite: number }
export interface Playlist { id: number; name: string; description?: string; songs: Song[] }

export const useLibraryStore = defineStore('library', () => {
  const songs = ref<Song[]>([])
  const playlists = ref<Playlist[]>([])
  const loading = ref(false)
  const selectedSongIds = ref<Set<number>>(new Set())

  // 歌单 ID 统一存到 ui store（避免 2 个 store 状态不同步 → 点歌单不切内容）
  const _ui = (): any => useUiStore()

  const selectedPlaylistId = computed<number | null>({
    get: () => _ui().selectedPlaylistId,
    set: (v: number | null) => { _ui().selectedPlaylistId = v }
  })

  const activeTab = computed<'library'|'playlists'|'favorites'|'mix'>(() => _ui().activeTab)

  async function loadAll() {
    loading.value = true
    try {
      songs.value = await window.api.library.getSongs() as any
      playlists.value = await window.api.library.getPlaylists() as any
    } finally { loading.value = false }
  }
  async function scanFolders(paths: string[]) {
    const res = await window.api.library.scanFolders(paths) as any
    songs.value = res.songs
    return res.inserted as number
  }

  async function createPlaylist(name: string, description?: string) {
    const r = await window.api.library.createPlaylist(name, description) as any
    playlists.value = await window.api.library.getPlaylists() as any
    return r
  }
  async function updatePlaylist(id: number, patch: {name?: string; description?: string}) {
    await window.api.library.updatePlaylist(id, patch)
    playlists.value = await window.api.library.getPlaylists() as any
  }
  async function deletePlaylist(id: number) {
    await window.api.library.deletePlaylist(id)
    playlists.value = await window.api.library.getPlaylists() as any
    if (selectedPlaylistId.value === id) selectedPlaylistId.value = null
  }
  async function addToPlaylist(playlistId: number, songIds: number[]) {
    await window.api.library.addSongsToPlaylist(playlistId, songIds)
    playlists.value = await window.api.library.getPlaylists() as any
  }
  async function removeFromPlaylist(playlistId: number, songIds: number[]) {
    await window.api.library.removeSongsFromPlaylist(playlistId, songIds)
    playlists.value = await window.api.library.getPlaylists() as any
  }
  async function reorderPlaylist(playlistId: number, order: number[]) {
    await window.api.library.reorderPlaylist(playlistId, order)
    playlists.value = await window.api.library.getPlaylists() as any
  }
  async function toggleFavorite(songId: number) {
    const fav = await window.api.library.toggleFavorite(songId) as boolean
    const s = songs.value.find(x => x.id === songId); if (s) (s as any).favorite = fav ? 1 : 0
    // 同时把所有 playlists 中这首歌的 fav 状态刷新（避免列表显示不一致）
    for (const pl of playlists.value) {
      for (const x of pl.songs) if (x.id === songId) (x as any).favorite = fav ? 1 : 0
    }
    return fav
  }
  async function removeFromLibrary(songIds: number[]) {
    if (!songIds?.length) return 0
    const player = usePlayerStore()
    const set = new Set<number>(songIds.filter(Number.isFinite))
    // 先从播放队列移除（如果命中当前播放要停）
    for (let i = player.queue.length - 1; i >= 0; i--) {
      if (set.has(player.queue[i].id)) player.removeFromQueue(i)
    }
    const removed = await window.api.library.removeSongsFromLibrary([...set]) as number
    if (removed > 0) {
      songs.value = songs.value.filter(s => !set.has(s.id))
      for (const pl of playlists.value) {
        pl.songs = (pl.songs ?? []).filter(s => !set.has(s.id))
      }
      if (selectedSongIds.value.size) {
        const next = new Set(selectedSongIds.value)
        for (const id of set) next.delete(id)
        selectedSongIds.value = next
      }
    }
    return removed
  }
  let favoritesCache: Song[] = []
  async function loadFavorites() {
    favoritesCache = await window.api.library.getFavorites() as any
    return favoritesCache
  }
  async function doSearch(kw: string) {
    return await window.api.library.search(kw, 300) as Song[]
  }

  // 选中的歌单详情（独立 songs 数组）
  const currentPlaylist = computed<Playlist | null>(() => {
    const pid = selectedPlaylistId.value
    if (pid == null) return null
    return playlists.value.find(p => p.id === pid) ?? null
  })

  // 当前主界面歌单面板显示的歌曲列表
  function currentList(): Song[] {
    // 如果是在收藏 Tab 下：即使选中了歌单，也优先显示收藏（收藏 Tab 就是独立的）
    if (activeTab.value === 'favorites') {
      // 实时从 songs 过滤，保证与顶部 ♡ 同步
      return songs.value.filter(s => (s.favorite ?? 0) === 1)
    }
    const pid = selectedPlaylistId.value
    if (pid != null) {
      const pl = playlists.value.find(p => p.id === pid)
      if (pl) return pl.songs ?? []
    }
    return songs.value
  }

  // 歌单被删除时，若它仍被选中，自动切回"全部音乐"
  watch(() => playlists.value, (ps) => {
    const pid = selectedPlaylistId.value
    if (pid != null && !ps.find(p => p.id === pid)) selectedPlaylistId.value = null
  })

  return {
    songs, playlists, loading, selectedPlaylistId, selectedSongIds,
    currentPlaylist,
    loadAll, scanFolders,
    createPlaylist, updatePlaylist, deletePlaylist, addToPlaylist, removeFromPlaylist, reorderPlaylist,
    toggleFavorite, removeFromLibrary, loadFavorites, doSearch, currentList
  }
})
