import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Avatar } from "./avatar";

describe("Avatar", () => {
  it("keeps the default avatar glow close to the portrait edge", () => {
    const html = renderToStaticMarkup(<Avatar aria-label="Coda" />);

    expect(html).toContain("-inset-px");
    expect(html).toContain("blur-[3px]");
    expect(html).not.toContain("-inset-0.5");
    expect(html).not.toContain("blur-[6px]");
  });
});
