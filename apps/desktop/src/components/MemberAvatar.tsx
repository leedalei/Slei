import { createMemberAvatar, type AvatarIdentity } from "./member-avatar";

export function MemberAvatar({ identity, large = false }: { identity: AvatarIdentity; large?: boolean }) {
  const fallback = identity.avatar || identity.name.slice(0, 2);
  return (
    <span className={`slei-avatar${large ? " slei-avatar--large" : ""}`} title={identity.name}>
      <img alt="" aria-hidden="true" className="slei-avatar__image" src={createMemberAvatar(identity)} />
      <span className="slei-avatar__fallback">{fallback}</span>
    </span>
  );
}
