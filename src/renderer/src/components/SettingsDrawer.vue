<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useUiStore, THEMES } from '@/stores/ui'
import { useLibraryStore } from '@/stores/library'
import { useAudioStore } from '@/stores/audio'

const props = defineProps<{ open?: boolean }>()
const emit = defineEmits<{ 'update:open':[v:boolean] }>()
const ui = useUiStore()
const { theme } = storeToRefs(ui)
const lib = useLibraryStore()
const audio = useAudioStore()

const tab = ref<'general'|'library'|'hotkeys'|'audio'|'mixer'|'about'>('general')

// ═══ 通用/主题 ═══
const startOnBoot = ref(false)
const closeToTray = ref(true)
const defaultMode = ref<'random'|'order'|'list'|'one'>('random')
const defaultVolume = ref(0.65)
async function loadGeneral() {
  startOnBoot.value = !!await window.api.settings.get<boolean>('startOnBoot', false)
  closeToTray.value = !!await window.api.settings.get<boolean>('closeToTray', true)
  defaultMode.value = (await window.api.settings.get<string>('defaultPlayMode', 'random') as any) ?? 'random'
  defaultVolume.value = Number(await window.api.settings.get<number>('defaultVolume', 0.65)) ?? 0.65
}
function saveGeneral() {
  window.api.settings.set('startOnBoot', startOnBoot.value).catch(()=>{})
  window.api.settings.set('closeToTray', closeToTray.value).catch(()=>{})
  window.api.settings.set('defaultPlayMode', defaultMode.value).catch(()=>{})
  window.api.settings.set('defaultVolume', defaultVolume.value).catch(()=>{})
  flashSaved('已保存')
}

// ═══ 音乐库 ═══
const folders = ref<string[]>([])
const scanning = ref(false)
const scanMsg = ref('')
async function loadFolders() {
  folders.value = await window.api.settings.get<string[]>('libraryFolders', []) ?? []
}
async function pickFolder() {
  const picked = await window.api.system.pickLibraryFolders()
  if (picked?.length) {
    for (const p of picked) if (!folders.value.includes(p)) folders.value.push(p)
    await window.api.settings.set('libraryFolders', folders.value)
    await rescan()
  }
}
function removeFolder(p: string) {
  folders.value = folders.value.filter(x => x !== p)
  window.api.settings.set('libraryFolders', folders.value).catch(()=>{})
}
async function rescan() {
  scanning.value = true; scanMsg.value = '扫描中...'
  try {
    const n = await lib.scanFolders(folders.value)
    scanMsg.value = `扫描完成 · 新增/更新 ${n} 首歌曲`
  } finally {
    scanning.value = false
    setTimeout(()=>scanMsg.value='', 3000)
  }
}

// ═══ 快捷键 ═══
const HOTKEY_LABELS: Record<string, string> = {
  playPause: '播放 / 暂停',
  prev: '上一首',
  next: '下一首',
  volUp: '音量 +10%',
  volDown: '音量 -10%',
  toggleMix: '混音开关',
  presetGaming: '切换到 开黑模式 (Ctrl+Alt+1)',
  presetListening: '切换到 听歌模式 (Ctrl+Alt+2)',
  presetStreamer: '切换到 主播模式 (Ctrl+Alt+3)',
  presetWatching: '切换到 观影模式 (Ctrl+Alt+4)',
  presetMeeting: '切换到 会议模式 (Ctrl+Alt+5)',
  toggleFav: '收藏 / 取消收藏',
  toggleWindow: '显示 / 隐藏窗口',
  emergencyStop: '紧急停止混音 (Ctrl+Alt+Shift+S)'
}
const hotkeys = ref<Record<string, string>>({})
const recording = ref<string | null>(null)
const recordBuf = ref<string>('')
async function loadHotkeys() {
  hotkeys.value = await window.api.system.getHotkeys() as any
}
function startRecord(action: string) {
  recording.value = action
  recordBuf.value = ''
  window.addEventListener('keydown', onRecKey)
}
function onRecKey(e: KeyboardEvent) {
  if (!recording.value) return
  e.preventDefault()
  if (e.key === 'Escape') { cancelRecord(); return }
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey)  parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey)  parts.push('CmdOrCtrl')
  let k = e.key
  if (k === ' ' ) k = 'Space'
  else if (k === 'ArrowLeft') k = 'Left'
  else if (k === 'ArrowRight') k = 'Right'
  else if (k === 'ArrowUp') k = 'Up'
  else if (k === 'ArrowDown') k = 'Down'
  else if (k.length === 1) k = k.toUpperCase()
  if (['Control','Alt','Shift','Meta'].includes(k)) return
  const acc = [...parts, k].join('+')
  recordBuf.value = acc
  setTimeout(async () => {
    if (recording.value) {
      const action = recording.value
      recording.value = null
      window.removeEventListener('keydown', onRecKey)
      hotkeys.value[action] = recordBuf.value
      await window.api.system.setHotkey(action, recordBuf.value)
    }
  }, 180)
}
function cancelRecord() {
  recording.value = null
  recordBuf.value = ''
  window.removeEventListener('keydown', onRecKey)
}
async function resetHotkey(action: string) {
  await window.api.system.setHotkey(action, null)
  hotkeys.value = await window.api.system.getHotkeys() as any
}

// ═══ 音频设备（基础）═══
const micDevs = ref<MediaDeviceInfo[]>([])
const spkDevs = ref<MediaDeviceInfo[]>([])
const inDevId = ref<string>('')
const outDevId = ref<string>('')
const denoiseOn = ref(true)
const latencyMs = ref(20)
const warnM3 = ref('基础输入输出设备（浏览器 Web Audio API 采样）')
async function loadAudioDevs() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach(t => t.stop())
  } catch {}
  try {
    const list = await navigator.mediaDevices.enumerateDevices()
    micDevs.value = list.filter(d => d.kind === 'audioinput')
    spkDevs.value = list.filter(d => d.kind === 'audiooutput')
  } catch {}
  inDevId.value  = await window.api.settings.get<string>('audio.inDeviceId',  '') ?? ''
  outDevId.value = await window.api.settings.get<string>('audio.outDeviceId', '') ?? ''
  denoiseOn.value  = !!await window.api.settings.get<boolean>('audio.denoise', true)
  latencyMs.value  = Number(await window.api.settings.get<number>('audio.latencyMs', 20)) ?? 20
}
function saveAudio() {
  window.api.settings.set('audio.inDeviceId', inDevId.value).catch(()=>{})
  window.api.settings.set('audio.outDeviceId', outDevId.value).catch(()=>{})
  window.api.settings.set('audio.denoise', denoiseOn.value).catch(()=>{})
  window.api.settings.set('audio.latencyMs', latencyMs.value).catch(()=>{})
  flashSaved('已保存 · 基础音频设置')
}

// ═══ 混音设置（M3 高级）═══
const playbackDevs = ref<any[]>([])
const recordingDevs = ref<any[]>([])
const vDevId = ref<number>(-1)
const mDevId = ref<number>(-1)
const sr = ref<44100 | 48000 | 96000>(48000)
const agcOn = ref(false)
const ecOn = ref(false)
const mixerTip = ref('')
async function loadMixer() {
  vDevId.value = audio.state.virtualDeviceId ?? -1
  mDevId.value = audio.state.micDeviceId ?? -1
  sr.value = audio.state.sampleRate || 48000
  agcOn.value = !!audio.state.agc
  ecOn.value = !!audio.state.echoCancel
  try {
    const snap = await audio.listDevices()
    if (snap) {
      playbackDevs.value = snap.playback || []
      recordingDevs.value = snap.recording || []
      if (vDevId.value < 0 && snap.virtualInputId >= 0) vDevId.value = snap.virtualInputId
      if (mDevId.value < 0 && snap.micDefaultId >= 0) mDevId.value = snap.micDefaultId
    }
  } catch {}
  if (!playbackDevs.value.length) {
    playbackDevs.value = [
      { id: -1, name: '系统默认播放设备', isVirtual: false },
      { id: 999, name: '[VB-CABLE] CABLE Input (虚拟)', isVirtual: true },
      { id: 998, name: '[Aurora] Virtual Mic Output (虚拟)', isVirtual: true }
    ]
  }
  if (!recordingDevs.value.length) {
    recordingDevs.value = [
      { id: -1, name: '系统默认麦克风', isVirtual: false },
      { id: 901, name: '头戴式耳机麦克风', isVirtual: false },
      { id: 902, name: 'USB 麦克风', isVirtual: false }
    ]
  }
}
function isVirtual(name: string) {
  const n = (name || '').toLowerCase()
  return n.includes('cable') || n.includes('virtual') || n.includes('虚拟') || n.includes('vb-')
}
function saveMixer() {
  audio.applyPatch({
    virtualDeviceId: vDevId.value,
    micDeviceId: mDevId.value,
    sampleRate: sr.value,
    agc: agcOn.value,
    echoCancel: ecOn.value
  })
  flashSaved('✅ 混音设置已应用')
}
async function recheckVirtual() {
  mixerTip.value = '正在重新检测虚拟设备...'
  const r = await audio.checkInstall()
  await loadMixer()
  if (r.installed) {
    mixerTip.value = `✅ 检测成功：${r.virtualDeviceName}`
    if (!vDevId.value) vDevId.value = r.virtualDeviceId
  } else {
    mixerTip.value = '⚠️ 未检测到虚拟麦克风，请先安装驱动'
  }
  setTimeout(() => mixerTip.value = '', 3500)
}
function testMic() {
  mixerTip.value = '🎤 测试麦克风...（M3 引擎接入后生效，当前为占位）'
  setTimeout(() => mixerTip.value = '', 2200)
}

// ═══ 关于 ═══
const appV = '0.3.0 (M3)'
const techs = ['Electron 28', 'Vue 3 + TS', 'Pinia', 'better-sqlite3', 'BASS Audio', 'VB-CABLE', 'RNNoise AI']

// ═══ 辅助 ═══
const saveTip = ref('')
let tipT: any = null
function flashSaved(msg: string) {
  saveTip.value = msg
  clearTimeout(tipT)
  tipT = setTimeout(() => saveTip.value = '', 1800)
}
onMounted(async () => {
  await Promise.all([loadGeneral(), loadFolders(), loadHotkeys(), loadAudioDevs(), loadMixer()])
})
</script>

<template>
  <Teleport to="body">
    <Transition name="dr">
      <div v-if="open" class="mask" @click.self="emit('update:open', false)">
        <div class="drawer">
          <div class="hd">
            <div class="t">⚙️ 设置</div>
            <button class="x" @click="emit('update:open', false)">✕</button>
          </div>
          <div class="body">
            <div class="side">
              <div v-for="(it, id) in [
                {id:'general', label:'🎨 通用 / 主题'},
                {id:'library', label:'🎵 音乐库'},
                {id:'hotkeys', label:'⌨️ 快捷键'},
                {id:'audio', label:'🎙️ 音频设备'},
                {id:'mixer', label:'🔊 混音设置'},
                {id:'about', label:'ℹ️ 关于'}
              ] as const" :key="id" class="sitem" :class="{active: tab===it.id}" @click="tab=it.id">{{ it.label }}</div>
            </div>
            <div class="cnt">
              <!-- ═══════════════ General / Theme ═══════════════ -->
              <div v-if="tab==='general'" class="pane">
                <h3 class="h">主题风格</h3>
                <div class="themes">
                  <div v-for="t in THEMES" :key="t.id" class="theme-card" :class="{active: theme===t.id}"
                    @click="ui.applyTheme(t.id)">
                    <div class="thumb" :style="{background: `linear-gradient(135deg, ${t.c1}, ${t.c2})`}"></div>
                    <div class="lbl">{{ t.name }}</div>
                  </div>
                </div>
                <h3 class="h">默认播放</h3>
                <div class="row">
                  <label class="lbl-col">播放模式
                    <select v-model="defaultMode" class="sel">
                      <option value="order">顺序播放</option>
                      <option value="list">列表循环</option>
                      <option value="one">单曲循环</option>
                      <option value="random">随机播放</option>
                    </select>
                  </label>
                  <label class="lbl-col">默认音量
                    <input type="range" min="0" max="1" step="0.01" v-model.number="defaultVolume" />
                    <span class="v">{{ Math.round(defaultVolume*100) }}%</span>
                  </label>
                </div>
                <h3 class="h">窗口 & 启动</h3>
                <div class="tog-wrap">
                  <label class="tog-row"><span>启动时开机自启（WIP）</span><input type="checkbox" v-model="startOnBoot" disabled /></label>
                  <label class="tog-row"><span>关闭按钮时 → 最小化到托盘</span><input type="checkbox" v-model="closeToTray" /></label>
                </div>
                <button class="save" @click="saveGeneral">💾 保存通用设置</button>
              </div>

              <!-- ═══════════════ Library ═══════════════ -->
              <div v-if="tab==='library'" class="pane">
                <h3 class="h">音乐库目录（{{ folders.length }}）</h3>
                <div class="folder-list">
                  <div v-for="f in folders" :key="f" class="frow">
                    <span class="fp">📁 {{ f }}</span>
                    <button class="mrm" @click="removeFolder(f)">移除</button>
                  </div>
                  <div v-if="!folders.length" class="empty">尚未添加任何目录</div>
                </div>
                <div class="row2">
                  <button class="pbtn" @click="pickFolder">➕ 添加文件夹</button>
                  <button class="sbtn" :disabled="scanning || !folders.length" @click="rescan">
                    {{ scanning ? '扫描中…' : '🔄 重新扫描' }}
                  </button>
                </div>
                <div v-if="scanMsg" class="scanmsg">{{ scanMsg }}</div>
                <h3 class="h">当前统计</h3>
                <div class="stats">
                  <div class="stat"><div class="k">歌曲数</div><div class="v">{{ lib.songs.length }}</div></div>
                  <div class="stat"><div class="k">歌单数</div><div class="v">{{ lib.playlists.length }}</div></div>
                </div>
              </div>

              <!-- ═══════════════ Hotkeys ═══════════════ -->
              <div v-if="tab==='hotkeys'" class="pane">
                <div class="hint">点击右侧按钮 → 按下新的快捷键组合（Ctrl/Alt/Shift + 任意键）</div>
                <div class="hk-list">
                  <div v-for="(v, action) in hotkeys" :key="action" class="hk-row">
                    <span class="hk-name">{{ HOTKEY_LABELS[action] ?? action }}</span>
                    <div class="hk-rhs">
                      <span v-if="recording===action" class="rec">录制中：{{ recordBuf || '按下快捷键...' }}</span>
                      <span v-else class="acc">{{ v || '未绑定' }}</span>
                      <button v-if="recording===action" class="b-s" @click="cancelRecord">取消</button>
                      <button v-else class="b-p" @click="startRecord(action)">🔧 改</button>
                      <button class="b-s" @click="resetHotkey(action)">重置</button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- ═══════════════ Audio Devices (基础) ═══════════════ -->
              <div v-if="tab==='audio'" class="pane">
                <div class="warn">{{ warnM3 }}</div>
                <label class="lbl-col block">
                  麦克风输入设备
                  <select v-model="inDevId" class="sel w100">
                    <option value="">系统默认</option>
                    <option v-for="d in micDevs" :key="d.deviceId" :value="d.deviceId">{{ d.label || `麦克风 ${d.deviceId.slice(0,8)}` }}</option>
                  </select>
                </label>
                <label class="lbl-col block">
                  音频输出设备
                  <select v-model="outDevId" class="sel w100">
                    <option value="">系统默认</option>
                    <option v-for="d in spkDevs" :key="d.deviceId" :value="d.deviceId">{{ d.label || `输出 ${d.deviceId.slice(0,8)}` }}</option>
                  </select>
                </label>
                <div class="row3">
                  <label class="tog-row"><span>RNNoise AI 降噪（M3）</span><input type="checkbox" v-model="denoiseOn" /></label>
                  <label class="lbl-col">
                    目标延迟（ms）
                    <input type="range" min="10" max="100" step="5" v-model.number="latencyMs" />
                    <span class="v">{{ latencyMs }}ms</span>
                  </label>
                </div>
                <button class="save" @click="saveAudio">💾 保存音频设置</button>
              </div>

              <!-- ═══════════════ Mixer (M3 高级混音设置) ═══════════════ -->
              <div v-if="tab==='mixer'" class="pane">
                <div class="mixer-intro">
                  <div class="mi-status" :class="{ok: audio.installed.installed}">
                    <span class="dot"></span>
                    <span v-if="audio.installed.installed">虚拟麦克风：<b>{{ audio.installed.virtualDeviceName }}</b> (id={{ audio.installed.virtualDeviceId }})</span>
                    <span v-else>虚拟麦克风：<b>未安装</b> · 混音功能需要 VB-CABLE 或同等驱动</span>
                  </div>
                </div>

                <label class="lbl-col block">
                  🔊 虚拟播放设备（音乐 → 虚拟麦克风输入）
                  <select v-model.number="vDevId" class="sel w100">
                    <option v-for="d in playbackDevs" :key="d.id" :value="d.id">
                      {{ d.isVirtual || isVirtual(d.name) ? '✨ ' : '' }}{{ d.name }}
                    </option>
                  </select>
                  <div class="sub-hint">优先选择名称含 <code>CABLE</code> 或 <code>Virtual</code> 的虚拟设备</div>
                </label>

                <label class="lbl-col block">
                  🎙️ 物理麦克风设备（你的声音输入）
                  <select v-model.number="mDevId" class="sel w100">
                    <option v-for="d in recordingDevs" :key="d.id" :value="d.id">{{ d.name }}</option>
                  </select>
                </label>

                <div class="row3">
                  <label class="lbl-col">
                    采样率
                    <select v-model.number="sr" class="sel">
                      <option :value="44100">44100 Hz (CD)</option>
                      <option :value="48000">48000 Hz (标准)</option>
                      <option :value="96000">96000 Hz (高解析)</option>
                    </select>
                  </label>
                  <label class="lbl-col">
                    &nbsp;
                    <div class="row-actions">
                      <button class="mbtn" @click="recheckVirtual">🔄 重新检查虚拟设备</button>
                      <button class="mbtn" @click="testMic">🎤 测试麦克风</button>
                    </div>
                  </label>
                </div>

                <div class="tog-wrap">
                  <label class="tog-row">
                    <span><b>AGC</b> 自动增益控制 · 自动保持音量稳定（主播/会议推荐）</span>
                    <input type="checkbox" v-model="agcOn" />
                  </label>
                  <label class="tog-row">
                    <span><b>AEC</b> 回声消除 · 防止音响声音回授麦克风（开扬声器时推荐）</span>
                    <input type="checkbox" v-model="ecOn" />
                  </label>
                </div>

                <div v-if="mixerTip" class="mixer-tip">{{ mixerTip }}</div>

                <button class="save" @click="saveMixer">💾 保存 & 应用混音设置</button>

                <div class="presets-ref">
                  <h3 class="h">快速预设参考</h3>
                  <div class="presets-list">
                    <div class="p-item"><span class="p-icon">🎮</span><b>开黑模式</b>：麦克风优先，降噪中，AGC+AEC</div>
                    <div class="p-item"><span class="p-icon">🎧</span><b>听歌模式</b>：音乐优先，关闭高级处理</div>
                    <div class="p-item"><span class="p-icon">🎤</span><b>主播模式</b>：强降噪，AGC+AEC，麦克风强化</div>
                    <div class="p-item"><span class="p-icon">📺</span><b>观影模式</b>：音乐最大化，仅轻量回声消除</div>
                    <div class="p-item"><span class="p-icon">🎙️</span><b>会议模式</b>：强降噪+强AGC+强AEC，音乐轻</div>
                  </div>
                </div>
              </div>

              <!-- ═══════════════ About ═══════════════ -->
              <div v-if="tab==='about'" class="pane about">
                <div class="logo">🎼</div>
                <div class="bn">Aurora Music</div>
                <div class="bv">Version {{ appV }} · M3（游戏混音 + 5 预设快捷键）</div>
                <div class="desc">毛玻璃音乐播放器 · 本地音乐库、歌单、收藏、全局快捷键、托盘、5 模式游戏语音混音</div>
                <h3 class="h">技术栈</h3>
                <div class="chips">
                  <span v-for="t in techs" :key="t" class="chip">{{ t }}</span>
                </div>
                <div class="mt">
                  📄 设计文档：<code>AuroraMusic/docs/superpowers/specs/</code><br/>
                  🗺️ 实施计划：<code>AuroraMusic/docs/superpowers/plans/</code>
                </div>
              </div>
            </div>
          </div>
          <Transition name="tip">
            <div v-if="saveTip" class="tip">{{ saveTip }}</div>
          </Transition>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
.mask { position: fixed; inset: 0; background: rgba(0,0,0,.55); backdrop-filter: blur(4px); z-index: 60; display:flex; justify-content: flex-end; }
.drawer { width: min(720px, 100%); height: 100vh; background: #0f1017; border-left: 1px solid rgba(255,255,255,.06);
  display: flex; flex-direction: column; position: relative; }
.dr-enter-active, .dr-leave-active { transition: .28s ease; }
.dr-enter-from .drawer, .dr-leave-to .drawer { transform: translateX(100%); }
.dr-enter-from, .dr-leave-to { background: rgba(0,0,0,0); backdrop-filter: blur(0); }
.hd { display:flex; align-items:center; justify-content:space-between; padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,.06); }
.t { font-size: 16px; font-weight: 700; color: #fff; }
.x { width: 32px; height: 32px; border-radius: 8px; font-size: 14px; color: rgba(255,255,255,.7);
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.06); cursor: pointer; }
.x:hover { background: rgba(255,255,255,.08); color: #fff; }
.body { flex: 1; display: grid; grid-template-columns: 180px 1fr; overflow: hidden; }
.side { padding: 12px 8px; border-right: 1px solid rgba(255,255,255,.05); overflow-y: auto; }
.sitem { padding: 9px 14px; border-radius: 9px; font-size: 13px; color: rgba(255,255,255,.65); cursor: pointer; margin-bottom: 3px; }
.sitem:hover { background: rgba(255,255,255,.05); color: #fff; }
.sitem.active { background: linear-gradient(135deg, rgba(255,126,95,.22), rgba(254,180,123,.12)); color: #fff; border: 1px solid rgba(255,126,95,.2); }
.cnt { padding: 16px 20px; overflow-y: auto; }
.pane { padding: 4px 4px 40px; }
.h { font-size: 13px; font-weight: 700; color: rgba(255,255,255,.85); margin: 14px 0 10px;
  padding-left: 10px; border-left: 3px solid var(--c-accent-1); }
.h:first-child { margin-top: 0; }
.themes { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; }
.theme-card { padding: 9px; border-radius: 12px; cursor: pointer;
  background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06); transition: transform .15s; }
.theme-card:hover { transform: translateY(-1px); }
.theme-card.active { border-color: rgba(255,126,95,.6); background: rgba(255,126,95,.08); }
.thumb { width: 100%; aspect-ratio: 1.3; border-radius: 9px; margin-bottom: 7px; }
.lbl { font-size: 12px; color: rgba(255,255,255,.8); text-align: center; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.lbl-col { display: grid; gap: 6px; font-size: 12px; color: rgba(255,255,255,.6); }
.lbl-col.block { display: grid; margin-bottom: 12px; }
.lbl-col .v { font-size: 11px; color: rgba(255,255,255,.45); }
.sub-hint { font-size: 11px; color: rgba(255,255,255,.4); margin-top: -2px; }
.sub-hint code { padding: 1px 5px; border-radius: 4px; background: rgba(255,255,255,.06); color: #ffb199; font-family: ui-monospace, monospace; font-size: 10.5px; }
.sel { height: 36px; padding: 0 10px; border-radius: 9px; font-size: 13px; color: #fff;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); outline: none; }
.sel.w100 { width: 100%; }
.tog-wrap { display: grid; gap: 6px; margin: 10px 0; }
.tog-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px;
  background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06); border-radius: 9px;
  font-size: 13px; color: rgba(255,255,255,.78); cursor: pointer; }
.save { margin-top: 16px; padding: 9px 18px; border-radius: 10px; font-size: 13px; font-weight: 600; border: 0; cursor: pointer;
  color: #fff; background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2)); box-shadow: 0 4px 12px rgba(255,126,95,.3); }
.save:hover { transform: translateY(-1px); }
.folder-list { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06); border-radius: 12px; padding: 4px; max-height: 220px; overflow-y: auto; }
.frow { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-radius: 9px; }
.frow:hover { background: rgba(255,255,255,.04); }
.fp { font-size: 12px; color: rgba(255,255,255,.75); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mrm { padding: 4px 10px; font-size: 11px; border-radius: 7px; color: #fca5a5;
  background: rgba(239,68,68,.08); border: 1px solid rgba(239,68,68,.18); cursor: pointer; }
.empty { padding: 18px; text-align: center; font-size: 12px; color: rgba(255,255,255,.4); }
.row2 { display: flex; gap: 8px; margin: 12px 0; }
.row3 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 10px 0; }
.row-actions { display: flex; gap: 6px; }
.pbtn, .sbtn, .mbtn { padding: 8px 14px; border-radius: 9px; cursor: pointer; font-size: 12px; font-weight: 600; border: 0; }
.pbtn { color: #fff; background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2)); }
.sbtn, .mbtn { color: rgba(255,255,255,.85); background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); }
.sbtn:disabled { opacity: .5; cursor: not-allowed; }
.mbtn:hover { background: rgba(255,255,255,.09); }
.scanmsg { padding: 8px 12px; border-radius: 9px; margin-bottom: 8px; font-size: 12px; color: #6ee7b7;
  background: rgba(16,185,129,.08); border: 1px solid rgba(16,185,129,.18); }
.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.stat { padding: 14px; border-radius: 11px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.06); }
.stat .k { font-size: 11px; color: rgba(255,255,255,.45); }
.stat .v { font-size: 22px; font-weight: 700; color: #fff; margin-top: 4px; }
.hint { padding: 8px 10px; border-radius: 9px; font-size: 12px; color: rgba(255,255,255,.7);
  background: rgba(255,126,95,.08); border: 1px solid rgba(255,126,95,.2); margin-bottom: 12px; }
.hk-list { display: grid; gap: 5px; }
.hk-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center;
  padding: 8px 12px; border-radius: 9px; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06); }
.hk-name { font-size: 13px; color: rgba(255,255,255,.8); }
.hk-rhs { display: flex; gap: 6px; align-items: center; }
.acc { padding: 3px 10px; border-radius: 7px; font-family: ui-monospace, 'Cascadia Code', monospace; font-size: 11px;
  color: rgba(255,255,255,.9); background: rgba(255,255,255,.07); min-width: 120px; text-align: center; }
.rec { padding: 3px 10px; border-radius: 7px; font-family: ui-monospace, monospace; font-size: 11px;
  color: #fde68a; background: rgba(251,191,36,.12); min-width: 180px; text-align: center;
  animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .65; } }
.b-p, .b-s { padding: 3px 10px; border-radius: 6px; font-size: 11px; cursor: pointer; border: 0; }
.b-p { color: #fff; background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2)); }
.b-s { color: rgba(255,255,255,.75); background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); }
.warn { padding: 9px 12px; border-radius: 10px; margin-bottom: 14px; font-size: 12px; color: #fed7aa;
  background: rgba(249,115,22,.08); border: 1px solid rgba(249,115,22,.2); }

.mixer-intro { margin-bottom: 10px; }
.mi-status { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px;
  font-size: 12.5px; background: rgba(239,68,68,.07); border: 1px solid rgba(239,68,68,.2); color: rgba(255,255,255,.8); }
.mi-status.ok { background: rgba(34,197,94,.07); border-color: rgba(34,197,94,.22); }
.mi-status.ok b { color: #86efac; }
.mi-status b { color: #fca5a5; }
.mi-status .dot { width: 8px; height: 8px; border-radius: 50%; background: #ef4444; flex-shrink: 0; box-shadow: 0 0 8px rgba(239,68,68,.6); }
.mi-status.ok .dot { background: #22c55e; box-shadow: 0 0 8px rgba(34,197,94,.6); }
.mixer-tip { margin-top: 10px; padding: 8px 12px; border-radius: 9px; font-size: 12px;
  background: rgba(255,126,95,.08); border: 1px solid rgba(255,126,95,.2); color: rgba(255,255,255,.85); }
.presets-ref { margin-top: 22px; }
.presets-list { display: grid; gap: 5px; }
.p-item { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 8px;
  background: rgba(255,255,255,.025); border: 1px solid rgba(255,255,255,.05); font-size: 12px; color: rgba(255,255,255,.72); }
.p-item .p-icon { font-size: 15px; }
.p-item b { color: rgba(255,255,255,.92); }

.about { display: grid; justify-items: center; text-align: center; gap: 6px; padding-top: 8px; }
.logo { width: 78px; height: 78px; border-radius: 22px; margin-bottom: 6px; display: grid; place-items: center; font-size: 34px;
  background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2)); box-shadow: 0 12px 30px rgba(255,126,95,.35); }
.bn { font-size: 22px; font-weight: 800; color: #fff; }
.bv { font-size: 12px; color: rgba(255,255,255,.5); }
.desc { max-width: 380px; font-size: 12px; color: rgba(255,255,255,.65); margin: 4px 0 10px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; max-width: 420px; }
.chip { padding: 4px 10px; font-size: 11px; color: rgba(255,255,255,.8); border-radius: 999px;
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); }
.mt { margin-top: 16px; font-size: 11px; color: rgba(255,255,255,.5); line-height: 1.7; }
.mt code { padding: 2px 6px; border-radius: 5px; font-family: ui-monospace, monospace;
  background: rgba(255,255,255,.05); color: #ffb199; }
.tip { position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%);
  padding: 8px 18px; border-radius: 999px; font-size: 12px; color: #0f172a; font-weight: 600;
  background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2)); z-index: 2;
  box-shadow: 0 8px 24px rgba(255,126,95,.35); }
.tip-enter-active, .tip-leave-active { transition: all .2s; }
.tip-enter-from, .tip-leave-to { opacity: 0; transform: translate(-50%, 12px); }
</style>
