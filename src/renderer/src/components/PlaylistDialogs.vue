<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useLibraryStore } from '@/stores/library'
const props = defineProps<{ open: boolean; mode: 'new'|'rename'|'delete'; playlistId: number | null }>()
const emit = defineEmits<{ 'update:open':[v:boolean] }>()
const lib = useLibraryStore()
const name = ref(''), desc = ref('')
const target = computed(() => props.playlistId != null ? lib.playlists.find(p => p.id===props.playlistId) : null)
watch(() => props.open, (v) => {
  if (v && (props.mode==='rename' || props.mode==='delete') && target.value) {
    name.value = target.value.name ?? ''; desc.value = (target.value as any).description ?? ''
  }
  if (v && props.mode==='new') { name.value=''; desc.value='' }
})
async function submit() {
  if (props.mode==='new') { if (name.value.trim()) await lib.createPlaylist(name.value.trim(), desc.value.trim()) }
  if (props.mode==='rename' && props.playlistId) { await lib.updatePlaylist(props.playlistId, { name: name.value.trim(), description: desc.value.trim() }) }
  if (props.mode==='delete' && props.playlistId) { await lib.deletePlaylist(props.playlistId) }
  emit('update:open', false)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="mask" @click.self="emit('update:open', false)">
      <div class="dlg">
        <div class="t">{{ mode==='new' ? '新建歌单' : mode==='rename' ? '重命名歌单' : '删除歌单？' }}</div>
        <div v-if="mode!=='delete'" class="field"><label>名称</label><input v-model="name" class="input" maxlength="48" /></div>
        <div v-if="mode!=='delete'" class="field"><label>描述（可选）</label><input v-model="desc" class="input" maxlength="120" /></div>
        <div v-if="mode==='delete'" class="warn">此操作会删除歌单「{{ target?.name ?? '' }}」（不会从磁盘删除音乐文件）</div>
        <div class="row">
          <button class="btn-cancel" @click="emit('update:open', false)">取消</button>
          <button class="btn-ok" @click="submit">{{ mode==='delete' ? '确认删除' : '确认' }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style lang="scss" scoped>
.mask { position: fixed; inset: 0; background: rgba(0,0,0,.6); backdrop-filter: blur(4px); z-index: 50; display:flex; align-items:center; justify-content:center; }
.dlg { width: 420px; border-radius: 16px; padding: 22px; background: #161620; border: 1px solid rgba(255,255,255,.08); }
.t { font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 16px; }
.field { margin-bottom: 12px; display: grid; gap: 5px; }
label { font-size: 12px; color: rgba(255,255,255,.5); }
.input { width: 100%; height: 36px; border-radius: 9px; padding: 0 12px; font-size: 13px; color: #fff; outline: none;
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); }
.input:focus { border-color: rgba(255,126,95,.5); }
.warn { padding: 11px; border-radius: 9px; font-size: 12px; color: #fca5a5; background: rgba(239,68,68,.08); border: 1px solid rgba(239,68,68,.18); margin-bottom: 12px; }
.row { display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px; }
.btn-cancel { padding: 7px 15px; border-radius: 9px; font-size: 13px; cursor: pointer; color: rgba(255,255,255,.7);
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); }
.btn-ok { padding: 7px 15px; border-radius: 9px; font-size: 13px; font-weight: 600; cursor: pointer; border: 0; color: #fff;
  background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2)); }
</style>
