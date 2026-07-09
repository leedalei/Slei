import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCleanWorkingTree,
  assertReleaseBranch,
  assertTagAvailable,
  desktopVersionJson,
  parseReleaseVersion,
  releaseDesktop,
  releaseTagForVersion,
  updateDesktopPackageJson,
} from "./release-desktop.mjs";

function assertBefore(commandKeys, first, second) {
  const firstIndex = commandKeys.indexOf(first);
  const secondIndex = commandKeys.indexOf(second);
  assert.notEqual(firstIndex, -1, `expected command: ${first}`);
  assert.notEqual(secondIndex, -1, `expected command: ${second}`);
  assert(firstIndex < secondIndex, `expected ${first} before ${second}`);
}

function normalizeCommandKey(key) {
  return key.replace(`${process.cwd()}/`, "");
}

test("accepts simple semver release versions", () => {
  assert.equal(parseReleaseVersion("0.1.1"), "0.1.1");
  assert.equal(parseReleaseVersion("12.34.56"), "12.34.56");
});

test("rejects unsupported release versions", () => {
  for (const version of ["", "v0.1.1", "0.1", "0.1.1-beta.1", "latest", "1.2.3.4"]) {
    assert.throws(() => parseReleaseVersion(version), /version must use x\.y\.z/);
  }
});

test("builds v-prefixed release tag", () => {
  assert.equal(releaseTagForVersion("0.1.1"), "v0.1.1");
});

test("updates desktop package json version and preserves newline", () => {
  const input = JSON.stringify(
    {
      name: "@slei/desktop",
      version: "0.1.0",
      private: true,
      scripts: { "package:mac": "scripts/package-macos.sh dmg zip" },
      dependencies: { react: "^19.2.6" },
    },
    null,
    2,
  ) + "\n";
  const output = updateDesktopPackageJson(input, "0.1.1");
  const parsed = JSON.parse(output);
  assert.equal(parsed.version, "0.1.1");
  assert.equal(parsed.name, "@slei/desktop");
  assert.equal(parsed.private, true);
  assert.deepEqual(parsed.scripts, { "package:mac": "scripts/package-macos.sh dmg zip" });
  assert.deepEqual(parsed.dependencies, { react: "^19.2.6" });
  assert(output.endsWith("\n"));
});

test("returns desktop version from package json", () => {
  assert.equal(desktopVersionJson('{"version":"0.1.1"}'), "0.1.1");
});

test("rejects package json without a string version", () => {
  assert.throws(() => desktopVersionJson("{}"), /missing version/);
  assert.throws(() => desktopVersionJson('{"version":1}'), /missing version/);
});

test("requires releases from master", () => {
  assert.doesNotThrow(() => assertReleaseBranch("master"));
  assert.throws(() => assertReleaseBranch("feature/release"), /must be created from master/);
  assert.throws(() => assertReleaseBranch(""), /detached/);
});

test("requires a clean working tree", () => {
  assert.doesNotThrow(() => assertCleanWorkingTree(""));
  assert.throws(() => assertCleanWorkingTree(" M package.json"), /working tree must be clean/);
});

test("rejects duplicate local or origin tags", () => {
  assert.doesNotThrow(() => assertTagAvailable("v0.1.1", { localExists: false, remoteOutput: "" }));
  assert.throws(() => assertTagAvailable("v0.1.1", { localExists: true, remoteOutput: "" }), /local tag already exists/);
  assert.throws(
    () => assertTagAvailable("v0.1.1", { localExists: false, remoteOutput: "abc refs/tags/v0.1.1" }),
    /origin tag already exists/,
  );
});

test("releaseDesktop checks safety gates before writing and pushes branch then tag", async () => {
  const calls = [];
  const writes = [];
  const packageJson = JSON.stringify(
    {
      name: "@slei/desktop",
      version: "0.1.0",
      scripts: { test: "vitest run" },
      dependencies: { react: "^19.2.6" },
    },
    null,
    2,
  ) + "\n";

  await releaseDesktop("0.1.1", {
    readFile: async (filePath) => {
      calls.push(["readFile", filePath]);
      return packageJson;
    },
    writeFile: async (filePath, content) => {
      calls.push(["writeFile", filePath]);
      writes.push({ filePath, content });
    },
    localTagExists: () => {
      calls.push(["localTagExists", "v0.1.1"]);
      return false;
    },
    log: () => {},
    run: (command, args) => {
      calls.push([command, ...args]);
      const key = [command, ...args].join(" ");
      if (key === "git rev-parse --is-inside-work-tree") return "true";
      if (key === "git branch --show-current") return "master";
      if (key === "git status --porcelain") return "";
      if (key === "git ls-remote --tags origin v0.1.1") return "";
      return "";
    },
  });

  const commandKeys = calls.map((call) => normalizeCommandKey(call.join(" ")));
  assertBefore(commandKeys, "git status --porcelain", "writeFile apps/desktop/package.json");
  assertBefore(commandKeys, "git ls-remote --tags origin v0.1.1", "writeFile apps/desktop/package.json");
  assertBefore(commandKeys, "bash scripts/verify-macos-package.sh", "git commit -m chore(release): v0.1.1");
  assertBefore(commandKeys, "node scripts/verify-release-workflow.mjs", "git commit -m chore(release): v0.1.1");
  assertBefore(commandKeys, "node --test scripts/release-desktop.test.mjs", "git commit -m chore(release): v0.1.1");
  assertBefore(commandKeys, "git add apps/desktop/package.json", "git commit -m chore(release): v0.1.1");
  assertBefore(commandKeys, "git push origin master", "git push origin v0.1.1");
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(writes[0].content).version, "0.1.1");
  assert.deepEqual(JSON.parse(writes[0].content).scripts, { test: "vitest run" });
});
