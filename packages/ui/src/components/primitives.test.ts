import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Avatar, Badge, Button, Checkbox, Dialog, Input, Select, Tabs } from "./primitives";

const stylesDir = fileURLToPath(new URL("../styles/", import.meta.url));
const globalsCss = readFileSync(`${stylesDir}globals.css`, "utf8");
const tokensCss = readFileSync(`${stylesDir}tokens.css`, "utf8");

describe("Slei UI primitives", () => {
  it("button uses semantic token classes and preserves disabled state", () => {
    const button = Button({ children: "保存", disabled: true, variant: "accent" });

    expect(button.role).toBe("button");
    expect(button.disabled).toBe(true);
    expect(button.className).toContain("slei-button");
    expect(button.className).toContain("slei-button--accent");
    expect(button.className).not.toContain("primitive");
  });

  it("input and badge expose accessible labels and semantic variants", () => {
    const input = Input({ label: "昵称", value: "Lei" });
    const badge = Badge({ children: "In Review", variant: "in_review" });

    expect(input.label).toBe("昵称");
    expect(input.className).toContain("slei-input");
    expect(badge.className).toContain("slei-badge--in_review");
  });

  it("select exposes combobox semantics and style class", () => {
    const select = Select({
      label: "语言",
      value: "zh-CN",
      options: [
        { label: "中文", value: "zh-CN" },
        { label: "English", value: "en-US" },
      ],
    });

    expect(select.role).toBe("combobox");
    expect(select.label).toBe("语言");
    expect(select.value).toBe("zh-CN");
    expect(select.className).toBe("slei-select");
  });

  it("checkbox exposes checked state and square style class", () => {
    const checkbox = Checkbox({ label: "转为任务", checked: true });

    expect(checkbox.role).toBe("checkbox");
    expect(checkbox.label).toBe("转为任务");
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(false);
    expect(checkbox.className).toBe("slei-checkbox");
  });

  it("dialog traps tab focus and escape closes it", () => {
    const dialog = Dialog({
      title: "确认",
      focusableIds: ["cancel", "confirm"],
      open: true,
    });

    expect(dialog.currentFocus()).toBe("cancel");
    dialog.handleKey("Tab");
    expect(dialog.currentFocus()).toBe("confirm");
    dialog.handleKey("Tab");
    expect(dialog.currentFocus()).toBe("cancel");
    dialog.handleKey("Escape");
    expect(dialog.isOpen()).toBe(false);
  });

  it("tabs activate with keyboard navigation", () => {
    const tabs = Tabs({ tabs: ["CHAT", "TASKS", "FILES"], active: "CHAT" });

    tabs.handleKey("ArrowRight");
    expect(tabs.active()).toBe("TASKS");
    tabs.handleKey("ArrowLeft");
    expect(tabs.active()).toBe("CHAT");
  });

  it("avatar falls back to initials", () => {
    expect(Avatar({ name: "Coda" }).initials).toBe("CO");
    expect(Avatar({ name: "lei lee" }).initials).toBe("LL");
  });

  it("css defines semantic tokens, focus-visible and reduced-motion behavior", () => {
    expect(tokensCss).toContain("--color-focus-ring");
    expect(tokensCss).toContain("--shadow-sm");
    expect(globalsCss).toContain(":focus-visible");
    expect(globalsCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(globalsCss).not.toContain("var(--primitive-");
  });
});
