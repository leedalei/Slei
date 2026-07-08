import type { BrowserWindowConstructorOptions } from "electron";

export function createWindowVisualOptions({
  platform,
}: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
}): BrowserWindowConstructorOptions {
  const baseOptions: BrowserWindowConstructorOptions = {
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
  };

  if (platform !== "darwin") {
    return baseOptions;
  }

  return {
    ...baseOptions,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    transparent: true,
    backgroundColor: "#00000000",
    vibrancy: "under-window",
    visualEffectState: "active",
  };
}
