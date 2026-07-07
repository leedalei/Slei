import { lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";

const AVATAR_URI_PREFIX = "slei-avatar:///";
const HASHED_AVATAR_PATTERN = /^[a-fA-F0-9]{64}\.(png|jpg|jpeg|webp)$/;

export function defaultAvatarDataRoot(
  env: { SLEI_DATA_ROOT?: string } = process.env,
  home?: string,
): string {
  const configured = env.SLEI_DATA_ROOT?.trim();
  if (configured) return configured;
  if (arguments.length < 2) {
    home = homedir();
  }
  return home ? join(home, ".slei") : ".slei";
}

export function profileAvatarMime(fileName: string): string | undefined {
  if (!HASHED_AVATAR_PATTERN.test(fileName)) {
    return undefined;
  }

  const extension = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  return undefined;
}

export async function profileAvatarFileFromUri(dataRoot: string, uri: string): Promise<string | undefined> {
  if (uri.includes("?") || uri.includes("#")) {
    return undefined;
  }

  const fileName = uri.startsWith(AVATAR_URI_PREFIX) ? uri.slice(AVATAR_URI_PREFIX.length) : undefined;
  if (
    !fileName ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes("..") ||
    !profileAvatarMime(fileName)
  ) {
    return undefined;
  }

  try {
    const dataRootPath = await realpath(dataRoot);
    const profileDir = join(dataRootPath, "profile");
    const avatarDir = join(profileDir, "avatars");
    if (
      (await lstat(profileDir)).isSymbolicLink() ||
      (await lstat(avatarDir)).isSymbolicLink() ||
      await realpath(avatarDir) !== avatarDir
    ) {
      return undefined;
    }
    const candidate = await realpath(join(avatarDir, fileName));
    const candidateRelative = relative(avatarDir, candidate);
    if (
      candidateRelative.startsWith("..") ||
      candidateRelative === "" ||
      candidateRelative.includes(`..${sep}`)
    ) {
      return undefined;
    }
    return candidate;
  } catch {
    return undefined;
  }
}

export async function profileAvatarProtocolResponse(
  dataRoot: string,
  uri: string,
): Promise<Response> {
  const filePath = await profileAvatarFileFromUri(dataRoot, uri);
  const fileName = filePath?.split(/[\\/]/).at(-1);
  const mime = fileName ? profileAvatarMime(fileName) : undefined;
  if (!filePath || !mime) {
    return profileAvatarNotFoundResponse();
  }

  try {
    const bytes = await readFile(filePath);
    return new Response(bytes, {
      status: 200,
      headers: { "content-type": mime },
    });
  } catch {
    return profileAvatarNotFoundResponse();
  }
}

function profileAvatarNotFoundResponse(): Response {
  return new Response(null, { status: 404 });
}
