// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "./button";

describe("Button", () => {
  it("renders the default shadcn button surface", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<Button>Default</Button>);

    const classes = host.querySelector<HTMLElement>('[data-slot="button"]')?.className.split(/\s+/) ?? [];

    expect(classes).toContain("bg-primary");
    expect(classes).toContain("text-primary-foreground");
    expect(classes).toContain("shadow-xs");
    expect(classes).toContain("hover:bg-primary/90");
    expect(classes).toContain("rounded-md");
  });

  it("renders secondary and destructive with the stock shadcn variants", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <>
        <Button variant="secondary">Secondary</Button>
        <Button variant="destructive">Delete</Button>
      </>,
    );

    const buttons = Array.from(host.querySelectorAll<HTMLElement>('[data-slot="button"]'));

    expect(buttons).toHaveLength(2);
    expect(buttons[0].className.split(/\s+/)).toEqual(expect.arrayContaining(["bg-secondary", "text-secondary-foreground"]));
    expect(buttons[1].className.split(/\s+/)).toEqual(expect.arrayContaining(["bg-destructive", "text-white"]));
  });

  it("renders outline buttons with the stock shadcn border and background", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<Button variant="outline">取消</Button>);

    const classes = host.querySelector<HTMLElement>('[data-slot="button"]')?.className.split(/\s+/) ?? [];

    expect(classes).toContain("border");
    expect(classes).toContain("bg-background");
    expect(classes).toContain("shadow-xs");
    expect(classes).toContain("hover:bg-accent");
    expect(classes).toContain("hover:text-accent-foreground");
  });

  it("lets callers compact a small button with local sizing classes", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<Button className="h-7 gap-1 px-2.5 text-xs" size="sm">保存</Button>);

    const classes = host.querySelector<HTMLElement>('[data-slot="button"]')?.className.split(/\s+/) ?? [];

    expect(classes).toContain("h-7");
    expect(classes).not.toContain("h-8");
    expect(classes).toContain("px-2.5");
    expect(classes).toContain("text-xs");
    expect(classes).toContain("gap-1");
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
