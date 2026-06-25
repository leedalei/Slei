import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Separator } from "./separator";

describe("Separator", () => {
  it("renders the horizontal separator primitive by default", () => {
    const html = renderToStaticMarkup(<Separator />);

    expect(html).toContain('data-slot="separator"');
    expect(html).toContain('data-orientation="horizontal"');
  });

  it("renders a vertical separator with separator semantics when requested", () => {
    const html = renderToStaticMarkup(
      <Separator className="mx-2" decorative={false} orientation="vertical" />,
    );

    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('data-orientation="vertical"');
    expect(html).toContain("mx-2");
  });
});
