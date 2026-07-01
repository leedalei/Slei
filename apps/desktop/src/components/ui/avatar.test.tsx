import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Avatar, AvatarGroup, AvatarGroupCount } from "./avatar";

describe("Avatar", () => {
  it("renders the default shadcn avatar without glow decoration", () => {
    const html = renderToStaticMarkup(<Avatar aria-label="Coda" />);

    expect(html).toContain('data-slot="avatar"');
    expect(html).toContain("h-8");
    expect(html).toContain("w-8");
    expect(html).not.toContain("bg-linear");
    expect(html).not.toContain("backdrop-blur");
    expect(html).not.toContain("border-white/");
    expect(html).not.toContain("blur-[3px]");
  });

  it("renders grouped avatars and overflow count through shadcn slots", () => {
    const html = renderToStaticMarkup(
      <AvatarGroup aria-label="Channel members">
        <Avatar aria-label="Coda" />
        <AvatarGroupCount>+3</AvatarGroupCount>
      </AvatarGroup>,
    );

    expect(html).toContain('data-slot="avatar-group"');
    expect(html).toContain('data-slot="avatar"');
    expect(html).toContain('data-slot="avatar-group-count"');
    expect(html).toContain("+3");
    expect(html).not.toContain("backdrop-blur");
    expect(html).not.toContain("border-white/");
  });
});
