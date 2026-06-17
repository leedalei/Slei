/* @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import {
  EditableDetailField,
  commitEditableDetailSave,
  getEditableDetailKeyAction,
  prepareEditableDetailSave,
} from "./EditableDetailField";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type EditableDetailFieldProps = Parameters<typeof EditableDetailField>[0];

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

function renderEditableDetailField(props: Partial<EditableDetailFieldProps> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  act(() => {
    root.render(
      <EditableDetailField
        ariaLabel="编辑显示名称"
        initialEditing
        label="显示名称"
        onSave={() => undefined}
        value="Lei"
        {...props}
      />,
    );
  });

  return { host, root };
}

function cleanupEditableDetailField(root: Root, host: HTMLElement) {
  act(() => {
    root.unmount();
  });
  host.remove();
}

function getEditorInput(host: HTMLElement) {
  const input = host.querySelector("input, textarea");
  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
    throw new Error("Expected editable detail input to render");
  }
  return input;
}

function getEditorForm(host: HTMLElement) {
  const form = host.querySelector("form");
  if (!(form instanceof HTMLFormElement)) {
    throw new Error("Expected editable detail form to render");
  }
  return form;
}

async function changeEditorValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;

  await act(async () => {
    if (valueSetter) {
      valueSetter.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function submitEditorForm(host: HTMLElement) {
  const event = new SubmitEvent("submit", { bubbles: true, cancelable: true });

  await act(async () => {
    getEditorForm(host).dispatchEvent(event);
  });

  return event;
}

async function keyDownEditorInput(input: HTMLInputElement | HTMLTextAreaElement, event: KeyboardEvent) {
  await act(async () => {
    input.dispatchEvent(event);
  });

  return event;
}

describe("EditableDetailField", () => {
  it("trims non-empty drafts before saving", () => {
    expect(prepareEditableDetailSave("  Lei Lee  ", false)).toEqual({
      ok: true,
      value: "Lei Lee",
    });
  });

  it("rejects empty drafts unless allowEmpty is true", () => {
    expect(prepareEditableDetailSave("   ", false)).toEqual({ ok: false });
    expect(prepareEditableDetailSave("   ", true)).toEqual({ ok: true, value: "" });
  });

  it("normalizes thrown save errors to display text", () => {
    expect(prepareEditableDetailSave.errorMessage(new Error("保存失败"))).toBe("保存失败");
    expect(prepareEditableDetailSave.errorMessage("bad")).toBe("bad");
  });

  it("prevents overlapping async saves before external saving props update", async () => {
    const deferred = createDeferred();
    const saveInFlightRef = { current: false };
    const onSave = vi.fn(() => deferred.promise);
    const onSuccess = vi.fn();
    const onError = vi.fn();

    const firstSave = commitEditableDetailSave({
      draft: " Lei ",
      isSaving: false,
      managesSaving: false,
      onError,
      onSave,
      onSuccess,
      saveInFlightRef,
    });
    const secondSave = commitEditableDetailSave({
      draft: " Lei ",
      isSaving: false,
      managesSaving: false,
      onError,
      onSave,
      onSuccess,
      saveInFlightRef,
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    await expect(secondSave).resolves.toEqual({ status: "skipped" });

    deferred.resolve();

    await expect(firstSave).resolves.toEqual({ status: "saved", value: "Lei" });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(saveInFlightRef.current).toBe(false);
  });

  it("keeps editing state and draft when async save rejects", async () => {
    const saveInFlightRef = { current: false };
    const state = {
      draft: "  Draft name  ",
      editing: true,
      error: undefined as string | undefined,
    };

    const result = await commitEditableDetailSave({
      draft: state.draft,
      isSaving: false,
      managesSaving: false,
      onError: (message) => {
        state.error = message;
      },
      onSave: async () => {
        throw new Error("保存失败");
      },
      onSuccess: () => {
        state.editing = false;
        state.draft = "";
      },
      saveInFlightRef,
    });

    expect(result).toEqual({ status: "failed", message: "保存失败" });
    expect(state.editing).toBe(true);
    expect(state.draft).toBe("  Draft name  ");
    expect(state.error).toBe("保存失败");
    expect(saveInFlightRef.current).toBe(false);
  });

  it("maps Escape to cancel and Enter to single-line save only outside IME composition", () => {
    expect(getEditableDetailKeyAction({ key: "Escape" }, false)).toBe("cancel");
    expect(getEditableDetailKeyAction({ key: "Enter" }, false)).toBe("save");
    expect(getEditableDetailKeyAction({ key: "Enter" }, true)).toBe("ignore");
    expect(getEditableDetailKeyAction({ key: "Enter", nativeEvent: { isComposing: true } }, false)).toBe("ignore");
  });

  it("prevents duplicate DOM submits while an async save is pending", async () => {
    const deferred = createDeferred();
    const onSave = vi.fn(() => deferred.promise);
    const { host, root } = renderEditableDetailField({ onSave, saving: false });

    try {
      const firstSubmit = await submitEditorForm(host);
      const secondSubmit = await submitEditorForm(host);

      expect(firstSubmit.defaultPrevented).toBe(true);
      expect(secondSubmit.defaultPrevented).toBe(true);
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith("Lei");

      await act(async () => {
        deferred.resolve();
        await deferred.promise;
      });
    } finally {
      cleanupEditableDetailField(root, host);
    }
  });

  it("keeps the real editor and draft value visible when DOM save rejects", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("保存失败");
    });
    const { host, root } = renderEditableDetailField({ onSave });

    try {
      await changeEditorValue(getEditorInput(host), "  Draft name  ");
      await submitEditorForm(host);

      const input = getEditorInput(host);
      expect(input.value).toBe("  Draft name  ");
      expect(host.querySelector('[role="alert"]')?.textContent).toBe("保存失败");
      expect(onSave).toHaveBeenCalledWith("Draft name");
    } finally {
      cleanupEditableDetailField(root, host);
    }
  });

  it("cancels the real editor on Escape and prevents the default key action", async () => {
    const onSave = vi.fn();
    const { host, root } = renderEditableDetailField({ onSave });

    try {
      await changeEditorValue(getEditorInput(host), "Draft name");
      const event = await keyDownEditorInput(
        getEditorInput(host),
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      );

      expect(event.defaultPrevented).toBe(true);
      expect(host.querySelector("form")).toBeNull();
      expect(host.textContent).toContain("Lei");
      expect(onSave).not.toHaveBeenCalled();
    } finally {
      cleanupEditableDetailField(root, host);
    }
  });

  it("submits the real single-line editor on Enter and ignores composing Enter", async () => {
    const composingSave = vi.fn();
    const composingRender = renderEditableDetailField({ onSave: composingSave });

    try {
      const composingEvent = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" });
      Object.defineProperty(composingEvent, "isComposing", { value: true });

      await changeEditorValue(getEditorInput(composingRender.host), "  Composing name  ");
      await keyDownEditorInput(getEditorInput(composingRender.host), composingEvent);

      expect(composingEvent.defaultPrevented).toBe(false);
      expect(composingSave).not.toHaveBeenCalled();
      expect(getEditorInput(composingRender.host).value).toBe("  Composing name  ");
    } finally {
      cleanupEditableDetailField(composingRender.root, composingRender.host);
    }

    const onSave = vi.fn();
    const enterRender = renderEditableDetailField({ onSave });

    try {
      await changeEditorValue(getEditorInput(enterRender.host), "  Kai  ");
      const enterEvent = await keyDownEditorInput(
        getEditorInput(enterRender.host),
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );

      expect(enterEvent.defaultPrevented).toBe(true);
      expect(onSave).toHaveBeenCalledWith("Kai");
      expect(enterRender.host.querySelector("form")).toBeNull();
    } finally {
      cleanupEditableDetailField(enterRender.root, enterRender.host);
    }
  });
});
