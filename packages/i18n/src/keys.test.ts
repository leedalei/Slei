import { describe, expect, test } from "vitest";

import { defaultLocale, enUS, flattenKeys, zhCN } from "./index";

describe("Slei locale resources", () => {
  test("defaults to Simplified Chinese", () => {
    expect(defaultLocale).toBe("zh-CN");
  });

  test("keeps zh-CN and en-US key sets identical", () => {
    expect(flattenKeys(enUS)).toEqual(flattenKeys(zhCN));
  });

  test("contains MVP baseline vocabulary", () => {
    const keys = flattenKeys(zhCN);
    expect(keys).toEqual(
      expect.arrayContaining([
        "nav.chat",
        "nav.tasks",
        "task.status.todo",
        "task.status.in_progress",
        "approval.pending",
        "onboarding.profile.nickname",
        "error.permission_violation",
        "message.deleted",
      ]),
    );
  });
});
