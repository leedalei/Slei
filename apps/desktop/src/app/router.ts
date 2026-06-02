export type AppView = "chat" | "search" | "tasks" | "members" | "computers" | "settings";

export const routes = ["/chat", "/search", "/tasks", "/members", "/computers", "/settings"] as const;
export type AppRoute = (typeof routes)[number];

const routeByView = {
  chat: "/chat",
  search: "/search",
  tasks: "/tasks",
  members: "/members",
  computers: "/computers",
  settings: "/settings",
} satisfies Record<AppView, AppRoute>;

const viewByRoute = Object.fromEntries(
  Object.entries(routeByView).map(([view, route]) => [route, view]),
) as Record<AppRoute, AppView>;

export function routeForView(view: AppView): AppRoute {
  return routeByView[view];
}

export function viewForPath(pathname: string): AppView {
  return viewByRoute[normalizeRoute(pathname)];
}

export function normalizeRoute(pathname: string): AppRoute {
  const normalized = normalizePathname(pathname);
  if (routes.includes(normalized as AppRoute)) {
    return normalized as AppRoute;
  }
  return "/chat";
}

function normalizePathname(pathname: string) {
  const [path = ""] = pathname.split(/[?#]/, 1);
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  return withSlash.replace(/\/+$/, "") || "/chat";
}
