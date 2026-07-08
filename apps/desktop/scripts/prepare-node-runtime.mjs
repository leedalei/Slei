#!/usr/bin/env node
import { createReadStream, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { access, chmod, copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { get } from "node:https";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultDesktopRoot = resolve(scriptDir, "..");

export async function prepareNodeRuntime(options = {}) {
  const desktopRoot = options.desktopRoot ?? defaultDesktopRoot;
  const versionFile = resolve(desktopRoot, "build/node-runtime-version.txt");
  const cacheRoot = resolve(desktopRoot, ".cache/node-runtime");
  const nativeNodeRoot = resolve(desktopRoot, "dist-native/darwin-arm64/node");

  const version = (await readFile(versionFile, "utf8")).trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Node runtime version must be an exact x.y.z version, got ${JSON.stringify(version)}`);
  }

  const archiveName = `node-v${version}-darwin-arm64.tar.gz`;
  const archivePath = resolve(cacheRoot, archiveName);
  const extractRoot = resolve(cacheRoot, "extract");
  const extractedNodeRoot = resolve(extractRoot, `node-v${version}-darwin-arm64`);
  const downloadUrl = `https://nodejs.org/dist/v${version}/${archiveName}`;
  const shasumsUrl = `https://nodejs.org/dist/v${version}/SHASUMS256.txt`;

  await mkdir(cacheRoot, { recursive: true });
  const expectedChecksum = parseExpectedChecksum(await downloadText(shasumsUrl), archiveName);
  await downloadIfMissing(downloadUrl, archivePath);
  await verifyArchiveChecksum({ archivePath, archiveName, expectedChecksum, downloadUrl });

  await rm(extractRoot, { recursive: true, force: true });
  await mkdir(extractRoot, { recursive: true });
  await execFileAsync("tar", ["-xzf", archivePath, "-C", extractRoot]);
  await access(resolve(extractedNodeRoot, "bin/node"));

  await rm(nativeNodeRoot, { recursive: true, force: true });
  await mkdir(resolve(nativeNodeRoot, "bin"), { recursive: true });
  await copyFile(resolve(extractedNodeRoot, "bin/node"), resolve(nativeNodeRoot, "bin/node"));
  await copyIfExists(resolve(extractedNodeRoot, "LICENSE"), resolve(nativeNodeRoot, "LICENSE"));
  await copyIfExists(resolve(extractedNodeRoot, "README.md"), resolve(nativeNodeRoot, "README.md"));
  await chmod(resolve(nativeNodeRoot, "bin/node"), 0o755);

  const { stdout } = await execFileAsync(resolve(nativeNodeRoot, "bin/node"), ["-v"]);
  const copiedVersion = stdout.trim();
  if (copiedVersion !== `v${version}`) {
    throw new Error(`prepared Node runtime version mismatch: expected v${version}, got ${copiedVersion || "no output"}`);
  }
  process.stdout.write(`prepared Node runtime ${copiedVersion} at ${nativeNodeRoot}\n`);
}

export function parseExpectedChecksum(shasums, archiveName) {
  for (const line of shasums.split("\n")) {
    const [checksum, name] = line.trim().split(/\s+/);
    if (name === archiveName) {
      return checksum;
    }
  }
  throw new Error(`SHASUMS256.txt does not include ${archiveName}`);
}

async function downloadIfMissing(url, destination) {
  try {
    const cached = await stat(destination);
    if (cached.isFile() && cached.size > 0) {
      process.stdout.write(`using cached Node runtime archive: ${destination}\n`);
      return;
    }
  } catch {
    // Cache miss, download below.
  }

  const temporaryPath = `${destination}.tmp`;
  await rm(temporaryPath, { force: true });
  process.stdout.write(`downloading ${url}\n`);
  await pipeline(await request(url), createWriteStream(temporaryPath));
  await copyFile(temporaryPath, destination);
  await rm(temporaryPath, { force: true });
}

async function verifyArchiveChecksum({ archivePath, archiveName, expectedChecksum, downloadUrl }) {
  let actualChecksum = await sha256File(archivePath);
  if (actualChecksum === expectedChecksum) {
    return;
  }

  await rm(archivePath, { force: true });
  process.stdout.write(`cached Node runtime archive checksum mismatch; downloading ${archiveName} again\n`);
  await downloadIfMissing(downloadUrl, archivePath);
  actualChecksum = await sha256File(archivePath);
  if (actualChecksum !== expectedChecksum) {
    throw new Error(
      `Node runtime archive checksum mismatch for ${archiveName}: expected ${expectedChecksum}, got ${actualChecksum}`,
    );
  }
}

function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

async function downloadText(url) {
  const chunks = [];
  const response = await request(url);
  response.setEncoding("utf8");
  for await (const chunk of response) {
    chunks.push(chunk);
  }
  return chunks.join("");
}

function request(url, redirects = 0) {
  return new Promise((resolveRequest, reject) => {
    get(url, (response) => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        if (redirects > 5) {
          reject(new Error(`too many redirects while downloading ${url}`));
          return;
        }
        resolveRequest(request(new URL(response.headers.location, url).toString(), redirects + 1));
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`download failed for ${url}: HTTP ${status}`));
        return;
      }
      resolveRequest(response);
    }).on("error", reject);
  });
}

async function copyIfExists(source, destination) {
  try {
    await copyFile(source, destination);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  prepareNodeRuntime().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
