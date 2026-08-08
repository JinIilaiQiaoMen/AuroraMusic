/// <reference types="vite/client" />
import type { ApiShape } from '../../preload'
declare global {
  interface Window { api: ApiShape }
}
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
export {}
