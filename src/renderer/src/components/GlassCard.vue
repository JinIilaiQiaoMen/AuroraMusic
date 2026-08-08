<script setup lang="ts">
defineProps<{
  radius?: 'lg' | 'md' | 'sm'
  padding?: number
  hoverLift?: boolean
}>()
</script>

<template>
  <div class="glass" :class="[ `r-${radius ?? 'md'}`, { lift: hoverLift } ]">
    <slot />
  </div>
</template>

<style lang="scss" scoped>
.glass {
  position: relative;
  background: var(--glass-bg);
  border: 1px solid var(--glass-line);
  backdrop-filter: blur(30px);
  -webkit-backdrop-filter: blur(30px);
  transition: transform .2s ease, box-shadow .2s ease;
  padding: 8px;
}
.r-lg { border-radius: var(--radius-lg); }
.r-md { border-radius: var(--radius-md); }
.r-sm { border-radius: var(--radius-sm); }
.lift:hover { transform: translateY(-2px); box-shadow: 0 14px 40px rgba(0,0,0,.3); }
</style>
