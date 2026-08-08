<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import GlassCard from './GlassCard.vue'
import { fmtTime } from '@/utils/format'
import { usePlayerStore } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import type { Song } from '@/stores/library'

const props = defineProps<{
  songs?: Song[]
  playlistName?: string
  emptyTip?: string
  /** 是否允许拖拽重排（仅歌单内有效，默认根据是否在歌单 Tab 自动判定） */
  allowReorder?: boolean
  /** 是否允许从库中删除（全部音乐/收藏 Tab 有效；歌单 Tab 内是"从歌单移除"，默认 true） */
  allowDelete?: boolean
  /** 当前面板关联的歌单 ID（若有，则"删除"改为"从歌单移除"） */
  playlistId?: number | null
  /** 是否监听滚动定位请求（仅主面板传 true，避免多个面板重复响应） */
  handleLocate?: boolean
}>()

const emit = defineEmits<{
  (e: 'orderChange', ids: number[]): void
  (e: 'removedFromPlaylist', songIds: number[]): void
  (e: 'removedFromLibrary', songIds: number[]): void
}>()

const player = usePlayerStore()
const lib = useLibraryStore()
const ui = useUiStore()

const display = computed(() => props.songs ?? lib.currentList())
const activeId = computed(() => player.currentSong?.id ?? -1)
const total = computed(() => display.value.length)
const totalSec = computed(() => display.value.reduce((a, b) => a + ((b.duration as number) || 0), 0))
const durFmt = (s:number)=>{ const h=Math.floor(s/3600), m=Math.floor(s%3600/60); return (h?`${h}小时 `:'')+`${m}分` }
const icons = ['🎸','🌊','🍋','💛','🍃','🌻','🌙','🔥','🪐','💫','🎷','🎹']
const iconFor = (i:number) => icons[i % icons.length]
const playRow = (s: Song) => {
  const already = player.currentSong?.id === s.id
  if (already) {
    player.playPauseFlip()
    return
  }
  player.playSongs(display.value, s.id)
}
const toggleFav = (e: Event, s: Song) => { e.stopPropagation(); lib.toggleFavorite(s.id) }

// —— 删除/从歌单移除 ——
const inPlaylist = computed(() => props.playlistId != null && Number.isFinite(props.playlistId))
const canReorder = computed(() => props.allowReorder ?? inPlaylist.value)
async function removeRow(e: Event, s: Song, idx: number) {
  e.stopPropagation()
  const title = s.title || `Track ${s.id}`
  if (inPlaylist.value) {
    const ok = confirm(`从歌单移除《${title}》？`)
    if (!ok) return
    await lib.removeFromPlaylist(props.playlistId!, [s.id])
    emit('removedFromPlaylist', [s.id])
  } else {
    const ok = confirm(`从音乐库删除《${title}》？\n（仅删除记录，本地文件不会被删除）`)
    if (!ok) return
    await lib.removeFromLibrary([s.id])
    emit('removedFromLibrary', [s.id])
  }
}

// —— 行拖拽重排（HTML5 Drag & Drop）——
const dragSrcIdx = ref<number | null>(null)
const dragOverIdx = ref<number | null>(null)
const listEl = ref<HTMLElement | null>(null)

function onDragStart(e: DragEvent, idx: number) {
  if (!canReorder.value) { if (e.dataTransfer) e.dataTransfer.effectAllowed = 'none'; return }
  dragSrcIdx.value = idx
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', String(display.value[idx]?.id ?? '')) } catch {}
  }
  // 设置拖拽预览
  try {
    if (e.target instanceof HTMLElement) {
      e.target.classList.add('dragging-src')
    }
  } catch {}
}
function onDragEnd(e: DragEvent) {
  try { if (e.target instanceof HTMLElement) e.target.classList.remove('dragging-src') } catch {}
  dragSrcIdx.value = null; dragOverIdx.value = null
}
function onDragOver(e: DragEvent, idx: number) {
  if (!canReorder.value || dragSrcIdx.value == null) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dragOverIdx.value = idx
}
function onDragLeave(e: DragEvent, idx: number) {
  if (dragOverIdx.value === idx) dragOverIdx.value = null
}
async function onDrop(e: DragEvent, idx: number) {
  e.preventDefault()
  const src = dragSrcIdx.value
  dragSrcIdx.value = null; dragOverIdx.value = null
  if (!canReorder.value || src == null || src === idx) return
  const arr = [...display.value]
  const [moved] = arr.splice(src, 1)
  if (!moved) return
  arr.splice(idx, 0, moved)
  const newOrder = arr.map(s => s.id)
  // 如果是歌单内：调用 reorderPlaylist 持久化；否则：仅在当前列表重排（用于展示/播放顺序）
  if (inPlaylist.value) {
    await lib.reorderPlaylist(props.playlistId!, newOrder)
  } else if (!props.songs) {
    // 全部音乐 / 收藏 Tab：仅把当前顺序应用到播放队列（方便用户"按此顺序播放"）
    player.reorderQueue(newOrder)
  }
  emit('orderChange', newOrder)
}

// —— 滚动定位到当前播放歌曲（底部"定位"按钮 or 启动时都会触发 ui.locateSongRequest 自增）——
const rowRefs = new Map<number, HTMLElement>()
function setRowRef(id: number, el: HTMLElement | null) {
  if (el) rowRefs.set(id, el); else rowRefs.delete(id)
}
const flashId = ref<number | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | null = null
function doLocate(id: number) {
  const el = rowRefs.get(id)
  const listNode = listEl.value
  if (el && listNode) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    flashId.value = id
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => { flashId.value = null }, 1800)
  }
}
let unwatch: (() => void) | null = null
if (props.handleLocate !== false) {
  unwatch = watch(() => ui.locateSongRequest, () => {
    const id = ui.locateSongId
    if (id != null && id > 0) nextTick(() => doLocate(id))
  })
  // 组件 mount 后如果已有 pending 请求也执行一次（应对启动时"定位当前播放"）
  nextTick(() => {
    if (ui.locateSongId != null && ui.locateSongId > 0) doLocate(ui.locateSongId)
  })
}
onBeforeUnmount(() => {
  if (unwatch) unwatch()
  if (flashTimer) clearTimeout(flashTimer)
})
</script>

<template>
  <GlassCard radius="lg" class="pl">
    <div class="head">
      <div class="left">
        <div class="thumb">🎮</div>
        <div>
          <div class="title">{{ playlistName ?? '开黑 BGM 精选' }}</div>
          <div class="meta">{{ total }} 首 · 总时长 {{ durFmt(totalSec) }}</div>
        </div>
      </div>
      <div class="actions">
        <button class="p-btn" title="排序">⇅</button>
        <button class="p-btn" title="复制">⎘</button>
        <button class="p-btn add" title="＋">＋</button>
      </div>
    </div>
    <div class="lhead">
      <div>#</div><div>歌曲</div><div style="text-align:right">时长/操作</div>
    </div>
    <div class="list" ref="listEl">
      <div
        v-for="(s, i) in display"
        :key="s.id"
        class="row"
        :class="{
          active: s.id === activeId,
          playing: s.id === activeId && player.playing,
          'drag-over-top': dragOverIdx === i && dragSrcIdx != null && dragSrcIdx > i,
          'drag-over-bottom': dragOverIdx === i && dragSrcIdx != null && dragSrcIdx < i,
          dragging: dragSrcIdx === i,
          flashed: flashId === s.id
        }"
        :ref="(el) => setRowRef(s.id, el as HTMLElement | null)"
        draggable="true"
        @click="playRow(s)"
        @dragstart="onDragStart($event, i)"
        @dragend="onDragEnd($event)"
        @dragover="onDragOver($event, i)"
        @dragleave="onDragLeave($event, i)"
        @drop="onDrop($event, i)"
      >
        <div class="num" :class="{ 'drag-handle': canReorder }">
          <template v-if="s.id === activeId && player.playing">♪</template>
          <template v-else>{{ (i+1).toString().padStart(2,'0') }}</template>
        </div>
        <div class="main">
          <div class="st">{{ iconFor(s.id + i) }}</div>
          <div class="txt">
            <div class="sn">{{ s.title ?? `Track ${s.id}` }}</div>
            <div class="sa">{{ s.artist ?? '未知艺术家' }}</div>
          </div>
        </div>
        <div class="right-col">
          <span class="fav" :class="{on: s.favorite===1}" @click.stop="toggleFav($event,s)" title="收藏">♡</span>
          <span class="dur">{{ fmtTime(s.duration) }}</span>
          <button class="del-btn"
            :title="inPlaylist ? '从歌单移除' : '从库中删除'"
            @click.stop="removeRow($event, s, i)">
            {{ inPlaylist ? '✕' : '🗑' }}
          </button>
        </div>
      </div>
      <div v-if="!display.length" class="empty">{{ emptyTip ?? '暂无歌曲' }}</div>
    </div>
  </GlassCard>
</template>

<style lang="scss" scoped>
.pl { padding: 16px; display: flex; flex-direction: column; min-height: 0; }
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.left { display: flex; align-items: center; gap: 10px; }
.thumb { width: 36px; height: 36px; border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 15px;
  background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2)); }
.title { font-size: 14px; font-weight: 700; color: var(--text-1); }
.meta { font-size: 11px; color: rgba(255,255,255,.5); margin-top: 2px; }
.actions { display: flex; gap: 5px; }
.p-btn { width: 30px; height: 30px; border-radius: 8px; cursor: pointer; font-size: 12px;
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.06); color: rgba(255,255,255,.7);
  display: flex; align-items: center; justify-content: center; }
.p-btn.add { background: linear-gradient(135deg, rgba(255,126,95,.2), rgba(254,180,123,.2)); color: #ffb199; border-color: rgba(255,126,95,.25); }
.lhead { display: grid; grid-template-columns: 32px 1fr 120px; gap: 10px; padding: 6px 10px; margin-bottom: 4px;
  font-size: 11px; color: rgba(255,255,255,.35); border-bottom: 1px solid rgba(255,255,255,.06); }
.list { flex: 1; overflow-y: auto; margin: 0 -8px; padding: 0 8px; }
.row { display: grid; grid-template-columns: 32px 1fr 120px; gap: 10px; align-items: center;
  padding: 6px 10px; border-radius: 9px; cursor: pointer; position: relative; user-select: none;
  transition: background .12s, transform .12s; }
.row:hover { background: rgba(255,255,255,.05); }
.row.active { background: linear-gradient(90deg, rgba(255,126,95,.18), rgba(254,180,123,.1)); }
.row.playing .num { color: var(--c-accent-2); }
.row.flashed { background: linear-gradient(90deg, rgba(255,126,95,.35), rgba(254,180,123,.28)); }
.row.dragging { opacity: .5; }
.row.drag-over-top::before, .row.drag-over-bottom::after {
  content: ''; position: absolute; left: 8px; right: 8px; height: 2px; border-radius: 2px;
  background: linear-gradient(90deg, var(--c-accent-1), var(--c-accent-2));
  box-shadow: 0 0 10px rgba(255,126,95,.5); z-index: 2; pointer-events: none;
}
.row.drag-over-top::before { top: -1px; }
.row.drag-over-bottom::after { bottom: -1px; }
.num { font-size: 12px; color: rgba(255,255,255,.4); text-align: center; font-variant-numeric: tabular-nums; transition: transform .2s; }
.num.drag-handle { cursor: grab; }
.num.drag-handle:hover { color: var(--c-accent-1); transform: scale(1.08); }
.row.active .num { color: var(--c-accent-1); font-weight: 700; }
.main { display: flex; align-items: center; gap: 9px; min-width: 0; }
.st { width: 34px; height: 34px; border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 14px;
  background: linear-gradient(135deg, rgba(255,255,255,.15), rgba(255,255,255,.04)); }
.row.active .st { background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2)); box-shadow: 0 4px 12px rgba(255,126,95,.35); }
.txt { min-width: 0; }
.sn { font-size: 13px; color: rgba(255,255,255,.9); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row.active .sn { color: #fff; font-weight: 600; }
.sa { font-size: 11px; color: rgba(255,255,255,.45); margin-top: 1px; }
.right-col { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.fav { color: rgba(255,255,255,.35); font-size: 14px; cursor: pointer; }
.fav:hover { color: rgba(255,255,255,.85); }
.fav.on { color: #ef4444; }
.dur { font-size: 11px; text-align: right; color: rgba(255,255,255,.45); font-variant-numeric: tabular-nums; }
.row.active .dur { color: #ffb199; }
.del-btn {
  width: 26px; height: 26px; border-radius: 7px; border: 1px solid transparent; background: transparent;
  color: rgba(255,255,255,.28); font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.del-btn:hover { color: #fff; background: rgba(239,68,68,.12); border-color: rgba(239,68,68,.25); }
.row:not(:hover) .del-btn { opacity: .55; }
.empty { padding: 40px; text-align: center; font-size: 13px; color: rgba(255,255,255,.4); }
</style>
