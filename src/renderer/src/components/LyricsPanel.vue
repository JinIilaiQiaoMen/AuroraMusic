<script setup lang="ts">
import { ref, watch, computed, onMounted, nextTick } from 'vue'
import { usePlayerStore } from '@/stores/player'

const player = usePlayerStore()

interface LrcLine { time: number; text: string }

const lyrics = ref<LrcLine[]>([])
const loading = ref(false)
const activeIndex = ref(-1)
const panelOpen = ref(false)
const lrcListRef = ref<HTMLElement | null>(null)

// 当前歌曲变化时加载歌词
watch(() => player.currentSong?.id, async (songId) => {
  if (!songId) { lyrics.value = []; return }
  loading.value = true
  try {
    const result = await (window as any).api.library.getLyrics(songId)
    if (result && result.lines && result.lines.length > 0) {
      lyrics.value = result.lines
      activeIndex.value = -1
    } else {
      lyrics.value = []
      activeIndex.value = -1
    }
  } catch {
    lyrics.value = []
  } finally {
    loading.value = false
  }
}, { immediate: true })

// 播放进度变化时高亮当前歌词行
watch(() => player.progress, (pos) => {
  if (!lyrics.value.length) return
  // 找到当前时间对应的歌词行
  let idx = -1
  for (let i = 0; i < lyrics.value.length; i++) {
    if (lyrics.value[i].time <= pos) idx = i
    else break
  }
  if (idx !== activeIndex.value) {
    activeIndex.value = idx
    scrollToActive()
  }
})

// 点击歌词行跳转
function clickLine(line: LrcLine) {
  if (line.time >= 0) {
    player.progress = line.time
    // 通过 BottomPlayer 的 seek 机制同步
    // player store 的 progress 变化会触发引擎/HTML5 seek
  }
}

function scrollToActive() {
  nextTick(() => {
    if (!lrcListRef.value) return
    const el = lrcListRef.value.querySelector('.lrc-line.active') as HTMLElement
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })
}

function togglePanel() {
  panelOpen.value = !panelOpen.value
}

const hasLyrics = computed(() => lyrics.value.length > 0)
</script>

<template>
  <div class="lyrics-container">
    <button class="lrc-toggle" :class="{ on: panelOpen, has: hasLyrics }" @click="togglePanel" title="歌词">
      🎵
    </button>
    <transition name="slide">
      <div v-if="panelOpen" class="lrc-panel">
        <div v-if="loading" class="lrc-empty">加载歌词中...</div>
        <div v-else-if="!hasLyrics" class="lrc-empty">
          <span>暂无歌词</span>
          <span class="lrc-hint">将 .lrc 文件放在歌曲同名目录下，重新扫描即可</span>
        </div>
        <div v-else ref="lrcListRef" class="lrc-list">
          <div
            v-for="(line, i) in lyrics"
            :key="i"
            class="lrc-line"
            :class="{ active: i === activeIndex, past: i < activeIndex }"
            @click="clickLine(line)"
          >{{ line.text || '♪' }}</div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style lang="scss" scoped>
.lyrics-container { position: relative; }

.lrc-toggle {
  width: 34px; height: 34px; border-radius: 9px; border: 1px solid rgba(255,255,255,.08);
  background: rgba(255,255,255,.05); color: rgba(255,255,255,.75); font-size: 15px; cursor: pointer;
  transition: all .2s;
}
.lrc-toggle:hover { color: #fff; }
.lrc-toggle.on {
  color: var(--c-accent-1);
  border-color: rgba(255,126,95,.3);
  background: linear-gradient(135deg, rgba(255,126,95,.12), rgba(254,180,123,.08));
}
.lrc-toggle.has::after {
  content: ''; position: absolute; top: 2px; right: 2px;
  width: 6px; height: 6px; border-radius: 50%; background: #22c55e;
  box-shadow: 0 0 6px rgba(34,197,94,.8);
}

.lrc-panel {
  position: absolute; bottom: calc(100% + 8px); right: 0;
  width: 360px; max-height: 420px;
  background: rgba(15,15,22,.88); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255,255,255,.08); border-radius: 16px;
  box-shadow: 0 12px 40px rgba(0,0,0,.5);
  overflow: hidden; z-index: 50;
}

.lrc-empty {
  padding: 32px 20px; text-align: center; color: rgba(255,255,255,.4); font-size: 13px;
  display: flex; flex-direction: column; gap: 8px; align-items: center;
}
.lrc-hint { font-size: 11px; color: rgba(255,255,255,.25); max-width: 260px; }

.lrc-list {
  max-height: 420px; overflow-y: auto; padding: 16px 20px;
  scroll-behavior: smooth;
}
.lrc-list::-webkit-scrollbar { width: 4px; }
.lrc-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 2px; }

.lrc-line {
  font-size: 13px; line-height: 1.8; color: rgba(255,255,255,.3);
  cursor: pointer; padding: 4px 8px; border-radius: 6px;
  transition: all .25s ease;
  text-align: center;
}
.lrc-line:hover { color: rgba(255,255,255,.6); background: rgba(255,255,255,.04); }
.lrc-line.active {
  color: #fff; font-size: 14px; font-weight: 600;
  background: linear-gradient(135deg, rgba(255,126,95,.1), rgba(254,180,123,.06));
  transform: scale(1.02);
}
.lrc-line.past { color: rgba(255,255,255,.2); }

.slide-enter-active, .slide-leave-active { transition: all .25s ease; }
.slide-enter-from, .slide-leave-to { opacity: 0; transform: translateY(10px); }

@media (max-width: 900px) {
  .lrc-panel { width: calc(100vw - 32px); right: -8px; }
}
</style>
