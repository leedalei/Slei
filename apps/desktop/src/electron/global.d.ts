import type { createSleiPreloadApi } from "./preload.js";

declare global {
  interface Window {
    slei?: ReturnType<typeof createSleiPreloadApi>;
  }
}
