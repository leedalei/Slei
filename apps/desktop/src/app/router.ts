import type { AppView as AppViewType } from "./model";

export const routeItems = [
  { path: "/chat", view: "chat" },
  { path: "/search", view: "search" },
  { path: "/tasks", view: "tasks" },
  { path: "/members", view: "members" },
  { path: "/computers", view: "computers" },
  { path: "/settings", view: "settings" },
] as const satisfies ReadonlyArray<{ path: `/${string}`; view: AppViewType }>;

export const routes = routeItems.map((item) => item.path);
export type AppRoute = (typeof routeItems)[number]["path"];

const routeByView = Object.fromEntries(routeItems.map((item) => [item.view, item.path])) as Record<AppViewType, AppRoute>;
const viewByRoute = Object.fromEntries(routeItems.map((item) => [item.path, item.view])) as Record<AppRoute, AppViewType>;

export function routePathForView(view: AppViewType): AppRoute {
  return routeByView[view];
}

export function routeViewFromPath(pathname: string): AppViewType {
  return viewByRoute[normalizeRoute(pathname)];
}

export const routeForView = routePathForView;
export const viewForPath = routeViewFromPath;

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

export type AppView = AppViewType;
