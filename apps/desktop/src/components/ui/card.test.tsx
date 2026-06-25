// @vitest-environment jsdom
import { Monitor, Pencil } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DetailBlock } from "../DetailBlock";
import { Card, CardContent, CardHeader, CardTitle } from "./card";

describe("Card", () => {
  it("keeps layout classes and card sections on the card root", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <Card className="custom-card-root" glowEffect={false}>
        <CardHeader>Header</CardHeader>
        <CardContent>Content</CardContent>
      </Card>,
    );

    const card = host.querySelector<HTMLElement>('[data-slot="card"]');

    expect(card).not.toBeNull();
    expect(card?.parentElement).toBe(host);
    expect(card?.className).toContain("custom-card-root");
    expect(Array.from(card?.children ?? []).map((child) => child.getAttribute("data-slot"))).toEqual([
      "card-header",
      "card-content",
    ]);
  });

  it("renders the card structure through the stable Card exports", () => {
    const html = renderToStaticMarkup(
      <Card>
        <CardHeader>
          <CardTitle>设备名称</CardTitle>
        </CardHeader>
        <CardContent>本机设备</CardContent>
      </Card>,
    );

    expect(html).toContain('data-slot="card"');
    expect(html).toContain('data-slot="card-header"');
    expect(html).toContain('data-slot="card-title"');
    expect(html).toContain('data-slot="card-content"');
    expect(html).toContain("设备名称");
    expect(html).toContain("本机设备");
    expect(html).not.toContain("data-size=");
    expect(html).not.toContain("data-variant=");
  });
});

describe("DetailBlock", () => {
  it("renders secondary detail content without nesting another card", () => {
    const html = renderToStaticMarkup(
      <DetailBlock
        action={<Pencil aria-label="编辑" />}
        description="MateBook-Pro-Max-3.local"
        icon={Monitor}
        title="Hostname"
        value={<strong>darwin arm64</strong>}
      >
        <span>ClaudeCode ready</span>
      </DetailBlock>,
    );

    expect(html).toContain('data-slot="detail-block"');
    expect(html).not.toContain('data-slot="card"');
    expect(html).toContain("Hostname");
    expect(html).toContain("MateBook-Pro-Max-3.local");
    expect(html).toContain("darwin arm64");
    expect(html).toContain("ClaudeCode ready");
    expect(html).toContain("编辑");
  });
});
