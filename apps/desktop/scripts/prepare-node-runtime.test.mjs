import assert from "node:assert/strict";
import { test } from "node:test";

import { parseExpectedChecksum } from "./prepare-node-runtime.mjs";

test("parseExpectedChecksum finds the pinned darwin arm64 archive checksum", () => {
  const checksum = parseExpectedChecksum(
    [
      "1111111111111111111111111111111111111111111111111111111111111111  node-v22.23.1-aix-ppc64.tar.gz",
      "ef28d8fab2c0e4314522d4bb1b7173270aa3937e93b92cb7de79c112ac1fa953  node-v22.23.1-darwin-arm64.tar.gz",
    ].join("\n"),
    "node-v22.23.1-darwin-arm64.tar.gz",
  );

  assert.equal(checksum, "ef28d8fab2c0e4314522d4bb1b7173270aa3937e93b92cb7de79c112ac1fa953");
});

test("parseExpectedChecksum fails clearly when the archive is absent", () => {
  assert.throws(
    () => parseExpectedChecksum("", "node-v22.23.1-darwin-arm64.tar.gz"),
    /does not include node-v22\.23\.1-darwin-arm64\.tar\.gz/,
  );
});
