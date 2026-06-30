import { createAvatar } from "@dicebear/core";
import { pixelArt } from "@dicebear/collection";

import { profileAvatarImageUrl } from "../app/model";
import type { SleiMember, SleiMessage } from "../app/types";

export type MemberAvatarIdentity = Pick<SleiMember, "id" | "name" | "handle" | "avatar"> & {
  avatarSeed?: string;
};

export type AvatarIdentity = MemberAvatarIdentity;

export type MemberAvatarImage = {
  imageRendering: "auto" | "pixelated";
  src: string;
};

export function createMemberAvatar(identity: MemberAvatarIdentity): string | undefined {
  return createMemberAvatarImage(identity)?.src;
}

export function createMemberAvatarImage(identity: MemberAvatarIdentity): MemberAvatarImage | undefined {
  const profileImageUrl = profileAvatarImageUrl(identity.avatar ?? "");
  if (profileImageUrl) {
    return {
      imageRendering: "auto",
      src: profileImageUrl,
    };
  }
  if (isProfileImageLike(identity.avatar)) return undefined;

  return {
    imageRendering: "pixelated",
    src: createAvatar(pixelArt, {
      seed: diceBearAvatarSeed(identity),
      size: 64,
      radius: 0,
    }).toDataUri(),
  };
}

function diceBearAvatarSeed(identity: MemberAvatarIdentity): string {
  const avatarSeed = identity.avatarSeed?.trim();
  if (avatarSeed) return avatarSeed;
  if (isPixelAvatar(identity.avatar)) return identity.avatar;
  return identity.id || identity.handle || identity.name || regularAvatarText(identity.avatar) || "slei-member";
}

function isPixelAvatar(avatar: string | undefined): avatar is string {
  return avatar?.startsWith("pixel-") ?? false;
}

function isProfileImageLike(avatar: string | undefined): avatar is string {
  return avatar?.startsWith("profile-image:") ?? false;
}

export function memberAvatarFallback(identity: MemberAvatarIdentity): string {
  const avatarText = regularAvatarText(identity.avatar);
  if (avatarText) {
    return avatarText;
  }

  return identity.name.slice(0, 2).toUpperCase();
}

function regularAvatarText(avatar: string | undefined): string | undefined {
  if (!avatar) return undefined;
  if (isProfileImageLike(avatar)) return undefined;
  if (isPixelAvatar(avatar)) return undefined;
  return avatar;
}

export function memberFromMessage(message: SleiMessage, members: SleiMember[]): MemberAvatarIdentity {
  const normalizedHandle = message.handle?.toLowerCase();
  const normalizedAuthor = message.author.toLowerCase();
  const member = members.find(
    (candidate) =>
      candidate.handle.toLowerCase() === normalizedHandle ||
      candidate.name.toLowerCase() === normalizedAuthor,
  );

  return member ?? {
    id: message.handle ?? message.author,
    name: message.author,
    handle: message.handle ?? message.author,
    avatar: message.avatar ?? message.author.slice(0, 2),
  };
}
