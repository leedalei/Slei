import type { BrowserWindowConstructorOptions } from "electron";

export function createWindowVisualOptions({
  platform,
}: {
  platform: NodeJS.Platform;
}): BrowserWindowConstructorOptions {
  const macosTrafficLightDiameter = 14;
  const appChromeHeight = 36;
  const centeredTrafficLightY = (appChromeHeight - macosTrafficLightDiameter) / 2;
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
    trafficLightPosition: { x: 16, y: centeredTrafficLightY },
    transparent: true,
    backgroundColor: "#00000000",
    vibrancy: "under-window",
    visualEffectState: "active",
  };
}
