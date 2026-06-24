import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders a filled task status badge with a semantic data attribute", () => {
    const html = renderToStaticMarkup(<StatusBadge label="运行中" status="running" />);

    expect(html).toContain('data-slei-status="running"');
    expect(html).toContain("运行中");
    expect(html).toContain("<svg");
  });

  it("avoids risky white text on 500-level status backgrounds for common tones", () => {
    const riskyPattern = /(bg-(?:amber|emerald|sky)-500[^"]*text-white|text-white[^"]*bg-(?:amber|emerald|sky)-500)/;

    for (const status of ["approval", "busy", "idle", "info", "running", "success", "warn"]) {
      const html = renderToStaticMarkup(<StatusBadge label={status} status={status} />);

      expect(html).not.toMatch(riskyPattern);
    }
  });
});
