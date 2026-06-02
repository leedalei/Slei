import { describe, expect, it } from "vitest";

import { normalizeRoute, routeForView, routes, viewForPath } from "../src/app/router";

describe("desktop browser routes", () => {
  it("maps every app view to a stable URL route", () => {
    expect(routes).toEqual(["/chat", "/search", "/tasks", "/members", "/computers", "/settings"]);
    expect(routeForView("chat")).toBe("/chat");
    expect(routeForView("search")).toBe("/search");
    expect(routeForView("tasks")).toBe("/tasks");
    expect(routeForView("members")).toBe("/members");
    expect(routeForView("computers")).toBe("/computers");
    expect(routeForView("settings")).toBe("/settings");
  });

  it("resolves URL paths to app views with chat as the fallback", () => {
    expect(viewForPath("/")).toBe("chat");
    expect(viewForPath("/chat")).toBe("chat");
    expect(viewForPath("/search")).toBe("search");
    expect(viewForPath("/tasks")).toBe("tasks");
    expect(viewForPath("/members")).toBe("members");
    expect(viewForPath("/computers")).toBe("computers");
    expect(viewForPath("/settings")).toBe("settings");
    expect(viewForPath("/unknown")).toBe("chat");
  });

  it("normalizes supported and unsupported paths to browser routes", () => {
    expect(normalizeRoute("/")).toBe("/chat");
    expect(normalizeRoute("/tasks")).toBe("/tasks");
    expect(normalizeRoute("/settings?tab=about")).toBe("/settings");
    expect(normalizeRoute("members")).toBe("/members");
    expect(normalizeRoute("/missing")).toBe("/chat");
  });
});
