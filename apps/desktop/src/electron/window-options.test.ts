import { describe, expect, it } from "vitest";
import { createWindowVisualOptions } from "./window-options";

describe("createWindowVisualOptions", () => {
  it("enables polished macOS chrome and centers traffic lights on the app chrome", () => {
    expect(createWindowVisualOptions({ platform: "darwin" })).toEqual(
      expect.objectContaining({
        width: 1280,
        height: 800,
        minWidth: 960,
        minHeight: 640,
        titleBarStyle: "hiddenInset",
        trafficLightPosition: { x: 16, y: 11 },
        transparent: true,
        backgroundColor: "#00000000",
        vibrancy: "under-window",
        visualEffectState: "active",
      }),
    );
  });

  it("keeps stable sizing in development on macOS", () => {
    expect(createWindowVisualOptions({ platform: "darwin" })).toMatchObject({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 640,
    });
  });

  it("omits translucent macOS-only options on non-macOS platforms", () => {
    const options = createWindowVisualOptions({ platform: "linux" });

    expect(options).toMatchObject({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 640,
    });
    expect(options.transparent).toBeUndefined();
    expect(options.backgroundColor).toBeUndefined();
    expect(options.vibrancy).toBeUndefined();
    expect(options.visualEffectState).toBeUndefined();
    expect(options.titleBarStyle).toBeUndefined();
    expect(options.trafficLightPosition).toBeUndefined();
  });
});
