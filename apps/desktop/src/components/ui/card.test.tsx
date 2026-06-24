import { IconDeviceDesktop, IconPencil } from "@tabler/icons-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DetailBlock } from "../DetailBlock";
import { Card, CardContent, CardHeader, CardTitle } from "./card";

describe("Card compact density", () => {
  it("renders compact cards with the shared compact spacing contract", () => {
    const html = renderToStaticMarkup(
      <Card size="compact">
        <CardHeader>
          <CardTitle>设备名称</CardTitle>
        </CardHeader>
        <CardContent>本机设备</CardContent>
      </Card>,
    );

    expect(html).toContain('data-slot="card"');
    expect(html).toContain('data-size="compact"');
    expect(html).toContain("gap-3");
    expect(html).toContain("py-3");
    expect(html).toContain("px-4");
  });

  it("renders raised and inset card variants", () => {
    const raised = renderToStaticMarkup(<Card variant="raised">Raised</Card>);
    const inset = renderToStaticMarkup(<Card variant="inset">Inset</Card>);

    expect(raised).toContain('data-variant="raised"');
    expect(inset).toContain('data-variant="inset"');
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
