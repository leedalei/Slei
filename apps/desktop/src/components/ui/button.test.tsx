// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "./button";

describe("Button", () => {
  it("lets non-primary button variants inherit the shared foreground token", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <>
        <Button>Default</Button>
        <Button variant="destructive">Delete</Button>
      </>,
    );

    const buttons = Array.from(host.querySelectorAll<HTMLElement>('[data-slot="button"]'));

    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      const classes = button.className.split(/\s+/);
      expect(classes).toContain("text-foreground");
      expect(classes.some((className) => /^text-(secondary|muted|destructive|cyan)/.test(className))).toBe(false);
      expect(classes.some((className) => className.startsWith("dark:text-"))).toBe(false);
    }
  });

  it("keeps quiet non-primary button surfaces transparent until interaction", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <>
        <Button>Default</Button>
        <Button variant="secondary">Secondary</Button>
      </>,
    );

    const buttons = Array.from(host.querySelectorAll<HTMLElement>('[data-slot="button"]'));

    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      const classes = button.className.split(/\s+/);
      expect(classes).toContain("bg-transparent");
      expect(classes).not.toContain("bg-white/20");
      expect(classes).not.toContain("bg-white/15");
    }
  });

  it("renders outline buttons with an even 2px glass border and no top highlight", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<Button variant="outline">取消</Button>);

    const classes = host.querySelector<HTMLElement>('[data-slot="button"]')?.className.split(/\s+/) ?? [];

    expect(classes).toContain("overflow-hidden");
    expect(classes).toContain("border-2");
    expect(classes).not.toContain("border");
    expect(classes.some((className) => className.includes("inset_0_1px_0"))).toBe(false);
    expect(classes).toContain("bg-white/[0.08]");
    expect(classes).toContain("hover:bg-white/[0.14]");
    expect(classes).toContain("border-white/35");
  });

  it("renders the primary button edge as a dedicated gradient border layer", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<Button variant="primary">Send</Button>);

    const classes = host.querySelector<HTMLElement>('[data-slot="button"]')?.className.split(/\s+/) ?? [];

    expect(classes).toContain("border-transparent");
    expect(classes).not.toContain("border-white/30");
  });

  it("renders primary buttons with paired fill and border gradients", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<Button variant="primary">Create</Button>);

    const classes = host.querySelector<HTMLElement>('[data-slot="button"]')?.className.split(/\s+/) ?? [];

    expect(classes).not.toContain("bg-linear-to-r");
    expect(classes).not.toContain("bg-clip-padding");
    expect(classes.some((className) => className.startsWith("[background:linear-gradient"))).toBe(true);
    expect(classes.some((className) => className.startsWith("bg-[linear-gradient"))).toBe(false);
    expect(classes.some((className) => className.includes("padding-box"))).toBe(true);
    expect(classes.some((className) => className.includes("border-box"))).toBe(true);
    expect(classes).toContain("text-accent-foreground");
    expect(classes).not.toContain("bg-primary");
  });

  it("keeps the caller child as the styled root when rendered asChild", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <Button asChild>
        <a href="/x">Open</a>
      </Button>,
    );

    const buttonRoot = host.querySelector<HTMLElement>('[data-slot="button"]');

    expect(buttonRoot?.tagName).toBe("A");
    expect(buttonRoot?.getAttribute("href")).toBe("/x");
    expect(buttonRoot?.textContent).toBe("Open");
    expect(buttonRoot?.querySelector("span")).toBeNull();
  });
});
