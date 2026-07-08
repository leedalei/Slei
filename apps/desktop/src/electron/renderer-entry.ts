import { join } from "node:path";

export type RendererEntry = { kind: "url"; value: string } | { kind: "file"; value: string };

export function resolveRendererEntry({
  isPackaged,
  devUrl,
  appPath,
}: {
  isPackaged: boolean;
  devUrl: string;
  appPath: string;
}): RendererEntry {
  if (!isPackaged) {
    return { kind: "url", value: devUrl };
  }

  return { kind: "file", value: join(appPath, "dist", "index.html") };
}
