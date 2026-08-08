<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { on, once } from '@/utils/events'

const props = defineProps<{ open?: boolean }>()
const emit = defineEmits<{ 'update:open': [v: boolean] }>()

type StepKey = 'detect' | 'download' | 'tutorial'
const step = ref<StepKey>('detect')

interface InstallInfo {
  bassOk: boolean
  rnnOk: boolean
  vcOk: boolean
  ffiOk: boolean
}
const info = ref<InstallInfo>({ bassOk: false, rnnOk: false, vcOk: false, ffiOk: false })
const checking = ref(false)
const errorTip = ref('')

/* 一键自动安装 */
const autoRunning = ref(false)
const autoError = ref('')
const autoProgress = ref<{ step: string; percent: number; message: string } | null>(null)
const lastLogFile = ref<string | null>(null)
let autoOffListener: (() => void) | null = null

async function openLastLog(kind: 'file' | 'folder' = 'file') {
  const w = window as any
  try {
    if (kind === 'file') {
      await w.api?.audio?.openInstallLogFile?.(lastLogFile.value || undefined)
    } else {
      await w.api?.audio?.openInstallLogFolder?.(lastLogFile.value || undefined)
    }
  } catch {}
}

async function doCheck() {
  checking.value = true
  errorTip.value = ''
  try {
    const st = await (window as any).api?.audio?.checkInstall?.()
    if (st) {
      info.value = {
        bassOk: !!(st.bassDll?.bass && st.bassDll?.mix),
        rnnOk: !!st.rnnoiseDll,
        vcOk: !!st.virtualCableInstalled,
        ffiOk: !!st.ffiInstalled,
      }
    }
  } catch (e: any) {
    errorTip.value = e?.message ?? String(e)
  } finally {
    checking.value = false
  }
  // rnnoise 是可选项（缺失时自动降级到 stub 模式），不纳入核心安装完成判断
  const allOk = info.value.bassOk && info.value.vcOk && info.value.ffiOk
  if (allOk) {
    emit('update:open', false)
  }
}

function openInstaller(kind: 'web' | 'local') {
  try { (window as any).api?.audio?.openInstaller?.(kind) } catch {}
  step.value = 'tutorial'
}

async function runAutoInstall() {
  if (autoRunning.value) return
  autoRunning.value = true
  autoError.value = ''
  lastLogFile.value = null
  autoProgress.value = { step: 'idle', percent: 0, message: '启动中…' }
  const w = window as any
  const mixer: any = w.api?.audio?.mixer
  if (typeof mixer?.onAutoInstallProgress === 'function') {
    autoOffListener = mixer.onAutoInstallProgress((p: any) => {
      if (p) autoProgress.value = { step: p.step, percent: p.percent ?? 0, message: p.message ?? '' }
    })
  }
  try {
    /* 1) 先自动下载/安装缺失的 BASS + RNNoise DLL 到 native/ 目录 */
    autoProgress.value = { step: 'downloading', percent: 1, message: '第一步：检查并安装 BASS/RNNoise 原生 DLL…' }
    const dllRes: any = await w.api?.audio?.autoInstallNativeDlls?.({ onlyMissing: true })
    if (dllRes?.logFile) lastLogFile.value = dllRes.logFile
    if (dllRes && dllRes.ok) {
      autoProgress.value = { step: 'done', percent: 50, message: `原生 DLL 就绪 (${dllRes.installed?.length ? '新增：' + dllRes.installed.join('、') : '已全部就位'})` }
    } else if (dllRes && !dllRes.ok && !(/rnnoise/i.test(dllRes.message || '') && (info.value.bassOk || (!info.value.rnnOk && !info.value.vcOk)))) {
      // rnnoise 下载失败（通常是因为 404 镜像）但 BASS/bassmix 正常时，别挡住 VB-CABLE 安装流程——继续往下走
      if (!/rnnoise/i.test(dllRes.message || '') || /BASS/i.test(dllRes.message || '')) {
        autoError.value = (dllRes.message || 'DLL 安装失败') + '（可点下方「查看错误日志」，或在第三步手动补充）'
      }
    }

    /* 2) 再下载并调起 VB-CABLE 系统驱动安装（注意：驱动装到 Windows 系统中，不是应用 native/ 目录） */
    if (!info.value.vcOk) {
      autoProgress.value = { step: 'downloading', percent: 55, message: '第二步：下载 VB-CABLE 虚拟音频驱动（系统级驱动，需 UAC 授权）…' }
      const r: any = await w.api?.audio?.autoInstallVBCable?.()
      if (r?.logFile) lastLogFile.value = r.logFile
      if (r && !r.ok) {
        if (!autoError.value) autoError.value = r.message || 'VB-CABLE 安装失败。点下方「查看错误日志」可排查。'
        else autoError.value += ' （此外 VB-CABLE 也未成功：' + (r.message || '') + '）'
      } else if (r && r.ok) {
        step.value = 'tutorial'
        await doCheck()
      }
    } else {
      // VB-CABLE 本来就安装好了
      step.value = 'tutorial'
      await doCheck()
    }
  } catch (e: any) {
    autoError.value = e?.message ?? String(e)
  } finally {
    autoRunning.value = false
    if (autoOffListener) { autoOffListener(); autoOffListener = null }
    // 兜底：如果没返回具体 logFile，仍尝试从全局获取 latest
    if (!lastLogFile.value) {
      try {
        const g = await w.api?.audio?.getInstallLogPath?.('latest')
        if (typeof g === 'string') lastLogFile.value = g
        else if (g?.path) lastLogFile.value = g.path
      } catch {}
    }
  }
}

onMounted(() => { if (props.open) doCheck() })
onBeforeUnmount(() => { if (autoOffListener) autoOffListener() })
</script>

<template>
  <Teleport to="body">
    <Transition name="dg">
      <div v-if="open" class="mask" @click.self="emit('update:open', false)">
        <div class="panel">
          <div class="hd">
            <div class="t">🎛️ 音频组件安装向导</div>
            <button class="x" @click="emit('update:open', false)">✕</button>
          </div>
          <div class="stepper">
            <div class="st" :class="{ active: step==='detect', done: step!=='detect' }">
              <span class="dot">1</span><span>检测环境</span>
            </div>
            <div class="line"></div>
            <div class="st" :class="{ active: step==='download', done: step==='tutorial' }">
              <span class="dot">2</span><span>下载安装</span>
            </div>
            <div class="line"></div>
            <div class="st" :class="{ active: step==='tutorial' }">
              <span class="dot">3</span><span>使用教程</span>
            </div>
          </div>
          <div class="body">
            <!-- ═══ step: detect ═══ -->
            <div v-if="step==='detect'" class="pane">
              <h3>正在检查系统是否安装游戏混音所需组件…</h3>
              <div v-if="checking" class="loading">🔍 扫描中…</div>
              <div v-else class="checklist">
                <div class="row"><span>VB-CABLE 虚拟音频线</span>
                  <span class="tag" :class="info.vcOk?'ok':'bad'">{{ info.vcOk?'✓ 已安装':'✗ 未安装' }}</span></div>
                <div class="row"><span>BASS + BASSmix DLL</span>
                  <span class="tag" :class="info.bassOk?'ok':'bad'">{{ info.bassOk?'✓ 已就位':'✗ 缺失' }}</span></div>
                <div class="row"><span>RNNoise DLL (AI 降噪) <em class="opt-tag">可选</em></span>
                  <span class="tag" :class="info.rnnOk?'ok':'warn'">{{ info.rnnOk?'✓ 已就位':'○ 降级模式' }}</span></div>
                <div class="row"><span>Koffi (原生调用桥)</span>
                  <span class="tag" :class="info.ffiOk?'ok':'bad'">{{ info.ffiOk?'✓ 已安装':'✗ 未安装' }}</span></div>
              </div>
              <div v-if="errorTip" class="warn">{{ errorTip }}</div>
              <div v-if="(!info.vcOk || !info.bassOk || !info.ffiOk) && !checking" class="auto-install-card">
                <div class="ach">🚀 一键自动安装全部组件（推荐）</div>
                <div class="acb">
                  <strong>自动完成 3 件事：</strong><br>
                  ① 下载 <em>bass.dll / bassmix.dll / rnnoise.dll</em> 到 <code>native/</code> 应用目录<br>
                  ② 下载 VB-CABLE 驱动 → 解压 → 调起安装程序（驱动装到 <em>Windows 系统</em>，不会出现在 native/ 目录）<br>
                  ③ 只需要在 UAC 弹窗时点「是」即可。安装 VB-CABLE 后需<strong>重启电脑</strong>才会生效。
                </div>
                <button class="pbtn big" :disabled="autoRunning" @click="runAutoInstall()">
                  <template v-if="autoRunning">
                    <span v-if="autoProgress?.step==='downloading'" class="spin">⬇</span>
                    <span v-else-if="autoProgress?.step==='unpacking'" class="spin">📦</span>
                    <span v-else-if="autoProgress?.step==='launching' || autoProgress?.step==='waiting-confirm'" class="spin">🚀</span>
                    <span v-else class="spin">⟳</span>
                    {{ autoProgress?.message || '安装中…' }}
                  </template>
                  <template v-else>
                    🚀 立即自动安装
                  </template>
                </button>
                <div v-if="autoProgress && (autoProgress.step === 'downloading')" class="prog-wrap">
                  <div class="prog"><div class="prog-bar" :style="{ width: (autoProgress.percent||0)+'%' }"></div></div>
                  <div class="prog-label">{{ autoProgress.percent||0 }}% · {{ autoProgress.message || '下载中' }}</div>
                </div>
                <div v-if="autoError" class="warn">{{ autoError }}</div>
                <div v-if="autoError" class="log-actions">
                  <span class="log-label">🛠️ 排查：</span>
                  <button class="sbtn small" :disabled="autoRunning" @click="openLastLog('file')">📄 查看详细错误日志</button>
                  <button class="ghost small" :disabled="autoRunning" @click="openLastLog('folder')">📁 打开日志文件夹</button>
                </div>
                <div v-if="lastLogFile" class="log-path">日志路径：<code>{{ lastLogFile }}</code></div>
                <div v-if="autoError && autoError.includes('未找到')" class="fallback">
                  <button class="sbtn" @click="openInstaller('web')">🌐 前往官网手动下载 →</button>
                </div>
              </div>
              <div class="hint">
                <strong>说明：</strong>未安装时 Aurora Music 仍可使用 <code>&lt;audio&gt;</code> 播放本地音乐（M2 模式）；
                但<strong>游戏语音混音 / AI 降噪 / 低延迟输出</strong>需要全部组件安装完毕。<br>
                <strong>温馨提示：</strong>VB-CABLE 是<strong> Windows 内核驱动</strong>，安装后文件会在 <code>C:\Windows\System32\drivers\</code>，不会出现在应用的 <code>native/</code> 目录。
              </div>
            </div>
            <!-- ═══ step: download ═══ -->
            <div v-if="step==='download'" class="pane">
              <h3>获取安装包</h3>
              <div class="cards">
                <div class="card primary">
                  <div class="ch">🚀 一键自动安装（推荐 · 最快）</div>
                  <div class="cb">
                    全自动：下载 BASS/RNNoise DLL → 复制到 native/ 目录 → 下载 VB-CABLE 驱动 → 调起安装程序。<br>
                    只需在 UAC 弹窗点「是」，VB-CABLE 装完后记得<strong>重启电脑</strong>。
                  </div>
                  <button class="pbtn big" :disabled="autoRunning" @click="runAutoInstall()">
                    <template v-if="autoRunning">{{ autoProgress?.message || '安装中…' }}</template>
                    <template v-else>🚀 立即自动安装</template>
                  </button>
                  <div v-if="autoProgress && (autoProgress.step === 'downloading')" class="prog-wrap" style="margin-top:10px;">
                    <div class="prog"><div class="prog-bar" :style="{ width: (autoProgress.percent||0)+'%' }"></div></div>
                    <div class="prog-label">{{ autoProgress.percent||0 }}% · {{ autoProgress.message || '下载中' }}</div>
                  </div>
                  <div v-if="autoError" class="warn" style="margin-top:10px;">{{ autoError }}</div>
                  <div v-if="autoError" class="log-actions">
                    <span class="log-label">🛠️ 排查：</span>
                    <button class="sbtn small" :disabled="autoRunning" @click="openLastLog('file')">📄 查看详细错误日志</button>
                    <button class="ghost small" :disabled="autoRunning" @click="openLastLog('folder')">📁 打开日志文件夹</button>
                  </div>
                  <div v-if="lastLogFile" class="log-path">日志路径：<code>{{ lastLogFile }}</code></div>
                </div>
                <div class="card">
                  <div class="ch">🌐 去官网下载（备用）</div>
                  <div class="cb">
                    自动打开 VB-Audio / BASS / RNNoise 三个下载页面，按提示完成安装后重启 Aurora。
                  </div>
                  <button class="sbtn" @click="openInstaller('web')">打开官网 →</button>
                </div>
                <div class="card">
                  <div class="ch">💾 我有本地安装包</div>
                  <div class="cb">
                    <strong>BASS/RNNoise</strong>：把 <em>bass.dll / bassmix.dll</em> 放到 <code>native/bass/x64/</code>，<em>rnnoise.dll</em> 放到 <code>native/rnnoise/x64/</code>。<br>
                    <strong>VB-CABLE 驱动</strong>：双击运行 <code>VBCABLE_Setup_x64.exe</code>（<em>不用复制到 native/，直接运行即可，驱动将安装到 Windows 系统</em>）。<br>
                    最后执行：<code>npm i koffi</code>。
                  </div>
                  <button class="sbtn" @click="step='tutorial'">继续阅读教程 →</button>
                </div>
              </div>
            </div>
            <!-- ═══ step: tutorial ═══ -->
            <div v-if="step==='tutorial'" class="pane">
              <h3>安装 & 配置三步曲</h3>
              <div class="tlist">
                <div class="tut">
                  <div class="n">1</div>
                  <div class="svg-box" aria-hidden="true">
                    <svg viewBox="0 0 160 96" xmlns="http://www.w3.org/2000/svg">
                      <rect x="6" y="6" width="148" height="84" rx="10" fill="rgba(255,255,255,.04)" stroke="rgba(255,126,95,.35)"/>
                      <rect x="18" y="22" width="60" height="10" rx="3" fill="rgba(255,255,255,.18)"/>
                      <rect x="18" y="40" width="90" height="8" rx="3" fill="rgba(255,255,255,.09)"/>
                      <rect x="18" y="54" width="70" height="8" rx="3" fill="rgba(255,255,255,.09)"/>
                      <rect x="90" y="70" width="56" height="16" rx="6" fill="url(#g1)"/>
                    </svg>
                  </div>
                  <div class="desc">
                    <strong>安装 VB-CABLE（系统驱动）：</strong>执行 Setup 安装包，完成后在「控制面板 → 声音」或 Windows「设置 → 声音 → 录制」中能看到 <em>CABLE Output</em> / <em>CABLE Input</em>。<br>
                    <span style="color:#ffb199;">驱动是<strong>系统级</strong>组件，<strong>不会出现</strong>在应用的 <code style="color:#ffb199;">native/</code> 目录下，驱动文件实际位于 <code>C:\Windows\System32\drivers\</code>。</span>
                  </div>
                </div>
                <div class="tut">
                  <div class="n">2</div>
                  <div class="svg-box" aria-hidden="true">
                    <svg viewBox="0 0 160 96" xmlns="http://www.w3.org/2000/svg">
                      <defs><linearGradient id="g2" x1="0" x2="1"><stop offset="0" stop-color="#667eea"/><stop offset="1" stop-color="#764ba2"/></linearGradient></defs>
                      <rect x="6" y="6" width="148" height="84" rx="10" fill="rgba(255,255,255,.04)" stroke="rgba(102,126,234,.35)"/>
                      <rect x="16" y="20" width="52" height="56" rx="6" fill="rgba(255,255,255,.06)"/>
                      <rect x="76" y="20" width="68" height="24" rx="6" fill="rgba(255,255,255,.08)"/>
                      <rect x="76" y="52" width="68" height="24" rx="6" fill="rgba(255,255,255,.08)"/>
                      <path d="M36 78 L54 62 L42 62 L42 44 L30 44 L30 62 L18 62 Z" fill="url(#g2)"/>
                    </svg>
                  </div>
                  <div class="desc">
                    <strong>复制应用 DLL（到 native/ 目录）：</strong><br>
                    <em>bass.dll / bassmix.dll</em> → <code>native/bass/x64/</code>（BASS 音频引擎 + 混音插件）<br>
                    <em>rnnoise.dll</em> → <code>native/rnnoise/x64/</code>（AI 降噪算法）<br>
                    <span style="color:#93c5fd;">一键安装按钮会自动完成本步，无需手动处理。</span>
                  </div>
                </div>
                <div class="tut">
                  <div class="n">3</div>
                  <div class="svg-box" aria-hidden="true">
                    <svg viewBox="0 0 160 96" xmlns="http://www.w3.org/2000/svg">
                      <defs><linearGradient id="g3" x1="0" x2="1"><stop offset="0" stop-color="#43e97b"/><stop offset="1" stop-color="#38f9d7"/></linearGradient></defs>
                      <rect x="6" y="6" width="148" height="84" rx="10" fill="rgba(255,255,255,.04)" stroke="rgba(67,233,123,.35)"/>
                      <circle cx="80" cy="48" r="26" fill="none" stroke="url(#g3)" stroke-width="4"/>
                      <path d="M68 48 L76 56 L92 38" stroke="url(#g3)" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                      <rect x="20" y="78" width="120" height="6" rx="3" fill="rgba(255,255,255,.08)"/>
                    </svg>
                  </div>
                  <div class="desc"><strong>重启 App & 验证：</strong>回到「设置 → 音频设备」，麦克风/输出设备下拉中应出现 <em>VB-CABLE</em> 项，M3 模式正式启用。安装 VB-CABLE 驱动后需<strong>重启电脑</strong>才生效。</div>
                </div>
              </div>
            </div>
          </div>
          <div class="ft">
            <button class="ghost" @click="doCheck" v-if="step==='detect'">🔄 重新检测</button>
            <button class="ghost" @click="step='detect'" v-else>← 返回检测</button>
            <div class="sp"></div>
            <button v-if="step==='detect' && (!info.vcOk || !info.bassOk || !info.ffiOk)" class="pbtn" @click="step='download'">前往安装 →</button>
            <button v-if="step==='download'" class="sbtn" @click="doCheck(); step='detect'">安装完了？再检测一次</button>
            <button class="skip" @click="emit('update:open', false)">跳过，先听音乐</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
.mask { position: fixed; inset: 0; background: rgba(0,0,0,.6); backdrop-filter: blur(5px); z-index: 80;
  display:flex; justify-content: flex-end; align-items: stretch; }
.panel { width: min(640px, 100%); height: 100vh; background: linear-gradient(180deg, #0f1017 0%, #0b0c13 100%);
  border-left: 1px solid rgba(255,255,255,.08); display:flex; flex-direction: column; position: relative; }
.dg-enter-active, .dg-leave-active { transition: .28s ease; }
.dg-enter-from .panel, .dg-leave-to .panel { transform: translateX(100%); }
.dg-enter-from, .dg-leave-to { background: rgba(0,0,0,0); backdrop-filter: blur(0); }

.hd { display:flex; align-items:center; justify-content:space-between; padding: 16px 22px;
  border-bottom: 1px solid rgba(255,255,255,.06); }
.t { font-size: 17px; font-weight: 700; color: #fff; }
.x { width: 34px; height: 34px; border-radius: 10px; font-size: 15px; color: rgba(255,255,255,.7);
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); cursor: pointer; }
.x:hover { background: rgba(255,255,255,.08); color: #fff; }

.stepper { display: flex; align-items: center; padding: 16px 22px 8px; gap: 6px; }
.st { display: flex; align-items: center; gap: 8px; font-size: 12px; color: rgba(255,255,255,.4); }
.st .dot { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.08); font-weight: 700; font-size: 11px; }
.st.active { color: #fff; }
.st.active .dot { background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2)); border: 0; color: #fff;
  box-shadow: 0 4px 10px rgba(255,126,95,.35); }
.st.done .dot { background: rgba(67,233,123,.15); color: #6ee7b7; border-color: rgba(67,233,123,.35); }
.line { flex: 1; height: 2px; background: rgba(255,255,255,.06); border-radius: 2px; }

.body { flex: 1; overflow-y: auto; padding: 10px 22px 20px; }
.pane h3 { font-size: 14px; color: #fff; margin: 6px 0 14px; font-weight: 700; }
.loading { padding: 30px; text-align: center; color: rgba(255,255,255,.6); }
.checklist { display: grid; gap: 6px; }
.checklist .row { display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-radius: 11px; background: rgba(255,255,255,.03);
  border: 1px solid rgba(255,255,255,.06); font-size: 13px; color: rgba(255,255,255,.82); }
.tag { padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.tag.ok { color: #6ee7b7; background: rgba(16,185,129,.1); border: 1px solid rgba(16,185,129,.25); }
.tag.bad { color: #fca5a5; background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.25); }
.tag.warn { color: #fde68a; background: rgba(245,158,11,.1); border: 1px solid rgba(245,158,11,.25); }
.opt-tag { font-size: 10px; color: rgba(253,230,138,.7); font-style: normal; margin-left: 4px; padding: 1px 6px; border-radius: 4px; background: rgba(245,158,11,.08); }
.hint { margin-top: 16px; padding: 12px 14px; border-radius: 11px; font-size: 12px; color: rgba(255,255,255,.65);
  background: rgba(255,126,95,.06); border: 1px solid rgba(255,126,95,.18); line-height: 1.7; }
.hint code { padding: 1px 6px; border-radius: 5px; font-family: ui-monospace, monospace;
  background: rgba(255,255,255,.06); color: #ffb199; }
.hint strong { color: #fff; }
.warn { margin-top: 10px; padding: 8px 12px; border-radius: 9px; font-size: 12px; color: #fca5a5;
  background: rgba(239,68,68,.08); border: 1px solid rgba(239,68,68,.18); }
.fallback { margin-top: 10px; display: flex; justify-content: flex-end; }
.fallback .sbtn { padding: 6px 14px; border-radius: 9px; font-size: 12px; }

.cards { display: grid; gap: 10px; }
.card { padding: 16px; border-radius: 14px; background: rgba(255,255,255,.03);
  border: 1px solid rgba(255,255,255,.06); }
.card.primary { background: linear-gradient(135deg, rgba(255,126,95,.08), rgba(255,100,150,.04));
  border-color: rgba(255,126,95,.28); }
.ch { font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 6px; }
.cb { font-size: 12px; color: rgba(255,255,255,.62); line-height: 1.7; margin-bottom: 12px; }
.cb code { padding: 1px 6px; border-radius: 5px; font-family: ui-monospace, monospace;
  background: rgba(255,255,255,.06); color: #ffb199; }
.pbtn, .sbtn, .ghost, .skip { padding: 9px 16px; border-radius: 10px; font-size: 12px; font-weight: 600; cursor: pointer; border: 0; }
.pbtn { color: #fff; background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2));
  box-shadow: 0 4px 12px rgba(255,126,95,.3); }
.pbtn.big { padding: 11px 18px; font-size: 13px; width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
.pbtn:disabled { opacity: .75; cursor: wait; filter: saturate(.8); }
.spin { display: inline-block; animation: dg-spin 1.2s linear infinite; }
@keyframes dg-spin { to { transform: rotate(360deg); } }
.prog-wrap { margin-top: 12px; display: grid; gap: 6px; }
.prog { height: 8px; border-radius: 999px; background: rgba(255,255,255,.06); overflow: hidden; }
.prog-bar { height: 100%; width: 0%; background: linear-gradient(90deg, var(--c-accent-1), var(--c-accent-2)); transition: width .25s ease; }
.prog-label { font-size: 11px; color: rgba(255,255,255,.55); text-align: right; }
.auto-install-card { margin-top: 14px; padding: 16px; border-radius: 14px;
  background: linear-gradient(135deg, rgba(255,126,95,.08), rgba(255,100,150,.03));
  border: 1px solid rgba(255,126,95,.28); }
.auto-install-card .ach { font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 6px; }
.auto-install-card .acb { font-size: 12px; color: rgba(255,255,255,.65); line-height: 1.7; margin-bottom: 12px; }
.auto-install-card .acb strong { color: #ffb199; }

.log-actions { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.log-actions .log-label { font-size: 12px; color: rgba(255,255,255,.55); margin-right: 2px; }
.sbtn.small, .ghost.small { padding: 5px 12px; font-size: 11px; border-radius: 8px; }
.log-path { margin-top: 8px; font-size: 11px; color: rgba(255,255,255,.45); word-break: break-all; }
.log-path code { padding: 1px 6px; border-radius: 5px; font-family: ui-monospace, monospace;
  background: rgba(255,255,255,.05); color: #9db4ff; }

.sbtn { color: rgba(255,255,255,.85); background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); }
.ghost { color: rgba(255,255,255,.75); background: transparent; border: 1px solid rgba(255,255,255,.08); }
.skip { color: rgba(255,255,255,.55); background: transparent; }
.skip:hover { color: #fff; }
.pbtn:hover:not(:disabled), .sbtn:hover, .ghost:hover { transform: translateY(-1px); }

.tlist { display: grid; gap: 14px; }
.tut { display: grid; grid-template-columns: 34px 160px 1fr; gap: 14px; align-items: start;
  padding: 14px; border-radius: 14px; background: rgba(255,255,255,.03);
  border: 1px solid rgba(255,255,255,.06); }
.tut .n { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center;
  background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2));
  color: #fff; font-weight: 800; font-size: 13px; box-shadow: 0 4px 10px rgba(255,126,95,.35); }
.svg-box { width: 160px; aspect-ratio: 1.66; border-radius: 10px; overflow: hidden;
  background: #0a0b10; border: 1px solid rgba(255,255,255,.06); }
.svg-box svg { width: 100%; height: 100%; display: block; }
.tut .desc { font-size: 12px; color: rgba(255,255,255,.72); line-height: 1.7; }
.tut .desc code { padding: 1px 6px; border-radius: 5px; font-family: ui-monospace, monospace;
  background: rgba(255,255,255,.06); color: #ffb199; }
.tut .desc strong { color: #fff; }
.tut .desc em { color: var(--c-accent-1); font-style: normal; font-weight: 600; }

.ft { display: flex; align-items: center; gap: 10px; padding: 14px 22px;
  border-top: 1px solid rgba(255,255,255,.06); }
.sp { flex: 1; }
</style>
