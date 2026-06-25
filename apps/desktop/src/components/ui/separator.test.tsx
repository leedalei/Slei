import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Separator } from "./separator";

describe("Separator", () => {
  it("renders the horizontal separator primitive by default", () => {
    const html = renderToStaticMarkup(<Separator />);

    expect(html).toContain('data-slot="separator"');
    expect(html).toContain('data-orientation="horizontal"');
  });

  it("uses theme border color instead of a gradient background", () => {
    const html = renderToStaticMarkup(<Separator />);

    expect(html).toContain("border-border");
    expect(html).toContain("bg-transparent");
    expect(html).toContain("border-t");
    expect(html).not.toContain("bg-gradient-to-r");
    expect(html).not.toContain("via-black/12");
    expect(html).not.toContain("dark:via-white/20");
  });

  it("renders a vertical separator with separator semantics when requested", () => {
    const html = renderToStaticMarkup(
      <Separator className="mx-2" decorative={false} orientation="vertical" />,
    );

    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('data-orientation="vertical"');
    expect(html).toContain("border-l");
    expect(html).toContain("mx-2");
  });
});
