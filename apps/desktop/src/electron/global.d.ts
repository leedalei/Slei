import type { createSleiPreloadApi } from "./preload-api.js";

declare global {
  interface Window {
    slei?: ReturnType<typeof createSleiPreloadApi>;
  }
}
