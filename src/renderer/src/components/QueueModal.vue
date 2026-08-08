<script setup lang="ts">
import { computed } from 'vue'
import GlassCard from './GlassCard.vue'
import { usePlayerStore } from '@/stores/player'
import { fmtTime } from '@/utils/format'
import { storeToRefs } from 'pinia'
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open':[v:boolean] }>()
const player = usePlayerStore()
const { queue, queueIndex } = storeToRefs(player)
const icons = ['🎸','🌊','🍋','💛','🍃','🌻','🌙','🔥','🪐','💫','🎷','🎹']
const rows = computed(() => queue.value.map((s, i) => ({ ...s, _i: i, _icon: icons[(s.id + i) % icons.length] })))
const playAt = (i:number) => player.playIndex(i)
const removeAt = (i:number) => player.removeFromQueue(i)
const clear = () => { while (queue.value.length) player.removeFromQueue(0) }
const total = computed(() => queue.value.length)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="mask" @click.self="emit('update:open', false)">
      <GlassCard radius="lg" class="modal">
        <div class="head">
          <div class="t">📻 播放队列 · {{ total }} 首</div>
          <div class="a">
            <button class="mini" @click="clear">清空</button>
            <button class="mini" @click="emit('update:open', false)">✕</button>
          </div>
        </div>
        <div class="lhead">
          <div style="width:36px">#</div><div>歌曲</div><div style="width:80px; text-align:right">时长</div><div style="width:32px"></div>
        </div>
        <div class="list">
          <div v-for="r in rows" :key="r.id" class="row" :class="{active: r._i === queueIndex}" @dblclick="playAt(r._i)">
            <div class="num">{{ (r._i+1).toString().padStart(2,'0') }}</div>
            <div class="main">
              <div class="st">{{ r._icon }}</div>
              <div class="txt">
                <div class="sn">{{ r.title }}</div>
                <div class="sa">{{ r.artist }}</div>
              </div>
            </div>
            <div class="dur">{{ fmtTime(r.duration) }}</div>
            <div class="rm" @click.stop="removeAt(r._i)">✕</div>
          </div>
          <div v-if="!rows.length" class="empty">队列为空：双击歌曲列表任意一首加入播放</div>
        </div>
      </GlassCard>
    </div>
  </Teleport>
</template>

<style lang="scss" scoped>
.mask { position: fixed; inset: 0; background: rgba(0,0,0,.55); backdrop-filter: blur(4px); z-index: 45;
  display:flex; align-items:center; justify-content:center; padding: 40px 20px; }
.modal { width: min(520px, 100%); max-height: 80vh; display: flex; flex-direction: column; padding: 16px; background: rgba(20,20,28,.92); }
.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.t { font-size: 15px; font-weight: 700; color: #fff; }
.a { display: flex; gap: 6px; }
.mini { padding: 4px 10px; border-radius: 7px; cursor: pointer; font-size: 12px;
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); color: rgba(255,255,255,.75); }
.mini:hover { background: rgba(255,255,255,.1); color: #fff; }
.lhead { display: grid; grid-template-columns: 36px 1fr 80px 32px; gap: 8px; padding: 6px 8px;
  font-size: 11px; color: rgba(255,255,255,.35); border-bottom: 1px solid rgba(255,255,255,.06); }
.list { overflow-y: auto; padding: 4px 0; margin: 0 -6px; }
.row { display: grid; grid-template-columns: 36px 1fr 80px 32px; gap: 8px; align-items: center;
  padding: 6px 8px; border-radius: 9px; cursor: pointer; }
.row:hover { background: rgba(255,255,255,.05); }
.row.active { background: linear-gradient(90deg, rgba(255,126,95,.18), rgba(254,180,123,.1)); }
.num { text-align: center; font-size: 12px; color: rgba(255,255,255,.4); }
.row.active .num { color: var(--c-accent-1); font-weight: 700; }
.main { display: flex; align-items: center; gap: 8px; min-width: 0; }
.st { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 13px;
  background: linear-gradient(135deg, rgba(255,255,255,.15), rgba(255,255,255,.04)); }
.row.active .st { background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2)); }
.txt { min-width: 0; }
.sn { font-size: 13px; color: rgba(255,255,255,.9); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row.active .sn { color: #fff; font-weight: 600; }
.sa { font-size: 11px; color: rgba(255,255,255,.45); }
.dur { font-size: 11px; text-align: right; color: rgba(255,255,255,.45); }
.row.active .dur { color: #ffb199; }
.rm { text-align: center; color: rgba(255,255,255,.35); font-size: 13px; }
.rm:hover { color: #ef4444; }
.empty { padding: 32px; text-align: center; color: rgba(255,255,255,.4); font-size: 13px; }
</style>
