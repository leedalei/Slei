import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { createMemberAvatarImage, memberAvatarFallback, type MemberAvatarIdentity } from "./member-avatar";

type MemberAvatarSize = "small" | "default" | "large";

export function MemberAvatar(input: { identity: MemberAvatarIdentity; large?: boolean; size?: MemberAvatarSize }) {
  const { identity, large = false } = input;
  const size = large ? "large" : input.size ?? "default";
  const avatarImage = createMemberAvatarImage(identity);
  const fallback = memberAvatarFallback(identity);
  return (
    <Avatar
      aria-label={identity.name}
      className={avatarSizeClassName(size)}
      data-avatar-image-rendering={avatarImage?.imageRendering ?? "fallback"}
      data-avatar-size={size}
      glowEffect={false}
    >
      {avatarImage ? (
        <AvatarImage
          alt=""
          className={avatarImage.imageRendering === "pixelated" ? "[image-rendering:pixelated]" : undefined}
          src={avatarImage.src}
        />
      ) : null}
      <AvatarFallback className={size === "small" ? "text-[8px] leading-none" : undefined}>{fallback}</AvatarFallback>
    </Avatar>
  );
}

function avatarSizeClassName(size: MemberAvatarSize) {
  if (size === "large") return "size-16";
  if (size === "small") return "size-[16px]";
  return "size-8";
}
