<script setup lang="ts">
import { computed } from 'vue'
import { useLibraryStore } from '@/stores/library'
import PlaylistPanel from './PlaylistPanel.vue'
const lib = useLibraryStore()
// 通过 lib.currentList() 取——当 activeTab='favorites' 时，currentList() 会过滤 fav===1，
// 且与右侧♡、CoverCard♡实时同步（不会只在onMounted加载一次后就不更新）
const favs = computed(() => lib.currentList())
const count = computed(() => favs.value.length)
</script>
<template>
  <div class="tf">
    <div class="head">
      <div>
        <div class="t">⭐ 我的收藏</div>
        <div class="sub">共 {{ count }} 首 · 点击 ♡ 即可收藏或取消</div>
      </div>
    </div>
    <PlaylistPanel
      :songs="favs"
      playlist-name="我的收藏"
      empty-tip="还没有收藏的歌曲，点列表右列的 ♡ 收藏喜欢的歌"
      :playlist-id="null"
      :allow-reorder="false"
      :allow-delete="true"
      :handle-locate="true"
    />
  </div>
</template>
<style lang="scss" scoped>
.tf { display: flex; flex-direction: column; min-height: 0; gap: 10px; }
.head { padding: 2px 4px 0; }
.t { font-size: 16px; font-weight: 700; color: #fff; }
.sub { font-size: 11.5px; color: rgba(255,255,255,.45); margin-top: 2px; }
</style>
