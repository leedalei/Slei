/* @vitest-environment jsdom */

import { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "./sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Rendered = {
  host: HTMLElement;
  root: Root;
};

function installBrowserMocks() {
  const view = window as Window & typeof globalThis;

  class TestPointerEvent extends view.MouseEvent {
    pointerId: number;
    pointerType: string;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
    }
  }

  view.PointerEvent = TestPointerEvent as typeof PointerEvent;
  view.ResizeObserver =
    view.ResizeObserver ??
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

  HTMLElement.prototype.scrollIntoView = HTMLElement.prototype.scrollIntoView ?? function scrollIntoView() {};
  HTMLElement.prototype.hasPointerCapture = HTMLElement.prototype.hasPointerCapture ?? (() => false);
  HTMLElement.prototype.setPointerCapture = HTMLElement.prototype.setPointerCapture ?? (() => undefined);
  HTMLElement.prototype.releasePointerCapture = HTMLElement.prototype.releasePointerCapture ?? (() => undefined);
}

function renderUi(ui: React.ReactNode): Rendered {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  act(() => {
    root.render(ui);
  });

  return { host, root };
}

async function flushUi() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function clickElement(element: Element | null | undefined) {
  expect(element).toBeInstanceOf(HTMLElement);
  const target = element as HTMLElement;

  await act(async () => {
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false, pointerType: "mouse" }));
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, ctrlKey: false }));
    target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, ctrlKey: false, pointerType: "mouse" }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, ctrlKey: false }));
    target.click();
  });
  await flushUi();
}

async function keyDown(element: Element | Document, key: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
  });
  await flushUi();
}

function cleanup({ host, root }: Rendered) {
  act(() => {
    root.unmount();
  });
  host.remove();
}

function byText(text: string) {
  const candidates = Array.from(document.body.querySelectorAll<HTMLElement>("button,[role],span,p,h2,h3,div")).filter(
    (element) => element.textContent?.trim() === text,
  );

  return (
    candidates.find((element) => element.matches("button,[role]")) ??
    candidates.find((element) => !Array.from(element.children).some((child) => child.textContent?.trim() === text)) ??
    candidates[0]
  );
}

beforeEach(() => {
  installBrowserMocks();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("overlay UI primitives", () => {
  it("keeps modal and sheet surfaces themed from the app shell without primitive-specific Slei classes", () => {
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");
    const surfaceCss = appCss.slice(appCss.indexOf('[data-slot="dialog-content"],'), appCss.indexOf(".slei-modal-panel {"));

    expect(surfaceCss).toContain('[data-slot="dialog-content"],');
    expect(surfaceCss).toContain('[data-slot="alert-dialog-content"],');
    expect(surfaceCss).toContain('[data-slot="sheet-content"]');
    expect(surfaceCss).toContain("background: var(--modal-surface-bg);");
    expect(surfaceCss).toContain("border-color: var(--modal-border);");
    expect(surfaceCss).toContain("box-shadow: var(--modal-shadow);");
  });

  it("opens dialog content with accessible labels and closes from the icon button", async () => {
    const rendered = renderUi(
      <Dialog>
        <DialogTrigger>Open details</DialogTrigger>
        <DialogContent closeLabel="Close details">
          <DialogHeader>
            <DialogTitle>Channel details</DialogTitle>
            <DialogDescription>Review channel metadata.</DialogDescription>
          </DialogHeader>
          <button type="button">Focusable field</button>
        </DialogContent>
      </Dialog>,
    );

    try {
      expect(document.body.querySelector('[data-slot="dialog-content"]')).toBeNull();

      await clickElement(byText("Open details"));

      const content = document.body.querySelector<HTMLElement>('[data-slot="dialog-content"]');
      expect(content).not.toBeNull();
      expect(content?.getAttribute("role")).toBe("dialog");
      expect(content?.textContent).toContain("Channel details");
      expect(content?.textContent).toContain("Review channel metadata.");
      expect(content?.className).toContain("bg-background");
      expect(content?.className).toContain("text-foreground");
      expect(content?.className).toContain("shadow-lg");
      expect(content?.className).not.toContain("bg-popover");
      expect(content?.className).not.toContain("text-popover-foreground");
      expect(content?.className).not.toContain("slei-modal-surface");
      expect(content?.className).not.toContain("bg-white/30");
      expect(content?.className).not.toContain("backdrop-blur-2xl");
      expect(content?.className).not.toContain("before:from-white/45");
      expect(content?.querySelector('[data-slot="dialog-title"]')?.id).toBeTruthy();
      expect(content?.querySelector('[data-slot="dialog-description"]')?.id).toBeTruthy();

      await clickElement(byText("Close details"));
      expect(document.body.querySelector('[data-slot="dialog-content"]')).toBeNull();
    } finally {
      cleanup(rendered);
    }
  });

  it("opens alert-dialog content, exposes a disabled action, focuses a control, and closes through cancel", async () => {
    const rendered = renderUi(
      <AlertDialog>
        <AlertDialogTrigger>Delete member</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>This action removes the member from the channel.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    try {
      await clickElement(byText("Delete member"));

      const content = document.body.querySelector<HTMLElement>('[data-slot="alert-dialog-content"]');
      const disabledAction = document.body.querySelector<HTMLButtonElement>('[data-slot="alert-dialog-action"]');
      expect(content).not.toBeNull();
      expect(content?.getAttribute("role")).toBe("alertdialog");
      expect(content?.textContent).toContain("Remove member?");
      expect(content?.textContent).toContain("This action removes the member from the channel.");
      expect(content?.className).toContain("bg-background");
      expect(content?.className).toContain("text-foreground");
      expect(content?.className).toContain("shadow-lg");
      expect(content?.className).not.toContain("bg-popover");
      expect(content?.className).not.toContain("text-popover-foreground");
      expect(content?.className).not.toContain("slei-modal-surface");
      expect(content?.className).not.toContain("bg-white/30");
      expect(content?.className).not.toContain("backdrop-blur-2xl");
      expect(content?.className).not.toContain("before:from-white/45");
      expect(disabledAction?.disabled).toBe(true);
      expect(document.activeElement?.closest('[data-slot="alert-dialog-content"]')).toBe(content);

      await clickElement(byText("Cancel"));
      expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();
    } finally {
      cleanup(rendered);
    }
  });

  it("opens dropdown-menu content, highlights items by keyboard, and closes on selection", async () => {
    const rendered = renderUi(
      <DropdownMenu>
        <DropdownMenuTrigger>Open actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Rename</DropdownMenuItem>
          <DropdownMenuItem disabled>Archive</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    try {
      await clickElement(byText("Open actions"));

      const content = document.body.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
      const renameItem = byText("Rename");
      const disabledItem = byText("Archive");
      expect(content).not.toBeNull();
      expect(content?.getAttribute("role")).toBe("menu");
      expect(content?.getAttribute("data-state")).toBe("open");
      expect(content?.className).toContain("rounded-md");
      expect(content?.className).toContain("border");
      expect(content?.className).toContain("bg-popover");
      expect(content?.className).toContain("shadow-md");
      expect(content?.className).not.toContain("t-dropdown");
      expect(content?.className).not.toContain("shadow-[0_0_4px_rgba");
      expect(content?.className).not.toContain("bg-white/10");
      expect(renameItem?.getAttribute("role")).toBe("menuitem");
      expect(renameItem?.className).toContain("focus:bg-accent");
      expect(renameItem?.className).toContain("data-[highlighted]:bg-accent");
      expect(renameItem?.className).not.toContain("bg-muted/70");
      expect(disabledItem?.getAttribute("aria-disabled")).toBe("true");

      await keyDown(content!, "ArrowDown");
      expect(renameItem?.hasAttribute("data-highlighted")).toBe(true);

      await clickElement(renameItem);
      const closedContent = document.body.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
      expect(closedContent === null || closedContent.getAttribute("data-state") === "closed").toBe(true);
    } finally {
      cleanup(rendered);
    }
  });

  it("selects an enabled select option, closes the listbox, and keeps disabled triggers inert", async () => {
    const selectedValues: string[] = [];
    const rendered = renderUi(
      <>
        <Select onValueChange={(value) => selectedValues.push(value)}>
          <SelectTrigger aria-label="Agent status">
            <SelectValue placeholder="Pick status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="online">Online</SelectItem>
            <SelectItem disabled value="offline">
              Offline
            </SelectItem>
          </SelectContent>
        </Select>
        <Select>
          <SelectTrigger aria-label="Disabled status" disabled>
            <SelectValue placeholder="Disabled" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="disabled">Disabled option</SelectItem>
          </SelectContent>
        </Select>
      </>,
    );

    try {
      const disabledTrigger = document.body.querySelector<HTMLElement>('[aria-label="Disabled status"]');
      await clickElement(disabledTrigger);
      expect(document.body.querySelector('[data-slot="select-content"]')).toBeNull();

      const trigger = document.body.querySelector<HTMLElement>('[aria-label="Agent status"]');
      expect(trigger?.className).toContain("border-input");
      expect(trigger?.className).toContain("bg-transparent");
      expect(trigger?.className).toContain("dark:bg-input/30");
      expect(trigger?.className).toContain("focus-visible:border-ring");
      expect(trigger?.className).toContain("focus-visible:ring-[3px]");
      expect(trigger?.className).not.toContain("border-[var(--tabs-control-border)]");
      expect(trigger?.className).not.toContain("bg-[var(--tabs-control-bg)]");

      await clickElement(trigger);

      const content = document.body.querySelector<HTMLElement>('[data-slot="select-content"]');
      const option = byText("Online");
      const disabledOption = byText("Offline");
      expect(content).not.toBeNull();
      expect(content?.getAttribute("role")).toBe("listbox");
      expect(content?.className).toContain("border-border");
      expect(content?.className).toContain("bg-popover");
      expect(content?.className).toContain("shadow-md");
      expect(content?.className).not.toContain("t-dropdown");
      expect(option?.getAttribute("role")).toBe("option");
      expect(option?.className).toContain("focus:bg-accent");
      expect(option?.className).toContain("focus:text-accent-foreground");
      expect(disabledOption?.getAttribute("aria-disabled")).toBe("true");

      await clickElement(option);
      expect(selectedValues).toEqual(["online"]);
      expect(document.body.querySelector('[data-slot="select-content"]')).toBeNull();
      expect(document.body.querySelector('[aria-label="Agent status"]')?.textContent).toContain("Online");
    } finally {
      cleanup(rendered);
    }
  });

  it("opens tooltip content on keyboard focus and closes on blur", async () => {
    const rendered = renderUi(
      <Tooltip>
        <TooltipTrigger>Help</TooltipTrigger>
        <TooltipContent>Describe action</TooltipContent>
      </Tooltip>,
    );

    try {
      const trigger = byText("Help") as HTMLButtonElement;

      await act(async () => {
        trigger.focus();
      });
      await flushUi();

      const content = document.body.querySelector<HTMLElement>('[data-slot="tooltip-content"]');
      expect(content).not.toBeNull();
      expect(content?.getAttribute("role")).toBe("tooltip");
      expect(content?.textContent).toContain("Describe action");

      await act(async () => {
        trigger.blur();
      });
      await flushUi();
      expect(document.body.querySelector('[data-slot="tooltip-content"]')).toBeNull();
    } finally {
      cleanup(rendered);
    }
  });

  it("opens popover content from an accessible trigger and closes on Escape", async () => {
    const rendered = renderUi(
      <Popover>
        <PopoverTrigger aria-label="Open filters">Filters</PopoverTrigger>
        <PopoverContent>
          <button type="button">Only active</button>
        </PopoverContent>
      </Popover>,
    );

    try {
      await clickElement(document.body.querySelector('[aria-label="Open filters"]'));

      const content = document.body.querySelector<HTMLElement>('[data-slot="popover-content"]');
      expect(content).not.toBeNull();
      expect(content?.textContent).toContain("Only active");
      expect(content?.className).toContain("rounded-md");
      expect(content?.className).toContain("border");
      expect(content?.className).toContain("bg-popover");
      expect(content?.className).toContain("shadow-md");
      expect(content?.className).not.toContain("t-dropdown");
      expect(content?.className).not.toContain("shadow-[0_0_4px_rgba");
      expect(document.body.querySelector('[aria-label="Open filters"]')?.getAttribute("aria-expanded")).toBe("true");

      await keyDown(content!, "Escape");
      expect(document.body.querySelector('[data-slot="popover-content"]')).toBeNull();
      expect(document.body.querySelector('[aria-label="Open filters"]')?.getAttribute("aria-expanded")).toBe("false");
    } finally {
      cleanup(rendered);
    }
  });

  it("opens sheet content with side metadata and closes from its accessible close button", async () => {
    const rendered = renderUi(
      <Sheet>
        <SheetTrigger>Open task drawer</SheetTrigger>
        <SheetContent side="left">
          <SheetHeader>
            <SheetTitle>Task thread</SheetTitle>
            <SheetDescription>Continue the task conversation.</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>,
    );

    try {
      await clickElement(byText("Open task drawer"));

      const content = document.body.querySelector<HTMLElement>('[data-slot="sheet-content"]');
      expect(content).not.toBeNull();
      expect(content?.getAttribute("role")).toBe("dialog");
      expect(content?.getAttribute("data-side")).toBe("left");
      expect(content?.className.split(/\s+/)).toContain("bg-background");
      expect(content?.className.split(/\s+/)).not.toContain("slei-modal-surface");
      expect(content?.className).toContain("data-[state=open]:animate-in");
      expect(content?.className).toContain("data-[state=closed]:animate-out");
      expect(content?.className).not.toContain("bg-white/30");
      expect(content?.className).not.toContain("before:from-white/35");
      expect(content?.textContent).toContain("Task thread");
      expect(content?.textContent).toContain("Continue the task conversation.");

      await clickElement(byText("Close"));
      expect(document.body.querySelector('[data-slot="sheet-content"]')).toBeNull();
    } finally {
      cleanup(rendered);
    }
  });

  it("can render sheet content without a page mask", async () => {
    const rendered = renderUi(
      <Sheet defaultOpen>
        <SheetContent showOverlay={false}>
          <SheetHeader>
            <SheetTitle>Task thread</SheetTitle>
            <SheetDescription>Continue the task conversation.</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>,
    );

    try {
      expect(document.body.querySelector('[data-slot="sheet-content"]')).not.toBeNull();
      expect(document.body.querySelector('[data-slot="sheet-overlay"]')).toBeNull();
    } finally {
      cleanup(rendered);
    }
  });
});
