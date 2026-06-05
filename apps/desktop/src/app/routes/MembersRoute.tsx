import { MembersPage } from "../../features/members/MembersPageView";

export function MembersRoute(props: Parameters<typeof MembersPage>[0]) {
  return <MembersPage {...props} />;
}
