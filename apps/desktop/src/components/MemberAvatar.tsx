import type { ReactNode } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import type { SleiMember } from "../app/types";
import { createMemberAvatarImage, memberAvatarFallback, type MemberAvatarIdentity } from "./member-avatar";
import { cn } from "../lib/utils";
import { StatusDot } from "./StatusIndicators";

type MemberAvatarSize = "small" | "default" | "large";

export function MemberAvatar(input: {
  children?: ReactNode;
  identity: MemberAvatarIdentity;
  large?: boolean;
  size?: MemberAvatarSize;
  status?: SleiMember["runtimeStatus"];
}) {
  const { identity, large = false } = input;
  const size = large ? "large" : input.size ?? "default";
  const avatarImage = createMemberAvatarImage(identity);
  const fallback = memberAvatarFallback(identity);
  return (
    <Avatar
      aria-label={identity.name}
      className={cn("bg-background", avatarSizeClassName(size))}
      size={avatarPrimitiveSize(size)}
      data-avatar-image-rendering={avatarImage?.imageRendering ?? "fallback"}
      data-avatar-size={size}
    >
      {avatarImage ? (
        <AvatarImage
          alt=""
          className={avatarImage.imageRendering === "pixelated" ? "[image-rendering:pixelated]" : undefined}
          src={avatarImage.src}
        />
      ) : null}
      <AvatarFallback className={size === "small" ? "text-[10px] leading-none" : undefined}>{fallback}</AvatarFallback>
      {input.status ? (
        <StatusDot className="absolute bottom-0 right-0 z-10 size-2 ring-2 ring-background" status={input.status} />
      ) : null}
      {input.children}
    </Avatar>
  );
}

function avatarSizeClassName(size: MemberAvatarSize) {
  if (size === "large") return "size-[3.75rem]";
  if (size === "small") return "size-7";
  return "size-8";
}

function avatarPrimitiveSize(size: MemberAvatarSize) {
  if (size === "large") return "lg";
  if (size === "small") return "sm";
  return "default";
}
