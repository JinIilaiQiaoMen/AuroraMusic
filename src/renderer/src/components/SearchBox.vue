<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
const ui = useUiStore(); const lib = useLibraryStore(); const player = usePlayerStore()
const { searchOpen, searchKeyword } = storeToRefs(ui)
const results = ref<any[]>([])
let t: any = null
watch(searchKeyword, (v) => {
  clearTimeout(t)
  t = setTimeout(async () => {
    results.value = v.trim().length ? await lib.doSearch(v) : []
  }, 120)
})
const playNow = async (s: any) => {
  (player as any).playSongs?.(results.value, s.id)
  ui.searchOpen = false
}
</script>
<template>
  <Teleport to="body">
    <div v-if="searchOpen" class="mask" @click.self="ui.searchOpen=false">
      <div class="box">
        <input v-model="searchKeyword" autofocus class="kw" placeholder="🔍 搜索歌曲、歌手、专辑..." />
        <div class="list">
          <div v-for="s in results.slice(0,50)" :key="s.id" class="item" @click="playNow(s)">
            <div class="t">{{ s.title }}</div>
            <div class="sub">{{ s.artist }} · {{ s.album || '未知专辑' }}</div>
          </div>
          <div v-if="searchKeyword && !results.length" class="empty">未找到匹配结果</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
<style lang="scss" scoped>
.mask { position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 40; padding-top: 80px; display:flex; justify-content: center; }
.box { width: 560px; max-height: 70vh; border-radius: 16px; background: #15151e; border: 1px solid rgba(255,255,255,.08); overflow: hidden; display: flex; flex-direction: column; }
.kw { width: 100%; height: 54px; padding: 0 18px; font-size: 15px; color: #fff; border: 0; outline: 0;
  background: rgba(255,255,255,.04); border-bottom: 1px solid rgba(255,255,255,.06); }
.list { overflow-y: auto; flex: 1; padding: 6px; }
.item { padding: 9px 12px; border-radius: 9px; cursor: pointer; }
.item:hover { background: rgba(255,255,255,.05); }
.t { font-size: 13px; color: #fff; }
.sub { font-size: 11px; color: rgba(255,255,255,.5); margin-top: 2px; }
.empty { padding: 24px; text-align: center; font-size: 13px; color: rgba(255,255,255,.4); }
</style>
