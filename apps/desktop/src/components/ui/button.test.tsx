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

  it("keeps non-primary button surfaces transparent until interaction", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <>
        <Button>Default</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
      </>,
    );

    const buttons = Array.from(host.querySelectorAll<HTMLElement>('[data-slot="button"]'));

    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      const classes = button.className.split(/\s+/);
      expect(classes).toContain("bg-transparent");
      expect(classes).not.toContain("bg-white/20");
      expect(classes).not.toContain("bg-white/15");
    }
  });

  it("keeps the primary button edge on the original EinUI glass border", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<Button variant="primary">Send</Button>);

    const classes = host.querySelector<HTMLElement>('[data-slot="button"]')?.className.split(/\s+/) ?? [];

    expect(classes).toContain("border-white/30");
    expect(classes).not.toContain("border-transparent");
  });

  it("renders primary buttons with the original EinUI gradient color", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<Button variant="primary">Create</Button>);

    const classes = host.querySelector<HTMLElement>('[data-slot="button"]')?.className.split(/\s+/) ?? [];

    expect(classes).toContain("bg-linear-to-r");
    expect(classes).toContain("from-cyan-500/80");
    expect(classes).toContain("via-blue-500/80");
    expect(classes).toContain("to-purple-500/80");
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
