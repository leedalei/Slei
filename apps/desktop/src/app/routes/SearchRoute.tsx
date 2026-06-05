import { SearchPage } from "../../features/search/SearchPageView";

export function SearchRoute(props: Parameters<typeof SearchPage>[0]) {
  return <SearchPage {...props} />;
}
