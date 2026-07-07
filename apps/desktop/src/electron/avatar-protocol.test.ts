import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  defaultAvatarDataRoot,
  profileAvatarFileFromUri,
  profileAvatarMime,
  profileAvatarProtocolResponse,
} from "./avatar-protocol";

describe("avatar protocol", () => {
  it("accepts only hashed image filenames", () => {
    const hash = "a".repeat(64);

    expect(profileAvatarMime(`${hash}.png`)).toBe("image/png");
    expect(profileAvatarMime(`${hash}.jpg`)).toBe("image/jpeg");
    expect(profileAvatarMime(`${hash}.jpeg`)).toBe("image/jpeg");
    expect(profileAvatarMime(`${hash}.webp`)).toBe("image/webp");
    expect(profileAvatarMime("avatar.png")).toBeUndefined();
    expect(profileAvatarMime(`${hash}.svg`)).toBeUndefined();
  });

  it("rejects traversal and query strings", async () => {
    const root = await mkdtemp(join(tmpdir(), "slei-avatar-protocol-invalid-"));
    await mkdir(join(root, "profile", "avatars"), { recursive: true });

    try {
      expect(await profileAvatarFileFromUri(root, "slei-avatar:///../secret.png")).toBeUndefined();
      expect(await profileAvatarFileFromUri(root, `slei-avatar:///${"a".repeat(64)}.png?x=1`)).toBeUndefined();
      expect(await profileAvatarFileFromUri(root, `slei-avatar:///${"a".repeat(64)}/nested.png`)).toBeUndefined();
      expect(await profileAvatarFileFromUri(root, `slei-avatar:///${"a".repeat(64)}.gif`)).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("serves valid avatar files from the profile avatar directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "slei-avatar-protocol-valid-"));
    const avatars = join(root, "profile", "avatars");
    const fileName = `${"b".repeat(64)}.png`;
    const bytes = Buffer.from("\x89PNG\r\n\x1a\navatar-bytes");
    await mkdir(avatars, { recursive: true });
    await writeFile(join(avatars, fileName), bytes);

    try {
      const resolved = await profileAvatarFileFromUri(root, `slei-avatar:///${fileName}`);
      const response = await profileAvatarProtocolResponse(root, `slei-avatar:///${fileName}`);

      expect(resolved).toBe(await realpath(join(avatars, fileName)));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns 404 for missing or escaped avatar files", async () => {
    const root = await mkdtemp(join(tmpdir(), "slei-avatar-protocol-missing-"));
    await mkdir(join(root, "profile", "avatars"), { recursive: true });

    try {
      const missing = await profileAvatarProtocolResponse(root, `slei-avatar:///${"c".repeat(64)}.webp`);

      expect(missing.status).toBe(404);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects symlinks that escape the avatar directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "slei-avatar-protocol-symlink-"));
    const avatars = join(root, "profile", "avatars");
    const outside = join(root, "outside", "secret.png");
    const fileName = `${"d".repeat(64)}.png`;
    await mkdir(avatars, { recursive: true });
    await mkdir(join(root, "outside"), { recursive: true });
    await writeFile(outside, "outside-avatar-bytes");

    try {
      await symlink(outside, join(avatars, fileName));

      expect(await profileAvatarFileFromUri(root, `slei-avatar:///${fileName}`)).toBeUndefined();
      expect((await profileAvatarProtocolResponse(root, `slei-avatar:///${fileName}`)).status).toBe(404);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects avatar directories that are symlinks outside the data root", async () => {
    const root = await mkdtemp(join(tmpdir(), "slei-avatar-protocol-dir-symlink-"));
    const outside = join(root, "outside");
    const profile = join(root, "profile");
    const fileName = `${"e".repeat(64)}.png`;
    await mkdir(outside, { recursive: true });
    await mkdir(profile, { recursive: true });
    await writeFile(join(outside, fileName), "outside-avatar-bytes");

    try {
      await symlink(outside, join(profile, "avatars"));

      expect(await profileAvatarFileFromUri(root, `slei-avatar:///${fileName}`)).toBeUndefined();
      expect((await profileAvatarProtocolResponse(root, `slei-avatar:///${fileName}`)).status).toBe(404);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the daemon-compatible default data root", () => {
    expect(defaultAvatarDataRoot({ SLEI_DATA_ROOT: "/tmp/slei-data" }, "/Users/lei")).toBe("/tmp/slei-data");
    expect(defaultAvatarDataRoot({}, "/Users/lei")).toBe("/Users/lei/.slei");
    expect(defaultAvatarDataRoot({}, undefined)).toBe(".slei");
  });
});
