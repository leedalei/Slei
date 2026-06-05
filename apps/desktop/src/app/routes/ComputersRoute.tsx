import { ComputersPage } from "../../features/computers/ComputersPageView";

export function ComputersRoute(props: Parameters<typeof ComputersPage>[0]) {
  return <ComputersPage {...props} />;
}
