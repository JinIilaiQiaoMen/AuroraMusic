<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import PlaylistDialogs from './PlaylistDialogs.vue'
import { ref } from 'vue'
const lib = useLibraryStore(); const ui = useUiStore()
const { playlists } = storeToRefs(lib)
const open = ref(false)
const mode = ref<'new'|'rename'|'delete'>('new')
const targetId = ref<number | null>(null)
const openNew = () => { mode.value='new'; targetId.value=null; open.value=true }
const openRename = (id: number) => { mode.value='rename'; targetId.value=id; open.value=true }
const openDelete = (id: number) => { mode.value='delete'; targetId.value=id; open.value=true }
const select = (id:number) => { ui.selectedPlaylistId = id; ui.activeTab = 'library' }
</script>

<template>
  <div class="tp">
    <div class="head">
      <div class="t">全部歌单 · {{ playlists.length }}</div>
      <button class="btn-primary" @click="openNew">＋ 新建歌单</button>
    </div>
    <div class="grid">
      <div v-for="pl in playlists" :key="pl.id" class="card" @click="select(pl.id)">
        <div class="thumb">🎧</div>
        <div class="info">
          <div class="name">{{ pl.name }}</div>
          <div class="meta">{{ (pl as any).songs?.length ?? 0 }} 首</div>
        </div>
        <div class="more" @click.stop>
          <span @click.stop="openRename(pl.id)">✏️</span>
          <span @click.stop="openDelete(pl.id)">🗑️</span>
        </div>
      </div>
    </div>
    <PlaylistDialogs v-model:open="open" :mode="mode" :playlist-id="targetId" />
  </div>
</template>

<style lang="scss" scoped>
.tp { min-height: 0; display: flex; flex-direction: column; }
.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.t { font-size: 15px; font-weight: 700; color: #fff; }
.btn-primary { padding: 7px 14px; border-radius: 10px; font-size: 12px; font-weight: 600; border: 0; color: #fff; cursor: pointer;
  background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2)); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; overflow-y: auto; padding-bottom: 4px; }
.card { position: relative; border-radius: 15px; padding: 12px; cursor: pointer;
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); transition: transform .15s; }
.card:hover { transform: translateY(-2px); background: rgba(255,255,255,.07); }
.thumb { width: 100%; aspect-ratio: 1; border-radius: 11px; margin-bottom: 10px; display: flex; align-items: center; justify-content: center; font-size: 36px;
  background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2)); box-shadow: 0 10px 24px rgba(255,126,95,.28); }
.name { font-size: 13px; font-weight: 600; color: #fff; margin-bottom: 2px; }
.meta { font-size: 11px; color: rgba(255,255,255,.5); }
.more { position: absolute; top: 6px; right: 8px; display: flex; gap: 4px; font-size: 12px; color: rgba(255,255,255,.5); }
.more span { padding: 2px 5px; border-radius: 5px; }
.more span:hover { background: rgba(255,255,255,.1); color: #fff; }
</style>
