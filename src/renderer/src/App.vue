<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import TopNav from './components/TopNav.vue'
import CoverCard from './components/CoverCard.vue'
import MixPanel from './components/MixPanel.vue'
import TabsLibrary from './components/TabsLibrary.vue'
import TabsPlaylists from './components/TabsPlaylists.vue'
import TabsFavorites from './components/TabsFavorites.vue'
import TabsMix from './components/TabsMix.vue'
import BottomPlayer from './components/BottomPlayer.vue'
import SearchBox from './components/SearchBox.vue'
import QueueModal from './components/QueueModal.vue'
import SettingsDrawer from './components/SettingsDrawer.vue'
import DeviceGuide from './components/DeviceGuide.vue'
import { useLibraryStore } from './stores/library'
import { usePlayerStore } from './stores/player'
import { useUiStore } from './stores/ui'
import { useAudioStore } from './stores/audio'

const lib = useLibraryStore()
const player = usePlayerStore()
const ui = useUiStore()
const audio = useAudioStore()

const { activeTab, queueOpen, settingsOpen } = storeToRefs(ui)
const showGuide = ref(false)

onMounted(async () => {
  try { await ui.initUiFromSettings() } catch {}
  try { await player.restoreFromSettings() } catch {}
  try {
    await lib.loadAll()
    player.restoreFromLoaded(lib.songs)
    // 打开软件自动跳转到当前播放歌曲（如果有）
    try {
      if (player.currentSong) {
        // 给 PlaylistPanel 一点 mount 时间（v-if activeTab）
        setTimeout(() => ui.navigateToCurrentSong().catch(() => {}), 350)
      }
    } catch {}
  } catch {}
  try {
    // 仅做后台检测，**不再自动弹窗**（新用户首次打开不应立刻被"安装包提示"拦住）
    // 需要安装时，点击左侧 MixPanel 顶部的 ⚠️ 警告条、或设置页即可打开向导
    await audio.checkInstall()
    audio.startSubs()
  } catch {}
})
</script>

<template>
  <div class="app-root">
    <div class="aurora-bg">
      <div class="glow glow-left"></div>
      <div class="glow glow-right"></div>
    </div>
    <div class="app-inner">
      <div class="a-wrap"><TopNav /></div>
      <div class="b-wrap">
        <div class="b-left">
          <CoverCard />
          <MixPanel @open-guide="showGuide = true" />
        </div>
        <div class="b-right">
          <TabsLibrary   v-if="activeTab==='library'" />
          <TabsPlaylists v-else-if="activeTab==='playlists'" />
          <TabsFavorites v-else-if="activeTab==='favorites'" />
          <TabsMix       v-else />
        </div>
      </div>
      <div class="c-wrap"><BottomPlayer /></div>
    </div>
    <SearchBox />
    <QueueModal v-model:open="queueOpen" />
    <SettingsDrawer v-model:open="settingsOpen" />
    <DeviceGuide v-model:open="showGuide" />
  </div>
</template>

<style lang="scss" scoped>
.app-root { position: relative; width: 100vw; height: 100vh; overflow: hidden; color: #e5e7eb; }
.aurora-bg { position: absolute; inset: 0; background: #0a0a0f; overflow: hidden; }
.glow { position: absolute; border-radius: 50%; filter: blur(80px); opacity: .35; pointer-events: none; }
.glow-left  { width: 50%; height: 80%; top:-20%; left:-15%; background: radial-gradient(circle, #ff7e5f, transparent 60%); }
.glow-right { width: 45%; height: 70%; bottom:-15%; right:-10%; background: radial-gradient(circle, #feb47b, transparent 60%); opacity: .28; }
.app-inner { position: relative; z-index: 1; display: grid; grid-template-rows: 72px 1fr 88px; height: 100vh; gap: 0; }
.a-wrap { padding: 0; }
.b-wrap { display: grid; grid-template-columns: minmax(340px, 1fr) minmax(380px, 1.2fr); gap: 12px; padding: 4px 16px; min-height: 0; }
.b-left { display: flex; flex-direction: column; gap: 12px; min-height: 0; padding: 4px; }
.b-right { min-height: 0; padding: 4px; display: flex; }
.b-right > * { flex: 1; min-width: 0; }
.c-wrap { padding: 0 16px 12px 16px; }
</style>
