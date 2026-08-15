import type { AirbridgeApi } from './index'

declare global {
  interface Window {
    airbridge: AirbridgeApi
  }
}

export {}
