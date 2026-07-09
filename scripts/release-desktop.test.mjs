import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCleanWorkingTree,
  assertReleaseBranch,
  assertTagAvailable,
  desktopVersionJson,
  parseReleaseVersion,
  releaseTagForVersion,
  updateDesktopPackageJson,
} from "./release-desktop.mjs";

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
  const input = JSON.stringify({ name: "@slei/desktop", version: "0.1.0", private: true }, null, 2) + "\n";
  const output = updateDesktopPackageJson(input, "0.1.1");
  assert.equal(JSON.parse(output).version, "0.1.1");
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
