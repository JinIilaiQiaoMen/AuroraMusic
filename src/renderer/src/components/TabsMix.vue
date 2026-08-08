<script setup lang="ts">import MixPanel from './MixPanel.vue'</script>
<template>
  <div class="wrap"><div class="in"><MixPanel /></div></div>
</template>
<style lang="scss" scoped>
.wrap { display:grid; place-items:center; min-height:0; padding: 8px; }
.in { width: min(460px, 100%); }
</style>
