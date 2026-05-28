export const routes = ["/chat", "/tasks", "/members", "/computers", "/settings"] as const;

export type AppRoute = (typeof routes)[number];
