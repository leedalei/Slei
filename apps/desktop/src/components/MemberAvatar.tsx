import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { createMemberAvatar, type MemberAvatarIdentity } from "./member-avatar";

export function MemberAvatar(input: { identity: MemberAvatarIdentity; large?: boolean }) {
  const { identity, large = false } = input;
  const fallback = identity.avatar ?? identity.name.slice(0, 2).toUpperCase();
  return (
    <Avatar className={large ? "size-16" : "size-9"} title={identity.name}>
      <AvatarImage alt="" src={createMemberAvatar(identity)} />
      <AvatarFallback>{fallback}</AvatarFallback>
    </Avatar>
  );
}
