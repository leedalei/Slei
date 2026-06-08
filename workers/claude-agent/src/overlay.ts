import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import type { RuntimeSession, WorkspaceMount } from "./protocol.js";

export type PreparedWorkspace = {
  cwd: string;
  agentWorkspacePath: string;
  additionalDirectories: string[];
  runtimeContext: string;
};

type CanonicalMount = WorkspaceMount & {
  realPath: string;
  kind: "directory" | "file";
  slug: string;
  overlayPath: string;
};

type SkillSource = {
  sourceKind: "agent" | "project";
  workspaceSlug: string;
  workspaceLabel: string;
  skillName: string;
  skillSlug: string;
  skillPath: string;
  realSkillPath: string;
  priority: number;
};

export function prepareWorkspace(session: RuntimeSession): PreparedWorkspace {
  const agentWorkspacePath = realpathOrOriginal(session.agent_workspace_path ?? session.cwd);
  const mounts = canonicalMounts(session.workspace_mounts ?? []);
  if (mounts.length === 0) {
    return {
      cwd: session.cwd,
      agentWorkspacePath,
      additionalDirectories: uniquePaths([...(session.additional_directories ?? []), agentWorkspacePath]),
      runtimeContext: buildRuntimeContext(session, agentWorkspacePath, []),
    };
  }

  const projectDirectories = mounts.filter((mount) => mount.kind === "directory");
  const linkedFiles = mounts.filter((mount) => mount.kind === "file");
  const workspaceSetHash = hashLines([
    "directories",
    ...projectDirectories.map((mount) => mount.realPath).sort(),
    "files",
    ...linkedFiles.map((mount) => mount.realPath).sort(),
  ]);
  const overlayHome = process.env.SLEI_OVERLAY_HOME ?? join(homedir(), ".slei", "runtime", "overlays");
  const workspaceSetRoot = join(overlayHome, "workspace-sets", workspaceSetHash);
  writeWorkspaceSetOverlay(workspaceSetRoot, projectDirectories, linkedFiles);

  const primaryProjectPath = session.primary_project_path
    ? realpathOrOriginal(session.primary_project_path)
    : projectDirectories[0]?.realPath;
  const runHash = hashLines([
    workspaceSetHash,
    session.channel_id ?? "",
    session.agent_id,
    agentWorkspacePath,
    primaryProjectPath ?? "",
    ...discoverSkillSources(agentWorkspacePath, projectDirectories, primaryProjectPath).map((skill) => skill.realSkillPath).sort(),
  ]);
  const runOverlayRoot = join(overlayHome, "runs", safeSegment(session.channel_id ?? "dm"), safeSegment(session.agent_id), runHash);
  writeRunOverlay(runOverlayRoot, workspaceSetRoot, agentWorkspacePath, projectDirectories, primaryProjectPath);

  return {
    cwd: runOverlayRoot,
    agentWorkspacePath,
    additionalDirectories: uniquePaths([
      runOverlayRoot,
      ...projectDirectories.map((mount) => mount.realPath),
      ...linkedFiles.map((mount) => mount.realPath),
      agentWorkspacePath,
      ...(session.additional_directories ?? []),
    ]),
    runtimeContext: buildRuntimeContext(session, agentWorkspacePath, mounts, primaryProjectPath),
  };
}

export function buildRuntimeContext(
  session: RuntimeSession,
  agentWorkspacePath: string,
  mounts: readonly CanonicalMount[] = [],
  primaryProjectPath?: string,
): string {
  const sections = [
    "Slei runtime context:",
    `- Agent id: ${session.agent_id}`,
    session.channel_id ? `- Channel id: ${session.channel_id}` : undefined,
    session.channel_name ? `- Channel name: ${session.channel_name}` : undefined,
    `- Agent workspace: ${agentWorkspacePath}`,
    primaryProjectPath ? `- Primary project: ${primaryProjectPath}` : undefined,
  ].filter(Boolean);

  if (mounts.length > 0) {
    sections.push(
      "Mounted paths:",
      ...mounts.map((mount) => `- ${mount.overlayPath} -> ${mount.realPath}`),
    );
  }

  const memoryPath = join(agentWorkspacePath, "MEMORY.md");
  if (existsSync(memoryPath)) {
    sections.push(`Agent MEMORY.md:\n${readFileSync(memoryPath, "utf8")}`);
  }

  const skillMeta = loadAgentSkillMeta(agentWorkspacePath);
  if (skillMeta.length > 0) {
    sections.push(["Agent skill metadata:", ...skillMeta.map((skill) => `- ${skill.name}: ${skill.description}`)].join("\n"));
  }

  return sections.join("\n");
}

function writeWorkspaceSetOverlay(root: string, projectDirectories: CanonicalMount[], linkedFiles: CanonicalMount[]) {
  const tmpRoot = `${root}.tmp-${process.pid}`;
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(join(tmpRoot, "workspaces"), { recursive: true });
  mkdirSync(join(tmpRoot, "files"), { recursive: true });
  mkdirSync(join(tmpRoot, ".claude"), { recursive: true });

  for (const mount of projectDirectories) {
    symlinkSync(mount.realPath, join(tmpRoot, mount.overlayPath));
  }
  for (const mount of linkedFiles) {
    symlinkSync(mount.realPath, join(tmpRoot, mount.overlayPath));
  }
  writeFileSync(join(tmpRoot, "CLAUDE.md"), workspaceSetClaude(projectDirectories, linkedFiles), "utf8");

  replaceDirectory(tmpRoot, root);
}

function writeRunOverlay(
  root: string,
  workspaceSetRoot: string,
  agentWorkspacePath: string,
  projectDirectories: CanonicalMount[],
  primaryProjectPath?: string,
) {
  const tmpRoot = `${root}.tmp-${process.pid}`;
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(join(tmpRoot, ".claude", "skills"), { recursive: true });
  symlinkSync(join(workspaceSetRoot, "CLAUDE.md"), join(tmpRoot, "CLAUDE.md"));
  symlinkSync(join(workspaceSetRoot, "workspaces"), join(tmpRoot, "workspaces"));
  if (existsSync(join(workspaceSetRoot, "files"))) {
    symlinkSync(join(workspaceSetRoot, "files"), join(tmpRoot, "files"));
  }

  copyPrimarySettings(tmpRoot, primaryProjectPath);
  writeMergedSkills(join(tmpRoot, ".claude", "skills"), agentWorkspacePath, projectDirectories, primaryProjectPath);
  replaceDirectory(tmpRoot, root);
}

function writeMergedSkills(skillsRoot: string, agentWorkspacePath: string, projectDirectories: CanonicalMount[], primaryProjectPath?: string) {
  const sources = discoverSkillSources(agentWorkspacePath, projectDirectories, primaryProjectPath).sort((left, right) =>
    left.priority - right.priority || left.skillSlug.localeCompare(right.skillSlug) || left.realSkillPath.localeCompare(right.realSkillPath),
  );
  const usedNames = new Set<string>();
  const seenPaths = new Set<string>();
  for (const source of sources) {
    if (seenPaths.has(source.realSkillPath)) continue;
    seenPaths.add(source.realSkillPath);

    const targetName = uniqueSkillName(source, usedNames);
    usedNames.add(targetName);
    const targetPath = join(skillsRoot, targetName);
    if (targetName === source.skillSlug) {
      symlinkSync(source.skillPath, targetPath);
    } else {
      writeSkillWrapper(source, targetName, targetPath);
    }
  }
}

function discoverSkillSources(agentWorkspacePath: string, projectDirectories: CanonicalMount[], primaryProjectPath?: string): SkillSource[] {
  const sources: SkillSource[] = [];
  sources.push(...readSkillSources(join(agentWorkspacePath, ".claude", "skills"), {
    sourceKind: "agent",
    workspaceSlug: "agent",
    workspaceLabel: "Slei agent",
    priority: 0,
  }));

  const orderedProjects = [...projectDirectories].sort((left, right) => {
    if (primaryProjectPath) {
      if (left.realPath === primaryProjectPath) return -1;
      if (right.realPath === primaryProjectPath) return 1;
    }
    return left.slug.localeCompare(right.slug);
  });
  orderedProjects.forEach((mount, index) => {
    sources.push(...readSkillSources(join(mount.realPath, ".claude", "skills"), {
      sourceKind: "project",
      workspaceSlug: mount.slug.replace(/^\d+-/, ""),
      workspaceLabel: mount.label ?? mount.slug,
      priority: 10 + index,
    }));
  });
  return sources;
}

function readSkillSources(
  skillsRoot: string,
  input: Pick<SkillSource, "sourceKind" | "workspaceSlug" | "workspaceLabel" | "priority">,
): SkillSource[] {
  if (!existsSync(skillsRoot)) return [];
  return readDirectoryNames(skillsRoot)
    .map((entry) => {
      const skillPath = join(skillsRoot, entry);
      const skillFile = join(skillPath, "SKILL.md");
      if (!existsSync(skillFile)) return undefined;
      const raw = readFileSync(skillFile, "utf8");
      const meta = parseSkillFrontmatter(raw);
      const skillName = meta.name || entry;
      return {
        ...input,
        skillName,
        skillSlug: slugify(skillName),
        skillPath,
        realSkillPath: realpathOrOriginal(skillPath),
      };
    })
    .filter((source): source is SkillSource => Boolean(source));
}

function uniqueSkillName(source: SkillSource, usedNames: Set<string>): string {
  if (!usedNames.has(source.skillSlug)) return source.skillSlug;
  const namespaced = `${source.workspaceSlug}-${source.skillSlug}`;
  if (!usedNames.has(namespaced)) return namespaced;
  return `${namespaced}-${hashLines([source.realSkillPath]).slice(0, 8)}`;
}

function writeSkillWrapper(source: SkillSource, targetName: string, targetPath: string) {
  mkdirSync(targetPath, { recursive: true });
  const skillFile = join(source.skillPath, "SKILL.md");
  const raw = readFileSync(skillFile, "utf8");
  const parsed = splitFrontmatter(raw);
  const meta = parseSkillFrontmatter(raw);
  const description = meta.description ? `[${source.workspaceLabel}] ${meta.description}` : `Skill from ${source.workspaceLabel}.`;
  const body = [
    "---",
    `name: ${targetName}`,
    `description: ${description}`,
    "---",
    "",
    `Source skill: ${source.realSkillPath}`,
    "",
    parsed.body,
  ].join("\n");
  writeFileSync(join(targetPath, "SKILL.md"), body, "utf8");

  for (const entry of readDirectoryNames(source.skillPath)) {
    if (entry === "SKILL.md") continue;
    const from = join(source.skillPath, entry);
    const to = join(targetPath, entry);
    symlinkSync(from, to);
  }
  symlinkSync(source.skillPath, join(targetPath, "source"));
}

function copyPrimarySettings(runRoot: string, primaryProjectPath?: string) {
  const claudeRoot = join(runRoot, ".claude");
  for (const file of ["settings.json", "settings.local.json"]) {
    const source = primaryProjectPath ? join(primaryProjectPath, ".claude", file) : undefined;
    const target = join(claudeRoot, file);
    if (source && existsSync(source)) {
      copyFileSync(source, target);
    } else if (file === "settings.json") {
      writeFileSync(target, "{}\n", "utf8");
    }
  }
}

function workspaceSetClaude(projectDirectories: CanonicalMount[], linkedFiles: CanonicalMount[]): string {
  const instructionPaths = projectDirectories.flatMap((mount) => [
    `- \`${mount.overlayPath}/CLAUDE.md\``,
    `- \`${mount.overlayPath}/AGENTS.md\``,
  ]);
  return [
    "# Slei Aggregated Workspace",
    "",
    "This is a shared project-set overlay generated by Slei.",
    "",
    "This directory is not an original project repository. Real project workspaces are mounted under `workspaces/`, and linked files are mounted under `files/`.",
    "",
    "Runtime-specific agent and channel context is provided by Slei in the session system prompt.",
    "",
    "## Mounted Project Workspaces",
    "",
    ...(projectDirectories.length ? projectDirectories.map((mount) => `- \`${mount.overlayPath}\` -> \`${mount.realPath}\``) : ["- None"]),
    "",
    "## Linked Files",
    "",
    ...(linkedFiles.length ? linkedFiles.map((mount) => `- \`${mount.overlayPath}\` -> \`${mount.realPath}\``) : ["- None"]),
    "",
    "## Instructions",
    "",
    "Before editing files in any mounted project, read that project's own instructions when present:",
    ...instructionPaths,
    "",
    "Project-specific instructions apply only inside that project. If instructions conflict, follow the instructions for the project whose files you are editing.",
    "",
    "Edit project files through `workspaces/...`; those paths are symlinks to real project directories.",
    "Edit linked files through `files/...` only when the user asks to modify that file.",
    "Do not edit generated overlay files or files through `.claude/skills`.",
    "",
  ].join("\n");
}

function canonicalMounts(mounts: readonly WorkspaceMount[]): CanonicalMount[] {
  const byRealPath = new Map<string, Omit<CanonicalMount, "slug" | "overlayPath">>();
  for (const mount of mounts) {
    const trimmed = mount.path.trim();
    if (!trimmed || !existsSync(trimmed)) continue;
    const realPath = realpathSync(trimmed);
    const stat = lstatSync(realPath);
    byRealPath.set(realPath, {
      ...mount,
      path: trimmed,
      label: mount.label?.trim() || basename(realPath),
      realPath,
      kind: stat.isDirectory() ? "directory" : "file",
    });
  }

  const directories = [...byRealPath.values()]
    .filter((mount) => mount.kind === "directory")
    .sort((left, right) => left.realPath.localeCompare(right.realPath));
  const files = [...byRealPath.values()]
    .filter((mount) => mount.kind === "file")
    .sort((left, right) => left.realPath.localeCompare(right.realPath));
  return [
    ...withOverlayPaths(directories, "workspaces"),
    ...withOverlayPaths(files, "files"),
  ];
}

function withOverlayPaths(mounts: Array<Omit<CanonicalMount, "slug" | "overlayPath">>, root: "workspaces" | "files"): CanonicalMount[] {
  const used = new Set<string>();
  return mounts.map((mount, index) => {
    const base = slugify(mount.label || basename(mount.realPath));
    const slug = uniqueSlug(`${String(index + 1).padStart(2, "0")}-${base}`, used);
    used.add(slug);
    return { ...mount, slug, overlayPath: `${root}/${slug}` };
  });
}

function loadAgentSkillMeta(agentWorkspacePath: string) {
  return readSkillSources(join(agentWorkspacePath, ".claude", "skills"), {
    sourceKind: "agent",
    workspaceSlug: "agent",
    workspaceLabel: "Slei agent",
    priority: 0,
  }).map((source) => {
    const raw = readFileSync(join(source.skillPath, "SKILL.md"), "utf8");
    const meta = parseSkillFrontmatter(raw);
    return {
      name: meta.name || source.skillName,
      description: meta.description || "No description.",
    };
  });
}

function parseSkillFrontmatter(raw: string): { name?: string; description?: string } {
  const { frontmatter } = splitFrontmatter(raw);
  const result: { name?: string; description?: string } = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (key === "name" && value) result.name = value;
    if (key === "description" && value) result.description = value;
  }
  return result;
}

function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  if (!raw.startsWith("---\n")) return { frontmatter: "", body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end < 0) return { frontmatter: "", body: raw };
  return {
    frontmatter: raw.slice(4, end),
    body: raw.slice(end + 4).replace(/^\r?\n/, ""),
  };
}

function replaceDirectory(tmpRoot: string, root: string) {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(dirname(root), { recursive: true });
  symlinkSafeRename(tmpRoot, root);
}

function symlinkSafeRename(from: string, to: string) {
  try {
    rmSync(to, { recursive: true, force: true });
  } catch {
    // Best effort cleanup before rename.
  }
  renameSyncCompat(from, to);
}

function renameSyncCompat(from: string, to: string) {
  renameSync(from, to);
}

function readDirectoryNames(path: string): string[] {
  try {
    return lstatSync(path).isDirectory() ? readdirSync(path).sort() : [];
  } catch {
    return [];
  }
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    const normalized = realpathOrOriginal(path);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function realpathOrOriginal(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function hashLines(lines: readonly string[]): string {
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace";
}

function uniqueSlug(slug: string, used: Set<string>): string {
  if (!used.has(slug)) return slug;
  let index = 2;
  while (used.has(`${slug}-${index}`)) index += 1;
  return `${slug}-${index}`;
}

function safeSegment(value: string): string {
  return slugify(value).slice(0, 80);
}
