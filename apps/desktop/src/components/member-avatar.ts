import { createAvatar } from "@dicebear/core";
import { pixelArt } from "@dicebear/collection";

import type { SleiMember, SleiMessage } from "../app/fixtures";

export type AvatarIdentity = Pick<SleiMember, "id" | "name" | "handle" | "avatar"> & {
  avatarSeed?: string;
};

export function createMemberAvatar(identity: AvatarIdentity): string {
  const seed = identity.avatarSeed?.trim() || identity.id || identity.handle || identity.name || identity.avatar || "slei-member";
  return createAvatar(pixelArt, {
    seed,
    size: 64,
    radius: 0,
  }).toDataUri();
}

export function memberFromMessage(message: SleiMessage, members: SleiMember[]): AvatarIdentity {
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
