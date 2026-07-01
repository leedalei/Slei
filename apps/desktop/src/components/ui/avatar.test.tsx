import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Avatar, AvatarGroup, AvatarGroupCount } from "./avatar";

describe("Avatar", () => {
  it("keeps the default avatar glow close to the portrait edge", () => {
    const html = renderToStaticMarkup(<Avatar aria-label="Coda" />);

    expect(html).toContain("-inset-px");
    expect(html).toContain("blur-[3px]");
    expect(html).not.toContain("-inset-0.5");
    expect(html).not.toContain("blur-[6px]");
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
  });
});
