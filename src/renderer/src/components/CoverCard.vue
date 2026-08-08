<script setup lang="ts">
import { computed, ref } from 'vue'
import GlassCard from './GlassCard.vue'
import PlaylistDialogs from './PlaylistDialogs.vue'
import { usePlayerStore } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
const player = usePlayerStore(); const lib = useLibraryStore()
const s = computed(() => player.currentSong)
const fav = computed(() => (s.value?.favorite ?? 0) === 1)
const toggleFav = async () => { if (s.value) await lib.toggleFavorite(s.value.id) }
const fmt = (n: number|undefined) => n ? n.toFixed(0) : '—'

/* 加到歌单对话框 */
const addOpen = ref(false)
const targetPid = ref<number | null>(null)
const addHint = ref('')
async function openAddToPlaylist() {
  if (!s.value) { addHint.value = '先选一首歌再添加'; setTimeout(() => (addHint.value = ''), 2500); return }
  addHint.value = ''
  targetPid.value = null
  addOpen.value = true
}
async function addToPlaylist(pid: number) {
  if (!s.value) return
  try {
    await lib.addToPlaylist(pid, [s.value.id])
    addHint.value = '✅ 已加入歌单'
    addOpen.value = false
    setTimeout(() => (addHint.value = ''), 2200)
  } catch (e: any) {
    addHint.value = '添加失败：' + (e?.message ?? String(e))
    setTimeout(() => (addHint.value = ''), 3000)
  }
}

/* 新建歌单对话框复用 PlaylistDialogs */
const plDlgOpen = ref(false)
const plDlgMode = ref<'new'|'rename'|'delete'>('new')
const plDlgTargetId = ref<number | null>(null)
async function createNewPlaylistFromHere() {
  plDlgMode.value = 'new'
  plDlgTargetId.value = null
  plDlgOpen.value = true
}
</script>

<template>
  <GlassCard radius="lg" class="cover-card">
    <div class="cover">
      <span class="note">🎼</span>
    </div>
    <div class="info">
      <div class="title">{{ s?.title ?? '未在播放' }}</div>
      <div class="artist">{{ s?.artist ?? '—' }}<template v-if="s?.album"> · {{ s.album }}</template></div>
      <div class="meta">
        <span>{{ fmt(s?.bitrate as any) }}kbps</span>
        <span>{{ ((s?.format ?? 'FLAC') as string).toUpperCase() }}</span>
      </div>
      <div v-if="addHint" class="mini-hint">{{ addHint }}</div>
      <div class="row-actions">
        <button class="mini-btn" :class="{active: fav}" @click="toggleFav">{{ fav ? '❤ 已收藏' : '♡ 收藏' }}</button>
        <button class="mini-btn" @click="openAddToPlaylist" :disabled="!s">➕ 加到歌单</button>
        <button class="mini-btn" @click="createNewPlaylistFromHere" :disabled="!s">📋 新建歌单</button>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="addOpen" class="mask" @click.self="addOpen=false">
        <div class="dlg">
          <div class="t">将「{{ s?.title ?? '' }}」加入歌单</div>
          <div class="list">
            <div v-if="!lib.playlists.length" class="empty">还没有歌单</div>
            <div
              v-for="pl in lib.playlists"
              :key="pl.id"
              class="pitem"
              @click="addToPlaylist(pl.id)"
            >
              <span class="pthumb">🎧</span>
              <div class="pinfo">
                <div class="pname">{{ pl.name }}</div>
                <div class="pmeta">{{ (pl as any).songs?.length ?? 0 }} 首</div>
              </div>
              <span class="pact">➕ 加入</span>
            </div>
          </div>
          <div class="row">
            <button class="btn-cancel" @click="addOpen=false">取消</button>
            <button class="btn-ok" @click="createNewPlaylistFromHere(); addOpen=false">📋 新建歌单并加入</button>
          </div>
        </div>
      </div>
    </Teleport>

    <PlaylistDialogs
      v-model:open="plDlgOpen"
      :mode="plDlgMode"
      :playlist-id="plDlgTargetId"
    />
  </GlassCard>
</template>

<style lang="scss" scoped>
.cover-card { padding: 18px; display: flex; flex-direction: column; align-items: center; position: relative; }
.cover { width: 170px; height: 170px; border-radius: 22px; position: relative; overflow: hidden;
  background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2));
  box-shadow: 0 20px 48px rgba(255,126,95,.35), inset 0 0 40px rgba(255,255,255,.08);
  margin-bottom: 16px; display: flex; align-items: center; justify-content: center; }
.cover::before { content:''; position:absolute; inset:0; background: linear-gradient(135deg, rgba(255,255,255,.22), transparent 55%); }
.note { position: relative; font-size: 68px; color: rgba(255,255,255,.95); filter: drop-shadow(0 4px 14px rgba(0,0,0,.2)); }
.info { text-align: center; width: 100%; }
.title { font-size: 18px; font-weight: 700; color: var(--text-1); margin-bottom: 3px; }
.artist { font-size: 12px; color: rgba(255,255,255,.65); }
.meta { display: flex; gap: 16px; justify-content: center; font-size: 11px; color: rgba(255,255,255,.45); margin-top: 6px; }
.mini-hint { margin-top: 10px; padding: 6px 10px; border-radius: 8px; font-size: 11.5px;
  background: rgba(255,255,255,.04); color: #ffb199; border: 1px solid rgba(255,126,95,.2); }
.row-actions { display: flex; gap: 6px; margin-top: 12px; justify-content: center; flex-wrap: wrap; }
.mini-btn { padding: 5px 12px; border-radius: 9px; font-size: 11px; cursor: pointer; color: rgba(255,255,255,.8);
  background: var(--glass-bg-2); border: 1px solid var(--glass-line-2); }
.mini-btn.active { background: rgba(255,126,95,.18); color: #ffb199; border-color: rgba(255,126,95,.3); }
.mini-btn:disabled { opacity: .45; cursor: not-allowed; }

.mask { position: fixed; inset: 0; background: rgba(0,0,0,.55); backdrop-filter: blur(4px); z-index: 55;
  display:flex; align-items:center; justify-content:center; }
.dlg { width: 440px; max-height: 70vh; border-radius: 16px; padding: 18px 18px 14px;
  background: #161620; border: 1px solid rgba(255,255,255,.08); display: flex; flex-direction: column; gap: 12px; }
.dlg .t { font-size: 15px; font-weight: 700; color: #fff; }
.dlg .list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 4px; min-height: 160px; max-height: 45vh; }
.dlg .empty { padding: 30px; text-align: center; color: rgba(255,255,255,.4); font-size: 12px; }
.pitem { display: flex; align-items: center; gap: 10px; padding: 9px; border-radius: 10px; cursor: pointer;
  background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06); transition: background .12s; }
.pitem:hover { background: rgba(255,126,95,.12); border-color: rgba(255,126,95,.25); }
.pthumb { width: 36px; height: 36px; border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 16px;
  background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2)); }
.pinfo { flex: 1; min-width: 0; text-align: left; }
.pname { font-size: 13px; color: #fff; font-weight: 600; }
.pmeta { font-size: 11px; color: rgba(255,255,255,.45); margin-top: 2px; }
.pact { font-size: 11px; color: #ffb199; font-weight: 600; padding: 4px 8px; border-radius: 6px; background: rgba(255,126,95,.1); }
.dlg .row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.btn-cancel { padding: 7px 13px; border-radius: 9px; font-size: 12px; cursor: pointer; color: rgba(255,255,255,.7);
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); }
.btn-ok { padding: 7px 13px; border-radius: 9px; font-size: 12px; font-weight: 600; cursor: pointer; border: 0; color: #fff;
  background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2)); }
</style>
