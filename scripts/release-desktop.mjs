import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP_PACKAGE_JSON = path.join(REPO_ROOT, "apps/desktop/package.json");
const DESKTOP_PACKAGE_JSON_GIT_PATH = "apps/desktop/package.json";

export function parseReleaseVersion(rawVersion) {
  if (typeof rawVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(rawVersion)) {
    throw new Error("version must use x.y.z");
  }
  return rawVersion;
}

export function releaseTagForVersion(version) {
  return `v${parseReleaseVersion(version)}`;
}

export function updateDesktopPackageJson(content, version) {
  const parsed = JSON.parse(content);
  parsed.version = parseReleaseVersion(version);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function desktopVersionJson(content) {
  const parsed = JSON.parse(content);
  if (typeof parsed.version !== "string") {
    throw new Error("desktop package.json missing version");
  }
  return parsed.version;
}

export function assertReleaseBranch(branch) {
  if (branch !== "master") {
    throw new Error(`desktop releases must be created from master; current branch is ${branch || "(detached)"}`);
  }
}

export function assertCleanWorkingTree(status) {
  if (status.length > 0) {
    throw new Error("working tree must be clean before releasing");
  }
}

export function assertTagAvailable(tag, { localExists, remoteOutput }) {
  if (localExists) {
    throw new Error(`local tag already exists: ${tag}`);
  }
  if (remoteOutput.length > 0) {
    throw new Error(`origin tag already exists: ${tag}`);
  }
}

function defaultRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(output || `${command} ${args.join(" ")} failed`);
  }

  return (result.stdout ?? "").trim();
}

function defaultLocalTagExists(tag) {
  return (
    spawnSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    }).status === 0
  );
}

export async function releaseDesktop(rawVersion, dependencies = {}) {
  const {
    readFile = fs.readFile,
    writeFile = fs.writeFile,
    run = defaultRun,
    localTagExists = defaultLocalTagExists,
    log = console.log,
  } = dependencies;

  const version = parseReleaseVersion(rawVersion);
  const tag = releaseTagForVersion(version);

  run("git", ["rev-parse", "--is-inside-work-tree"], { capture: true });

  const branch = run("git", ["branch", "--show-current"], { capture: true });
  assertReleaseBranch(branch);

  const status = run("git", ["status", "--porcelain"], { capture: true });
  assertCleanWorkingTree(status);

  const localExists = localTagExists(tag);
  const remoteTag = run("git", ["ls-remote", "--tags", "origin", tag], { capture: true });
  assertTagAvailable(tag, { localExists, remoteOutput: remoteTag });

  const packageJson = await readFile(DESKTOP_PACKAGE_JSON, "utf8");
  await writeFile(DESKTOP_PACKAGE_JSON, updateDesktopPackageJson(packageJson, version));

  run("bash", ["scripts/verify-macos-package.sh"]);
  run("node", ["scripts/verify-release-workflow.mjs"]);
  run("node", ["--test", "scripts/verify-release-workflow.test.mjs"]);
  run("node", ["--test", "scripts/release-desktop.test.mjs"]);

  run("git", ["add", DESKTOP_PACKAGE_JSON_GIT_PATH]);
  run("git", ["commit", "--allow-empty", "-m", `chore(release): ${tag}`]);
  run("git", ["tag", tag]);
  run("git", ["push", "origin", "master"]);
  run("git", ["push", "origin", tag]);

  log(`Release ${tag} pushed. GitHub Actions will publish desktop assets.`);
}

async function main() {
  const version = process.argv[2];
  if (!version) {
    throw new Error("usage: pnpm release:desktop <x.y.z>");
  }
  await releaseDesktop(version);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
