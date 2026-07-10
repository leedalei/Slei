import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount } from "./avatar";

describe("Avatar", () => {
  it("renders the default shadcn avatar without glow decoration", () => {
    const html = renderToStaticMarkup(<Avatar aria-label="Coda" />);
    const avatarRoot = html.match(/<span[^>]*data-slot="avatar"[^>]*>/)?.[0];

    expect(avatarRoot).toContain('data-slot="avatar"');
    expect(avatarRoot).toContain("h-8");
    expect(avatarRoot).toContain("w-8");
    expect(avatarRoot).toContain("border border-muted-foreground/30");
    expect(avatarRoot).not.toContain("border-border");
    expect(avatarRoot).not.toContain("border-border/40");
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
    const avatarRoot = html.match(/<span[^>]*data-slot="avatar"[^>]*>/)?.[0];
    const avatarGroupCount = html.match(/<div[^>]*data-slot="avatar-group-count"[^>]*>/)?.[0];

    expect(html).toContain('data-slot="avatar-group"');
    expect(avatarRoot).toContain('data-slot="avatar"');
    expect(avatarGroupCount).toContain('data-slot="avatar-group-count"');
    expect(html).toContain("+3");
    expect(avatarRoot).toContain("border border-muted-foreground/30");
    expect(avatarRoot).not.toContain("border-border");
    expect(avatarGroupCount).toContain("border border-border");
    expect(html).not.toContain("backdrop-blur");
    expect(html).not.toContain("border-white/");
  });

  it("can render the avatar badge styles on a child button without extra wrapper styles", () => {
    const html = renderToStaticMarkup(
      <Avatar aria-label="Coda">
        <AvatarBadge asChild>
          <button aria-label="Message" type="button">
            <span data-testid="badge-icon" />
          </button>
        </AvatarBadge>
      </Avatar>,
    );

    expect(html).toContain('<button');
    expect(html).toContain('data-slot="avatar-badge"');
    expect(html).toContain('aria-label="Message"');
    expect(html).toContain("absolute");
    expect(html).toContain("bottom-0");
    expect(html).toContain("right-0");
    expect(html).not.toContain("<span data-slot=\"avatar-badge\"><button");
  });

  it("sizes lg avatar badges with a 10px icon target", () => {
    const html = renderToStaticMarkup(
      <Avatar aria-label="Coda" size="lg">
        <AvatarBadge asChild>
          <button aria-label="Message" type="button">
            <svg aria-hidden="true" />
          </button>
        </AvatarBadge>
      </Avatar>,
    );

    expect(html).toContain("data-[size=lg]:h-[3.75rem]");
    expect(html).toContain("data-[size=lg]:w-[3.75rem]");
    expect(html).not.toContain("data-[size=lg]:h-10");
    expect(html).not.toContain("data-[size=lg]:w-10");
    expect(html).toContain("group-data-[size=lg]/avatar:size-5");
    expect(html).toContain("group-data-[size=lg]/avatar:[&amp;&gt;svg]:size-2.5");
    expect(html).not.toContain("group-data-[size=lg]/avatar:size-3");
    expect(html).not.toContain("group-data-[size=lg]/avatar:[&amp;&gt;svg]:size-3");
  });

  it("does not clip badge overflow while keeping avatar media rounded", () => {
    const html = renderToStaticMarkup(
      <Avatar aria-label="Coda">
        <AvatarFallback>CO</AvatarFallback>
        <AvatarBadge />
      </Avatar>,
    );
    const avatarStart = html.indexOf('data-slot="avatar"');
    const avatarTag = html.slice(html.lastIndexOf("<span", avatarStart), html.indexOf(">", avatarStart));

    expect(avatarTag).not.toContain("overflow-hidden");
    expect(html).toContain('data-slot="avatar-fallback"');
    expect(html).toContain("rounded-full");
  });
});
