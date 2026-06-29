import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { createMemberAvatar, type MemberAvatarIdentity } from "./member-avatar";

type MemberAvatarSize = "small" | "default" | "large";

export function MemberAvatar(input: { identity: MemberAvatarIdentity; large?: boolean; size?: MemberAvatarSize }) {
  const { identity, large = false } = input;
  const size = large ? "large" : input.size ?? "default";
  const fallback = identity.avatar ?? identity.name.slice(0, 2).toUpperCase();
  return (
    <Avatar
      aria-label={identity.name}
      className={avatarSizeClassName(size)}
      data-avatar-image-rendering="pixelated"
      data-avatar-size={size}
      glowEffect={false}
    >
      <AvatarImage alt="" className="[image-rendering:pixelated]" src={createMemberAvatar(identity)} />
      <AvatarFallback className={size === "small" ? "text-[8px] leading-none" : undefined}>{fallback}</AvatarFallback>
    </Avatar>
  );
}

function avatarSizeClassName(size: MemberAvatarSize) {
  if (size === "large") return "size-16";
  if (size === "small") return "size-4";
  return "size-8";
}
