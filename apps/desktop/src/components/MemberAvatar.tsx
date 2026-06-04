import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { createMemberAvatar, type MemberAvatarIdentity } from "./member-avatar";

export function MemberAvatar(input: { identity: MemberAvatarIdentity; large?: boolean }) {
  const { identity, large = false } = input;
  const fallback = identity.avatar ?? identity.name.slice(0, 2).toUpperCase();
  return (
    <Avatar
      className={large ? "size-16" : "size-8"}
      data-avatar-image-rendering="pixelated"
      data-avatar-size={large ? "large" : "default"}
      title={identity.name}
    >
      <AvatarImage alt="" className="[image-rendering:pixelated]" src={createMemberAvatar(identity)} />
      <AvatarFallback>{fallback}</AvatarFallback>
    </Avatar>
  );
}
