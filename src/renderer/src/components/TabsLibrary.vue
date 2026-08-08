<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useLibraryStore } from '@/stores/library'
import PlaylistPanel from './PlaylistPanel.vue'
const lib = useLibraryStore()
const { songs, selectedPlaylistId, currentPlaylist } = storeToRefs(lib)

const inPlaylist = computed(() => selectedPlaylistId.value != null)
const playlistName = computed(() => currentPlaylist.value?.name ?? '')
const playlistDesc = computed(() => currentPlaylist.value?.description ?? '')
const playlistSongs = computed(() => currentPlaylist.value?.songs ?? [])
const playlistSongCount = computed(() => playlistSongs.value.length)
const playlistTotalSec = computed(() => playlistSongs.value.reduce((a, b) => a + ((b.duration as number) || 0), 0))
const fmt = (s:number) => {
  const h = Math.floor(s / 3600); const m = Math.floor(s % 3600 / 60)
  return (h ? `${h}小时 ` : '') + `${m}分`
}

function backToAll() { selectedPlaylistId.value = null }

const mode = computed<'all'|'artist'|'album'>({
  get: () => (window as any).__tlMode ?? 'all',
  set: (v) => (window as any).__tlMode = v
})
const groupKey = computed<string | null>({
  get: () => (window as any).__tlGroup ?? null,
  set: (v) => (window as any).__tlGroup = v
})
const groups = computed(() => {
  if (mode.value === 'artist') return Array.from(new Set(songs.value.map(s=>s.artist || '未知歌手')))
  if (mode.value === 'album')  return Array.from(new Set(songs.value.map(s=>s.album  || '未知专辑')))
  return []
})
const filtered = computed(() => {
  // 选中歌单时：不做 artist/album 过滤，直接显示该歌单内容（独立、不被总库过滤干扰）
  if (inPlaylist.value) return playlistSongs.value
  if (mode.value === 'all') return songs.value
  const key = groupKey.value; if (!key) return songs.value
  return songs.value.filter(s => mode.value === 'artist' ? s.artist === key : s.album === key)
})
const plName = computed(() => {
  if (inPlaylist.value) return playlistName.value
  return mode.value==='all' ? '全部音乐' : (groupKey.value ?? (mode.value==='artist'?'按歌手':'按专辑'))
})
</script>

<template>
  <div class="tl">
    <div v-if="inPlaylist" class="playlist-hero">
      <button class="back" @click="backToAll" title="返回全部音乐">← 返回全部</button>
      <div class="hero-inner">
        <div class="pcover">{{ (playlistName || 'P').slice(0,1).toUpperCase() }}</div>
        <div class="pinfo">
          <div class="pline plname">{{ playlistName }}</div>
          <div v-if="playlistDesc" class="pline pdesc">{{ playlistDesc }}</div>
          <div class="pline pmeta">{{ playlistSongCount }} 首 · 总时长 {{ fmt(playlistTotalSec) }} · 歌单</div>
        </div>
      </div>
    </div>
    <template v-else>
      <div class="chips">
        <div class="chip" :class="{active: mode==='all'}" @click="mode='all'; groupKey=null">全部</div>
        <div class="chip" :class="{active: mode==='artist'}" @click="mode='artist'; groupKey=null">按歌手</div>
        <div class="chip" :class="{active: mode==='album'}" @click="mode='album'; groupKey=null">按专辑</div>
      </div>
      <div v-if="mode!=='all'" class="grouplist">
        <div v-for="g in groups" :key="g" class="gitem" :class="{active: groupKey===g}" @click="groupKey = g">{{ g }}</div>
      </div>
    </template>
    <PlaylistPanel
      :songs="filtered"
      :playlist-name="plName"
      :playlist-id="inPlaylist ? selectedPlaylistId : null"
      :allow-reorder="inPlaylist"
      :allow-delete="true"
      :handle-locate="true"
    />
  </div>
</template>

<style lang="scss" scoped>
.tl { display: grid; grid-template-rows: auto auto 1fr; gap: 8px; min-height: 0; }
.playlist-hero { padding: 10px 2px 2px; }
.back { align-self: flex-start; border: 0; padding: 5px 11px; border-radius: 999px; cursor: pointer; margin-bottom: 10px;
  background: rgba(255,255,255,.04); color: rgba(255,255,255,.7); font-size: 11.5px; border: 1px solid rgba(255,255,255,.07); }
.back:hover { background: rgba(255,255,255,.08); color: #fff; }
.hero-inner { display: flex; gap: 14px; align-items: center;
  padding: 14px; border-radius: 14px;
  background: linear-gradient(135deg, rgba(255,126,95,.18), rgba(254,180,123,.1));
  border: 1px solid rgba(255,126,95,.25); }
.pcover { width: 72px; height: 72px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 34px; font-weight: 800; color: #fff;
  background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2)); box-shadow: 0 8px 22px rgba(255,126,95,.3); }
.pinfo { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.pline { font-size: 12px; color: rgba(255,255,255,.6); }
.plname { font-size: 20px; font-weight: 700; color: #fff; }
.pdesc { font-size: 12px; color: rgba(255,255,255,.55); }
.pmeta { font-size: 11px; color: rgba(255,255,255,.45); margin-top: 2px; }
.chips { display: flex; gap: 6px; }
.chip { padding: 5px 13px; border-radius: 999px; font-size: 12px; cursor: pointer;
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); color: rgba(255,255,255,.65); }
.chip.active { background: linear-gradient(135deg, rgba(255,126,95,.22), rgba(254,180,123,.15)); color: #fff; border-color: rgba(255,126,95,.35); }
.grouplist { display: flex; flex-wrap: wrap; gap: 5px; max-height: 90px; overflow-y: auto; }
.gitem { padding: 3px 9px; font-size: 11px; color: rgba(255,255,255,.55); cursor: pointer; border-radius: 7px; background: rgba(255,255,255,.03); }
.gitem.active { background: rgba(255,255,255,.1); color: #fff; }
</style>
