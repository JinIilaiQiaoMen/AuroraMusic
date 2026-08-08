<script setup lang="ts">
import { computed, ref } from 'vue'
import GlassCard from './GlassCard.vue'
import { useAudioStore, MIXER_PRESETS_LABELS, type MixerPresetId } from '@/stores/audio'

const emit = defineEmits<{ 'open-guide': [] }>()

const audio = useAudioStore()
const mixError = ref('')

const presetList = (Object.keys(MIXER_PRESETS_LABELS) as MixerPresetId[]).map(id => ({
  id,
  label: MIXER_PRESETS_LABELS[id]
}))

async function applyPreset(id: MixerPresetId) {
  // 应用预设前：如果要启用混音（on=true）而驱动未装，不要静默失败
  mixError.value = ''
  const r = await audio.applyPreset(id)
  // applyPreset 内部会先 applyPatch（含 on），但目前 applyPreset 是 void；这里再手动检查 on 状态
  if (audio.state.on && !audio.installed.installed) {
    // 预设把 on=true 了，但驱动未装 → 打开向导
    await audio.applyPatch({ on: false })
    mixError.value = '当前预设需要虚拟麦克风驱动，先完成安装向导'
    setTimeout(() => (mixError.value = ''), 4000)
    emit('open-guide')
  }
}

async function toggleOn() {
  mixError.value = ''
  const target = !audio.state.on
  if (!target) {
    await audio.applyPatch({ on: false })
    return
  }
  // 开 ON：检查驱动 + 检查 IPC 返回
  const r = await audio.applyPatch({ on: true })
  if (!r.ok) {
    if (r.error === 'VIRTUAL_MIC_NOT_INSTALLED') {
      mixError.value = '请先安装虚拟麦克风驱动，完成后再打开总开关'
      setTimeout(() => (mixError.value = ''), 4500)
      emit('open-guide')
      return
    }
    mixError.value = r.error || '混音启动失败，请检查设备'
    setTimeout(() => (mixError.value = ''), 4500)
  }
}

function stopEmergency() {
  audio.emergencyStop()
}

function onBarClick() {
  if (!audio.installed.installed) {
    emit('open-guide')
  }
}

const barText = computed(() => {
  if (audio.installed.installed) {
    const id = audio.installed.virtualDeviceId || 'N/A'
    const name = audio.installed.virtualDeviceName || 'Aurora Virtual Mic'
    return `✅ ${name} (id = ${id})`
  }
  return '⚠️ 虚拟麦克风未安装 · 点击安装引导'
})

const monitorL = computed(() => Math.round((audio.levels.outL) * 100))
const monitorR = computed(() => Math.round((audio.levels.outR) * 100))
const micL = computed(() => Math.round((audio.levels.micL) * 100))
const micR = computed(() => Math.round((audio.levels.micR) * 100))
</script>

<template>
  <GlassCard radius="lg" class="mix">
    <div class="head">
      <div class="title">🎙️ 游戏混音输出 <span class="status" :class="{on: audio.state.on}">{{ audio.state.on ? '● ON AIR' : '○ OFF' }}</span></div>
      <div class="sw">
        <span class="lbl">总开关</span>
        <div class="toggle" :class="{ off: !audio.state.on }" @click="toggleOn"></div>
      </div>
    </div>

    <div v-if="mixError" class="mix-error">{{ mixError }}</div>

    <div class="presets">
      <div
        v-for="p in presetList"
        :key="p.id"
        class="preset"
        :class="{ active: audio.state.preset === p.id }"
        @click="applyPreset(p.id)"
      >{{ p.label }}</div>
    </div>

    <div class="levels">
      <div class="lv-row">
        <span class="lv-lbl">🎤 麦克风</span>
        <div class="bars">
          <div class="bar"><div class="fill" :style="{ width: micL + '%' }"></div></div>
          <div class="bar"><div class="fill" :style="{ width: micR + '%' }"></div></div>
        </div>
        <span class="lv-num">{{ Math.max(micL, micR) }}%</span>
      </div>
      <div class="lv-row">
        <span class="lv-lbl">🔊 混音输出</span>
        <div class="bars">
          <div class="bar out"><div class="fill" :style="{ width: monitorL + '%' }"></div></div>
          <div class="bar out"><div class="fill" :style="{ width: monitorR + '%' }"></div></div>
        </div>
        <span class="lv-num">{{ Math.max(monitorL, monitorR) }}%</span>
      </div>
    </div>

    <div class="sliders">
      <div class="row">
        <div class="lbl"><span>🎵</span> 音乐音量</div>
        <input type="range" v-model.number="audio.state.musicGain" @input="audio.applyPatch({musicGain: audio.state.musicGain})" class="slider" min="0" max="100">
        <div class="val">{{ audio.state.musicGain }}%</div>
      </div>
      <div class="row">
        <div class="lbl"><span>🎙️</span> 麦克风</div>
        <input type="range" v-model.number="audio.state.micGain" @input="audio.applyPatch({micGain: audio.state.micGain})" class="slider" min="0" max="100">
        <div class="val">{{ audio.state.micGain }}%</div>
      </div>
      <div class="row">
        <div class="lbl"><span>👂</span> 本地监听</div>
        <input type="range" v-model.number="audio.state.monitorGain" @input="audio.applyPatch({monitorGain: audio.state.monitorGain})" class="slider" min="0" max="100">
        <div class="val">{{ audio.state.monitorGain }}%</div>
      </div>
      <div class="row">
        <div class="lbl"><span>🛡️</span> 降噪强度</div>
        <input type="range" v-model.number="audio.state.denoiseStrength" @input="audio.applyPatch({denoiseStrength: audio.state.denoiseStrength})" class="slider" min="0" max="100">
        <div class="val">{{ audio.state.denoiseStrength }}%</div>
      </div>
    </div>

    <div class="foot">
      <div class="bar" :class="{ clickable: !audio.installed.installed }" @click="onBarClick">{{ barText }}</div>
      <button class="stop-btn" @click="stopEmergency" title="紧急停止混音">🛑</button>
    </div>
  </GlassCard>
</template>

<style lang="scss" scoped>
.mix { padding: 18px; display: flex; flex-direction: column; gap: 14px; min-height: 0; }
.head { display: flex; align-items: center; justify-content: space-between; }
.title { font-size: 14px; font-weight: 600; color: var(--text-1); display: flex; align-items: center; gap: 8px; }
.status { font-size: 10px; padding: 3px 9px; border-radius: 999px; background: rgba(239,68,68,.18); color: #fca5a5; letter-spacing: .5px; }
.status.on { background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; }
.sw { display: flex; align-items: center; gap: 10px; }
.lbl { font-size: 11px; color: rgba(255,255,255,.55); }
.toggle { width: 44px; height: 24px; border-radius: 12px; position: relative; cursor: pointer;
  background: linear-gradient(135deg, var(--c-accent-1), var(--c-accent-2)); box-shadow: 0 4px 12px rgba(255,126,95,.4); }
.toggle::after { content:''; position:absolute; width: 20px; height: 20px; border-radius: 50%; background:#fff; right: 2px; top: 2px; box-shadow: 0 2px 6px rgba(0,0,0,.25); }
.toggle.off { background: rgba(255,255,255,.1); box-shadow: none; }
.toggle.off::after { right:auto; left: 2px; }
.presets { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.preset { padding: 7px 4px; border-radius: 10px; text-align: center; font-size: 10.5px; font-weight: 500; cursor: pointer;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.06); color: rgba(255,255,255,.75); }
.preset:hover { background: rgba(255,255,255,.08); }
.preset.active { background: linear-gradient(135deg, rgba(255,126,95,.25), rgba(254,180,123,.25)); border-color: rgba(255,126,95,.4); color: #fff; }

.levels { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-radius: 10px;
  background: rgba(255,255,255,.025); border: 1px solid rgba(255,255,255,.05); }
.lv-row { display: grid; grid-template-columns: 72px 1fr 40px; align-items: center; gap: 10px; }
.lv-lbl { font-size: 11px; color: rgba(255,255,255,.65); }
.bars { display: flex; gap: 3px; }
.bar { flex: 1; height: 6px; border-radius: 3px; background: rgba(255,255,255,.08); overflow: hidden; }
.bar .fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, #22c55e, #eab308, #ef4444); transition: width .1s linear; }
.bar.out .fill { background: linear-gradient(90deg, var(--c-accent-1), var(--c-accent-2)); }
.lv-num { font-size: 10.5px; color: rgba(255,255,255,.45); text-align: right; font-variant-numeric: tabular-nums; }

.sliders { display: flex; flex-direction: column; gap: 12px; }
.row { display: grid; grid-template-columns: 72px 1fr 40px; align-items: center; gap: 12px; }
.row .lbl { display: flex; align-items: center; gap: 6px; font-size: 12px; color: rgba(255,255,255,.75); font-weight: 500; }
.row .val { font-size: 12px; color: rgba(255,255,255,.55); text-align: right; font-variant-numeric: tabular-nums; }
.slider { -webkit-appearance: none; width: 100%; height: 5px; border-radius: 3px; background: rgba(255,255,255,.12); cursor: pointer; outline: none; }
.slider::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #fff;
  box-shadow: 0 2px 10px rgba(0,0,0,.3); margin-top: -5.5px; transition: transform .15s; }
.slider::-webkit-slider-thumb:hover { transform: scale(1.15); }

.foot { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; }
.bar { padding: 9px 12px; border-radius: 10px; background: rgba(255,255,255,.03); font-size: 11px; color: rgba(255,255,255,.5);
  border: 1px dashed rgba(255,255,255,.08); }
.bar.clickable { cursor: pointer; }
.bar.clickable:hover { background: rgba(255,255,255,.06); border-color: rgba(255,126,95,.3); color: #ffb199; }
.mix-error { padding: 9px 12px; border-radius: 10px; font-size: 12px;
  background: linear-gradient(135deg, rgba(239,68,68,.18), rgba(245,126,95,.12));
  color: #ffb199; border: 1px solid rgba(255,126,95,.35); }
.stop-btn { width: 40px; height: 40px; border-radius: 10px; border: 1px solid rgba(239,68,68,.3);
  background: rgba(239,68,68,.1); color: #ef4444; font-size: 18px; cursor: pointer; }
.stop-btn:hover { background: rgba(239,68,68,.2); }
</style>
