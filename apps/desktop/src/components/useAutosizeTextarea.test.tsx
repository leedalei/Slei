// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { useAutosizeTextarea } from "./useAutosizeTextarea";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function Harness({ value, maxHeight }: { value: string; maxHeight: number | (() => number) }) {
  const ref = useAutosizeTextarea(value, { maxHeight });
  return <textarea data-testid="autosize" ref={ref} value={value} readOnly />;
}

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
    });
  }
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("useAutosizeTextarea", () => {
  it("caps height and enables scrolling after numeric max height", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness value="short" maxHeight={120} />);
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="autosize"]');
    expect(textarea).not.toBeNull();
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 180 });

    await act(async () => {
      root?.render(<Harness value={"long\n".repeat(20)} maxHeight={120} />);
    });

    expect(textarea?.style.maxHeight).toBe("120px");
    expect(textarea?.style.height).toBe("120px");
    expect(textarea?.style.overflowY).toBe("auto");
  });

  it("supports dynamic max height for viewport-constrained drawers", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });

    await act(async () => {
      root?.render(<Harness value="short" maxHeight={() => Math.min(320, window.innerHeight * 0.4)} />);
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="autosize"]');
    expect(textarea).not.toBeNull();
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 260 });

    await act(async () => {
      root?.render(<Harness value={"dynamic\n".repeat(20)} maxHeight={() => Math.min(320, window.innerHeight * 0.4)} />);
    });

    expect(textarea?.style.maxHeight).toBe("240px");
    expect(textarea?.style.height).toBe("240px");
    expect(textarea?.style.overflowY).toBe("auto");
  });

  it("recomputes callback max height on resize without a value change", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    const maxHeight = () => Math.min(320, window.innerHeight * 0.4);
    const value = "dynamic drawer content";

    await act(async () => {
      root?.render(<Harness value="initial" maxHeight={maxHeight} />);
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="autosize"]');
    expect(textarea).not.toBeNull();
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 500 });

    await act(async () => {
      root?.render(<Harness value={value} maxHeight={maxHeight} />);
    });

    expect(textarea?.style.maxHeight).toBe("320px");
    expect(textarea?.style.height).toBe("320px");

    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(textarea?.style.maxHeight).toBe("200px");
    expect(textarea?.style.height).toBe("200px");
    expect(textarea?.style.overflowY).toBe("auto");
  });
});
