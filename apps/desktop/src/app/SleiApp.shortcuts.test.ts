// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { handleAppSelectAllShortcut } from "./SleiApp";

function dispatchSelectAll(target: EventTarget, init: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "a",
    ctrlKey: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe("handleAppSelectAllShortcut", () => {
  it("prevents app-wide select all when focus is outside editable controls", () => {
    document.body.innerHTML = "<main><p>Selectable chrome</p></main>";
    const event = dispatchSelectAll(document.body);

    handleAppSelectAllShortcut(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("keeps native select all inside editable controls", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    document.body.append(input, textarea, editor);

    for (const target of [input, textarea, editor]) {
      const event = dispatchSelectAll(target);

      handleAppSelectAllShortcut(event);

      expect(event.defaultPrevented).toBe(false);
    }
  });

  it("also prevents macOS command-a outside editable controls", () => {
    const event = dispatchSelectAll(document.body, { ctrlKey: false, metaKey: true });

    handleAppSelectAllShortcut(event);

    expect(event.defaultPrevented).toBe(true);
  });
});
