import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Separator } from "./separator";

describe("Separator", () => {
  it("renders the horizontal liquid glass separator styling by default", () => {
    const html = renderToStaticMarkup(<Separator />);

    expect(html).toContain('data-slot="separator"');
    expect(html).toContain('data-orientation="horizontal"');
    expect(html).toContain("bg-gradient-to-r");
    expect(html).toContain("from-transparent");
    expect(html).toContain("via-white/20");
    expect(html).toContain("to-transparent");
    expect(html).toContain("h-px");
    expect(html).toContain("w-full");
    expect(html).not.toContain("bg-border");
  });

  it("renders a vertical liquid glass separator with separator semantics when requested", () => {
    const html = renderToStaticMarkup(
      <Separator className="mx-2" decorative={false} orientation="vertical" />,
    );

    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('data-orientation="vertical"');
    expect(html).toContain("bg-gradient-to-r");
    expect(html).toContain("h-full");
    expect(html).toContain("w-px");
    expect(html).toContain("mx-2");
    expect(html).not.toContain("data-vertical:self-stretch");
  });
});
