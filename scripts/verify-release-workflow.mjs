import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_WORKFLOW_PATH = ".github/workflows/release.yml";

function hasAll(content, fragments) {
  return fragments.every((fragment) => content.includes(fragment));
}

function pushViolation(violations, message) {
  violations.push({ message });
}

export function analyzeReleaseWorkflow(content) {
  const violations = [];

  if (!hasAll(content, ["on:", "push:", "tags:", "v*.*.*"])) {
    pushViolation(violations, "release workflow must trigger on v*.*.* tags");
  }

  if (!content.includes("macos-15-xlarge")) {
    pushViolation(violations, "release workflow must use macos-15-xlarge");
  }

  if (!hasAll(content, ["permissions:", "contents: write"])) {
    pushViolation(violations, "release workflow must grant contents: write");
  }

  if (
    !hasAll(content, [
      "GITHUB_REF_NAME#v",
      "apps/desktop/package.json",
      'test "$TAG_VERSION" = "$PACKAGE_VERSION"',
    ])
  ) {
    pushViolation(violations, "release workflow must verify tag version matches apps/desktop/package.json version");
  }

  if (!content.includes("bash scripts/verify-macos-package.sh")) {
    pushViolation(violations, "release workflow must run bash scripts/verify-macos-package.sh");
  }

  if (!content.includes("pnpm --filter @slei/desktop package:mac")) {
    pushViolation(violations, "release workflow must run pnpm --filter @slei/desktop package:mac");
  }

  if (!content.includes("shasum -a 256 Slei-* > SHA256SUMS.txt")) {
    pushViolation(violations, "release workflow must generate SHA256SUMS.txt");
  }

  if (!content.includes("gh release create")) {
    pushViolation(violations, "release workflow must create a GitHub Release with gh release create");
  }

  if (!hasAll(content, ["GH_TOKEN:", "github.token"])) {
    pushViolation(violations, "release workflow must set GH_TOKEN: ${{ github.token }} for gh release create");
  }

  for (const flag of ["--verify-tag", "--fail-on-no-commits", "--generate-notes"]) {
    if (!content.includes(flag)) {
      pushViolation(violations, `release workflow must pass ${flag}`);
    }
  }

  for (const asset of [
    "apps/desktop/release/Slei-*.dmg",
    "apps/desktop/release/Slei-*.zip",
    "apps/desktop/release/SHA256SUMS.txt",
  ]) {
    if (!content.includes(asset)) {
      pushViolation(violations, `release workflow must upload ${asset}`);
    }
  }

  return violations;
}

export async function verifyReleaseWorkflow({
  workflowPath = DEFAULT_WORKFLOW_PATH,
  cwd = process.cwd(),
} = {}) {
  const absolutePath = path.resolve(cwd, workflowPath);

  let content;
  try {
    content = await fs.readFile(absolutePath, "utf8");
  } catch {
    return [{ message: `release workflow file missing: ${workflowPath}` }];
  }

  return analyzeReleaseWorkflow(content);
}

async function main() {
  const violations = await verifyReleaseWorkflow();

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(violation.message);
    }
    process.exit(1);
  }

  console.log("release workflow verified");
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
