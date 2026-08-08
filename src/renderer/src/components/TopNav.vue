<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useUiStore } from '@/stores/ui'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
const ui = useUiStore()
const lib = useLibraryStore()
const player = usePlayerStore()
const { activeTab, settingsOpen, searchOpen } = storeToRefs(ui)
const tabs = [
  { id: 'library' as const,   label: '🎵 音乐库' },
  { id: 'playlists' as const, label: '📋 歌单' },
  { id: 'favorites' as const, label: '⭐ 收藏' },
  { id: 'mix' as const,       label: '🎤 混音' }
]
const scanning = ref(false)
const scanHint = ref('')

// —— 窗口状态：最大化 / 最小化 ——
const isMax = ref(false)
let removeWinListeners: (() => void) | null = null
async function refreshMax() {
  try { isMax.value = !!(await window.api.system.isMaximized()) } catch {}
}
function doMin() { try { window.api.system.minimize() } catch (e) { console.error(e) } }
function doClose() { try { window.api.system.hide() } catch (e) { console.error(e) } }
async function doMax() {
  try {
    const r: any = await window.api.system.toggleMaximize()
    if (r && typeof r.maximized === 'boolean') isMax.value = r.maximized
    else await refreshMax()
  } catch (e) { console.error(e) }
}
onMounted(() => {
  refreshMax()
  // 监听窗口最大化事件（由主进程通知），避免按钮状态与实际窗口状态不一致
  const onMax = () => (isMax.value = true)
  const onUnmax = () => (isMax.value = false)
  try {
    const ipcOn = (window as any).api?._onRaw
    // 若没有事件通道则使用轮询兜底
    let pollingTimer: ReturnType<typeof setInterval> | null = null
    let usePoll = true
    if (typeof (window as any).addEventListener === 'function') {
      const onResize = () => { refreshMax() }
      window.addEventListener('resize', onResize)
      removeWinListeners = () => {
        window.removeEventListener('resize', onResize)
        if (pollingTimer) clearInterval(pollingTimer)
      }
      usePoll = false
      pollingTimer = setInterval(refreshMax, 2500) as any
    }
    if (usePoll) pollingTimer = setInterval(refreshMax, 1500) as any
  } catch {}
})
onBeforeUnmount(() => { removeWinListeners?.() })
const maxBtnTitle = computed(() => isMax.value ? '还原' : '最大化')
const maxBtnGlyph = computed(() => isMax.value ? '❐' : '▢')

const pickImport = async () => {
  try {
    const w = window as any
    // 先弹出系统文件对话框让用户选音乐文件夹
    let paths: string[] = []
    if (typeof w.api?.system?.pickLibraryFolders === 'function') {
      paths = await w.api.system.pickLibraryFolders() as string[]
    }
    if (!paths || !paths.length) {
      // 用户取消了对话框，试试已保存的 libraryFolders（已有配置则快速重扫）
      const saved = await w.api?.settings?.get?.('libraryFolders', []) as string[] | undefined
      if (Array.isArray(saved) && saved.length) paths = saved
    }
    if (!paths.length) {
      scanHint.value = '已取消选择'
      setTimeout(() => (scanHint.value = ''), 2200)
      return
    }
    // 记录下来，下次可一键重扫
    try { await w.api?.settings?.set?.('libraryFolders', paths) } catch {}
    scanning.value = true
    scanHint.value = `扫描中…（${paths.length} 个文件夹）`
    const before = lib.songs.length
    const res = await lib.scanFolders(paths) as any
    const inserted = typeof res?.inserted === 'number' ? res.inserted : 0
    // 扫完后把 player 的曲目列表指向新库
    try { player.restoreFromLoaded(lib.songs) } catch {}
    const delta = lib.songs.length - before
    scanHint.value = inserted > 0
      ? `✅ 新增 ${inserted} 首（当前共 ${lib.songs.length} 首）`
      : delta > 0
        ? `✅ 完成（共 ${lib.songs.length} 首）`
        : `扫描完成，共 ${lib.songs.length} 首`
    setTimeout(() => (scanHint.value = ''), 3500)
  } catch (e) {
    console.error(e)
    scanHint.value = '导入失败：' + ((e as any)?.message ?? String(e))
    setTimeout(() => (scanHint.value = ''), 4000)
  } finally { scanning.value = false }
}
</script>

<template>
  <div class="top-nav">
    <div class="drag-bar" style="-webkit-app-region:drag;"></div>
    <div class="row">
      <div class="brand">
        <div class="brand-logo">🎼</div>
        <div class="brand-name">Aurora Music</div>
      </div>
      <div class="tabs">
        <div v-for="t in tabs" :key="t.id"
          class="tab" :class="{ active: activeTab === t.id }"
          style="-webkit-app-region:no-drag;"
          @click="activeTab = t.id">{{ t.label }}</div>
      </div>
      <div class="actions" style="-webkit-app-region:no-drag;">
        <button class="icon-btn" title="搜索" @click="searchOpen = true">🔍</button>
        <button class="primary-btn" :disabled="scanning" :class="{loading: scanning}" @click="pickImport">
          <span v-if="scanning">⟳</span><span v-else>＋</span>
          <span>{{ scanning ? '扫描中…' : '导入音乐' }}</span>
        </button>
        <div v-if="scanHint" class="scan-hint">{{ scanHint }}</div>
        <button class="icon-btn" title="设置" @click="settingsOpen = true">⚙️</button>
        <div class="wc">
          <button class="wc-btn" title="最小化" @click="doMin">—</button>
          <button class="wc-btn" :title="maxBtnTitle" :class="{max: isMax}" @click="doMax">{{ maxBtnGlyph }}</button>
          <button class="wc-btn close" title="关闭到托盘" @click="doClose">✕</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.top-nav { display: grid; grid-template-rows: 28px 1fr; height: 100%; }
.drag-bar { height: 28px; width: 100%; }
.row { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 20px; padding: 0 22px 8px; }
.brand { display: flex; align-items: center; gap: 10px; }
.brand-logo { width: 34px; height: 34px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 17px;
  background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2)); box-shadow: 0 4px 14px rgba(255,126,95,.3); }
.brand-name { font-size: 17px; font-weight: 700; color: var(--text-1); letter-spacing: .5px; }
.tabs { justify-self: center; display: flex; gap: 3px; padding: 3px; border-radius: 12px;
  background: var(--glass-bg); border: 1px solid var(--glass-line); backdrop-filter: blur(20px); }
.tab { padding: 6px 16px; font-size: 13px; color: rgba(255,255,255,.55); border-radius: 9px; cursor: pointer; font-weight: 500; }
.tab:hover { color: rgba(255,255,255,.85); }
.tab.active { background: rgba(255,255,255,.14); color: #fff; }
.actions { display: flex; gap: 8px; justify-self: end; align-items: center; }
.icon-btn { width: 34px; height: 34px; border-radius: 10px; cursor: pointer;
  background: var(--glass-bg); border: 1px solid var(--glass-line); color: rgba(255,255,255,.8); backdrop-filter: blur(20px); font-size: 14px; }
.primary-btn { padding: 0 14px; height: 34px; border: 0; cursor: pointer; font-weight: 600; font-size: 13px;
  border-radius: 10px; color: #fff; display: inline-flex; align-items: center; gap: 6px;
  background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2)); box-shadow: 0 4px 14px rgba(255,126,95,.35); }
.primary-btn:disabled { opacity: .65; cursor: progress; }
.primary-btn.loading span:first-child { animation: spin .9s linear infinite; display:inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }
.scan-hint { font-size: 12px; color: rgba(255,255,255,.75); padding: 4px 10px; border-radius: 8px;
  background: rgba(67, 233, 123, .12); border: 1px solid rgba(67,233,123,.25); }
.wc { display: flex; gap: 2px; margin-left: 6px; }
.wc-btn { width: 30px; height: 30px; border-radius: 7px; border: 0; cursor: pointer; font-size: 13px;
  color: rgba(255,255,255,.6); background: transparent; }
.wc-btn:hover { background: rgba(255,255,255,.08); color: #fff; }
.wc-btn.close:hover { background: #ef4444; color: #fff; }
</style>
