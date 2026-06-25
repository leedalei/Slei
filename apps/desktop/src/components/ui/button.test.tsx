// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "./button";

describe("Button", () => {
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
