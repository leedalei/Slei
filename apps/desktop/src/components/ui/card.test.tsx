// @vitest-environment jsdom
import { IconDeviceDesktop, IconPencil } from "@tabler/icons-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DetailBlock } from "../DetailBlock";
import { Card, CardContent, CardHeader, CardTitle } from "./card";

describe("Card", () => {
  it("keeps layout classes and card sections on the card root", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <Card className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]" glowEffect={false}>
        <CardHeader>Header</CardHeader>
        <CardContent>Content</CardContent>
      </Card>,
    );

    const card = host.querySelector<HTMLElement>('[data-slot="card"]');

    expect(card).not.toBeNull();
    expect(card?.parentElement).toBe(host);
    expect(card?.className).toContain("grid");
    expect(card?.className).toContain("h-full");
    expect(card?.className).toContain("grid-rows-[auto_minmax(0,1fr)]");
    expect(Array.from(card?.children ?? []).map((child) => child.getAttribute("data-slot"))).toEqual([
      "card-header",
      "card-content",
    ]);
  });

  it("renders the EinUI glass card structure through the stable Card exports", () => {
    const html = renderToStaticMarkup(
      <Card>
        <CardHeader>
          <CardTitle>设备名称</CardTitle>
        </CardHeader>
        <CardContent>本机设备</CardContent>
      </Card>,
    );

    expect(html).toContain('data-slot="card"');
    expect(html).toContain("bg-white/10");
    expect(html).toContain("backdrop-blur-xl");
    expect(html).toContain("shadow-[0_8px_32px_rgba(0,0,0,0.37)");
    expect(html).toContain('data-slot="card-header"');
    expect(html).toContain('data-slot="card-content"');
    expect(html).not.toContain("data-size=");
    expect(html).not.toContain("data-variant=");
  });
});

describe("DetailBlock", () => {
  it("renders secondary detail content without nesting another card", () => {
    const html = renderToStaticMarkup(
      <DetailBlock
        action={<IconPencil aria-label="编辑" />}
        description="MateBook-Pro-Max-3.local"
        icon={IconDeviceDesktop}
        title="Hostname"
        value={<strong>darwin arm64</strong>}
      >
        <span>ClaudeCode ready</span>
      </DetailBlock>,
    );

    expect(html).toContain('data-slot="detail-block"');
    expect(html).not.toContain('data-slot="card"');
    expect(html).toContain("rounded-lg");
    expect(html).toContain("border");
    expect(html).toContain("bg-muted/30");
    expect(html).toContain("p-3");
    expect(html).toContain("Hostname");
    expect(html).toContain("MateBook-Pro-Max-3.local");
    expect(html).toContain("darwin arm64");
    expect(html).toContain("ClaudeCode ready");
    expect(html).toContain("编辑");
  });
});
