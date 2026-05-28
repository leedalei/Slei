import { describe, expect, test } from "vitest";

import { errorCodes, events, protocolVersion } from "./contracts";

describe("Slei protocol contract fixtures", () => {
  test("exposes the v1 protocol version", () => {
    expect(protocolVersion.version).toBe("v1");
  });

  test("exposes localized error code contracts", () => {
    expect(errorCodes).toContainEqual({
      code: "E403",
      key: "error.permission_violation",
    });
  });

  test("exposes realtime event contracts", () => {
    expect(events).toContainEqual(expect.objectContaining({ type: "approval.created" }));
  });
});
