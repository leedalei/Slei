import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const SRC_ROOT = resolve(__dirname, "..");
const DESKTOP_ROOT = resolve(SRC_ROOT, "..");
const WORKSPACE_ROOT = resolve(DESKTOP_ROOT, "../..");
const AUDIT_TEST_SOURCE_PATH = "components/ui-primitive-audit.test.tsx";
const forbiddenTablerPackageName = ["@tabler", "icons-react"].join("/");

const enabledAuditCategories = {
  radixAggregate: true,
  icons: true,
  themeTokens: true,
  softPanel: true,
  oldUtilities: false,
} as const;

type AuditCategory = keyof typeof enabledAuditCategories;

type AuditFile = {
  filePath: string;
  source: string;
};

type AuditCategoryCheck = {
  category: AuditCategory;
  name: string;
  files: () => AuditFile[];
  assert: (file: AuditFile) => void;
};

type PackageJson = Record<string, unknown>;

const allowedTailwindV4ThemeMappings = new Set([
  "--color-background",
  "--color-card",
  "--color-card-foreground",
  "--color-foreground",
  "--color-popover",
  "--color-popover-foreground",
  "--color-primary",
  "--color-primary-foreground",
  "--color-secondary",
  "--color-secondary-foreground",
  "--color-muted",
  "--color-muted-foreground",
  "--color-accent",
  "--color-accent-foreground",
  "--color-destructive",
  "--color-destructive-foreground",
  "--color-border",
  "--color-input",
  "--color-ring",
  "--color-sidebar",
  "--color-sidebar-foreground",
  "--color-sidebar-primary",
  "--color-sidebar-primary-foreground",
  "--color-sidebar-accent",
  "--color-sidebar-accent-foreground",
  "--color-sidebar-border",
  "--color-sidebar-ring",
  "--color-chart-1",
  "--color-chart-2",
  "--color-chart-3",
  "--color-chart-4",
  "--color-chart-5",
  "--color-shadow-color",
  "--radius",
  "--radius-sm",
  "--radius-md",
  "--radius-lg",
  "--radius-xl",
  "--radius-2xl",
  "--radius-3xl",
  "--radius-4xl",
  "--shadow",
  "--shadow-2xl",
  "--shadow-2xs",
  "--shadow-lg",
  "--shadow-md",
  "--shadow-sm",
  "--shadow-xl",
  "--shadow-xs",
]);

const allowedRadiusThemeVariables = new Set([
  "--radius-xs",
  "--radius-sm",
  "--radius-base",
  "--radius-md",
  "--radius-lg",
  "--radius-xl",
]);

const legacyRootThemeTokens = new Set([
  "--accent",
  "--accent-foreground",
  "--background",
  "--border",
  "--card",
  "--card-foreground",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--destructive",
  "--destructive-foreground",
  "--foreground",
  "--input",
  "--letter-spacing",
  "--muted",
  "--muted-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--radius",
  "--ring",
  "--secondary",
  "--secondary-foreground",
  "--shadow",
  "--shadow-2xl",
  "--shadow-2xs",
  "--shadow-blur",
  "--shadow-color",
  "--shadow-lg",
  "--shadow-md",
  "--shadow-offset-x",
  "--shadow-offset-y",
  "--shadow-opacity",
  "--shadow-sm",
  "--shadow-spread",
  "--shadow-xl",
  "--shadow-xs",
  "--sidebar",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-border",
  "--sidebar-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-ring",
  "--spacing",
  "--tracking-normal",
]);

const allowedGenericAnimationTokenPatterns = [
  /^--dropdown-/,
  /^--duration-/,
  /^--ease-/,
  /^--focus-in-/,
  /^--icon-swap-/,
  /^--modal-/,
  /^--tabs-/,
];

const disallowedSelfReferenceThemeMappings = new Set([
  "--letter-spacing",
  "--spacing",
  "--tracking-normal",
]);

const excludedSourceAuditDirectories = new Set(["docs", "plan", "plans", "spec", "specs"]);

function collectRelativeFiles(dir: string, include: (relativePath: string) => boolean, prefix = ""): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const absolute = resolve(dir, entry);
    const relativePath = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(absolute).isDirectory()) return collectRelativeFiles(absolute, include, relativePath);
    return include(relativePath) ? [relativePath] : [];
  });
}

function isSourceAuditFile(file: string) {
  if (file === AUDIT_TEST_SOURCE_PATH) return false;
  if (!/\.(?:ts|tsx)$/.test(file)) return false;
  if (file.split("/").some((segment) => excludedSourceAuditDirectories.has(segment))) return false;
  return true;
}

function sourceAuditFiles() {
  return collectRelativeFiles(SRC_ROOT, isSourceAuditFile).map((filePath) => ({ filePath, source: readSource(filePath) }));
}

function styleAuditFiles() {
  return collectRelativeFiles(SRC_ROOT, (file) => file.endsWith(".css")).map((filePath) => ({
    filePath,
    source: readSource(filePath),
  }));
}

function packageAuditFiles() {
  return [
    {
      filePath: "package.json",
      source: readFileSync(resolve(DESKTOP_ROOT, "package.json"), "utf8"),
    },
  ];
}

function dependencyAuditFiles() {
  return [
    ...packageAuditFiles(),
    {
      filePath: "pnpm-lock.yaml",
      source: readFileSync(resolve(WORKSPACE_ROOT, "pnpm-lock.yaml"), "utf8"),
    },
    ...sourceAuditFiles(),
  ];
}

function legacySourceAuditFiles() {
  return [...sourceAuditFiles(), ...styleAuditFiles()];
}

function replaceAtRuleBlocks(source: string, atRule: string, replacement: (block: string) => string) {
  let cursor = 0;
  let output = "";

  while (cursor < source.length) {
    const atRuleIndex = source.indexOf(atRule, cursor);
    if (atRuleIndex === -1) return output + source.slice(cursor);

    const blockStart = source.indexOf("{", atRuleIndex);
    if (blockStart === -1) return output + source.slice(cursor);

    let depth = 0;
    let blockEnd = blockStart;
    for (; blockEnd < source.length; blockEnd += 1) {
      const char = source[blockEnd];
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          blockEnd += 1;
          break;
        }
      }
    }

    output += source.slice(cursor, atRuleIndex);
    output += replacement(source.slice(atRuleIndex, blockEnd));
    cursor = blockEnd;
  }

  return output;
}

function valueIsVarReference(value: string, token: string) {
  return value.trim() === `var(${token})`;
}

function isAllowedThemeInlineMapping(token: string, value: string) {
  if (!allowedTailwindV4ThemeMappings.has(token)) return false;

  if (token.startsWith("--color-")) {
    const semanticToken = `--${token.slice("--color-".length)}`;
    return valueIsVarReference(value, semanticToken);
  }

  if (token.startsWith("--radius")) {
    const referencedToken = value.trim().match(/^var\((--[\w-]+)\)$/)?.[1];
    return referencedToken ? allowedRadiusThemeVariables.has(referencedToken) && referencedToken !== token : false;
  }

  if (token.startsWith("--shadow")) {
    return valueIsVarReference(value, token);
  }

  return false;
}

function removeAllowedThemeInlineMappings(source: string) {
  return replaceAtRuleBlocks(source, "@theme inline", (block) =>
    block.replace(/(--[\w-]+)\s*:\s*([^;]+);/g, (declaration, token: string, value: string) =>
      isAllowedThemeInlineMapping(token, value) ? "" : declaration,
    ),
  );
}

function removeAllowedGenericAnimationTokens(source: string) {
  return source
    .split("\n")
    .map((line) => {
      const declaration = line.match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/);
      if (!declaration) return line;

      const [, token, value] = declaration;
      const isAllowedAnimationToken = allowedGenericAnimationTokenPatterns.some((pattern) => pattern.test(token));
      if (isAllowedAnimationToken && !value.includes("var(--slei-")) return "";
      return line;
    })
    .join("\n");
}

function sourceWithoutAllowedThemeTokens(source: string) {
  return removeAllowedGenericAnimationTokens(removeAllowedThemeInlineMappings(source));
}

function sourceWithoutThemeInlineBlocks(source: string) {
  return replaceAtRuleBlocks(source, "@theme inline", () => "");
}

function legacyThemeTokenViolations(file: AuditFile) {
  if (!file.filePath.endsWith(".css")) return [];

  const violations: string[] = [];
  const sourceOutsideThemeInline = sourceWithoutThemeInlineBlocks(file.source);
  const lines = sourceOutsideThemeInline.split("\n");
  const themeScopeStack: Array<{ depth: number; isThemeScope: boolean }> = [];
  let depth = 0;

  for (const [index, line] of lines.entries()) {
    const selector = line.match(/^\s*(:root|\.dark|\.light)\s*\{/);
    if (selector) {
      themeScopeStack.push({ depth, isThemeScope: true });
    }

    const inThemeScope = themeScopeStack.some((scope) => scope.isThemeScope);
    for (const declaration of line.matchAll(/(--[\w-]+)\s*:/g)) {
      const [, token] = declaration;
      const isSemanticThemeToken = legacyRootThemeTokens.has(token);
      const isCompatibilityToken =
        /^--(?:color|padding|gap|indent|z|scrollbar)-/.test(token) ||
        /^--(?:border|radius)-(?!xs$|sm$|base$|md$|lg$|xl$|2xl$|3xl$|4xl$)/.test(token) ||
        /^--shadow-soft$/.test(token);

      if ((isSemanticThemeToken && !inThemeScope) || isCompatibilityToken) {
        violations.push(`${file.filePath}:${index + 1}: legacy compatibility token ${token}`);
      }
    }

    for (const char of line) {
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        while (themeScopeStack.length > 0 && depth <= themeScopeStack[themeScopeStack.length - 1].depth) {
          themeScopeStack.pop();
        }
      }
    }
  }

  return violations;
}

function themeInlineMappingViolations(file: AuditFile) {
  if (!file.filePath.endsWith(".css")) return [];

  const violations: string[] = [];
  replaceAtRuleBlocks(file.source, "@theme inline", (block) => {
    for (const [index, line] of block.split("\n").entries()) {
      for (const declaration of line.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        const [, token, value] = declaration;
        if (disallowedSelfReferenceThemeMappings.has(token) && valueIsVarReference(value, token)) {
          violations.push(`${file.filePath}:${index + 1}: self-referential @theme inline mapping ${token}: ${value}`);
        }
        if (allowedTailwindV4ThemeMappings.has(token) && !isAllowedThemeInlineMapping(token, value)) {
          violations.push(`${file.filePath}:${index + 1}: invalid @theme inline mapping ${token}: ${value}`);
        }
      }
    }

    return block;
  });

  return violations;
}

function runEnabledAuditCategories(checks: readonly AuditCategoryCheck[]) {
  const violations: string[] = [];

  for (const check of checks) {
    if (!enabledAuditCategories[check.category]) continue;

    for (const file of check.files()) {
      try {
        check.assert(file);
      } catch (error) {
        violations.push(`${check.name}: ${file.filePath}: ${(error as Error).message}`);
      }
    }
  }

  expect(violations).toEqual([]);
}

function assertNoRadixAggregateUsage({ filePath, source }: AuditFile) {
  expect(source).not.toMatch(/from\s+["']radix-ui["']/);

  if (filePath !== "package.json") return;

  const packageJson = JSON.parse(source) as PackageJson;
  for (const dependencySection of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const dependencies = packageJson[dependencySection];
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue;

    expect(dependencies).not.toHaveProperty("radix-ui");
  }
}

const dependencyAuditCategories = [
  {
    category: "radixAggregate",
    name: "Radix aggregate imports",
    files: dependencyAuditFiles,
    assert: assertNoRadixAggregateUsage,
  },
  {
    category: "icons",
    name: "Tabler icon package usage",
    files: dependencyAuditFiles,
    assert: ({ source }) => {
      expect(source).not.toContain(forbiddenTablerPackageName);
    },
  },
] satisfies readonly AuditCategoryCheck[];

const legacyUiAuditCategories = [
  {
    category: "softPanel",
    name: "SoftPanel component usage",
    files: legacySourceAuditFiles,
    assert: ({ filePath, source }) => {
      expect(filePath).not.toContain("SoftPanel.tsx");
      expect(source).not.toContain("SoftPanel");
    },
  },
  {
    category: "themeTokens",
    name: "Slei theme token usage",
    files: legacySourceAuditFiles,
    assert: (file) => {
      expect(themeInlineMappingViolations(file)).toEqual([]);
      if (file.filePath === "app/app.css") {
        for (const token of ["--glass-bg", "--glass-border", "--glass-blur", "--glow-cyan", "--glow-purple", "--text-primary"]) {
          expect(file.source).toContain(`${token}:`);
        }
        expect(file.source).not.toContain("Temporary legacy app compatibility styles");
      }
      expect(sourceWithoutAllowedThemeTokens(file.source)).not.toContain("--slei-");
      expect(legacyThemeTokenViolations(file)).toEqual([]);
    },
  },
  {
    category: "oldUtilities",
    name: "Legacy Slei utility usage",
    files: legacySourceAuditFiles,
    assert: ({ source }) => {
      expect(source).not.toContain("slei-raised");
      expect(source).not.toContain("slei-inset");
      expect(source).not.toContain("shadow-[var(--slei-");
    },
  },
] satisfies readonly AuditCategoryCheck[];

function sourceFiles() {
  return collectRelativeFiles(SRC_ROOT, (file) => file.endsWith(".tsx")).filter((file) => {
    if (file.endsWith(".test.tsx")) return false;
    if (file.startsWith("components/ui/")) return false;
    return true;
  });
}

function readSource(file: string) {
  return readFileSync(resolve(SRC_ROOT, file), "utf8");
}

const einUiRegistryPrimitiveFiles = [
  "components/ui/accordion.tsx",
  "components/ui/alert-dialog.tsx",
  "components/ui/avatar.tsx",
  "components/ui/badge.tsx",
  "components/ui/button.tsx",
  "components/ui/card.tsx",
  "components/ui/checkbox.tsx",
  "components/ui/dialog.tsx",
  "components/ui/dropdown-menu.tsx",
  "components/ui/glass-avatar.tsx",
  "components/ui/input.tsx",
  "components/ui/label.tsx",
  "components/ui/notification.tsx",
  "components/ui/popover.tsx",
  "components/ui/radio.tsx",
  "components/ui/scroll-area.tsx",
  "components/ui/select.tsx",
  "components/ui/separator.tsx",
  "components/ui/sheet.tsx",
  "components/ui/skeleton.tsx",
  "components/ui/switch.tsx",
  "components/ui/tabs.tsx",
  "components/ui/textarea.tsx",
  "components/ui/tooltip.tsx",
] as const;

describe("desktop UI primitive usage", () => {
  it("excludes docs, plan, and spec directories from source audit scans", () => {
    for (const file of [
      AUDIT_TEST_SOURCE_PATH,
      "docs/foo.ts",
      "docs/foo.tsx",
      "plan/foo.ts",
      "plans/foo.ts",
      "spec/foo.tsx",
      "specs/foo.tsx",
      "features/chat/docs/foo.ts",
      "features/chat/plan/foo.ts",
      "features/chat/plans/foo.tsx",
      "features/chat/spec/foo.ts",
      "features/chat/specs/foo.tsx",
    ]) {
      expect(isSourceAuditFile(file)).toBe(false);
    }

    expect(isSourceAuditFile("features/chat/ChatPageView.tsx")).toBe(true);
  });

  it("keeps disabled dependency audit categories ready for sliced migration work", () => {
    runEnabledAuditCategories(dependencyAuditCategories);
  });

  it("detects Radix aggregate usage in both source imports and package dependencies", () => {
    const radixAggregateAudit = dependencyAuditCategories.find((category) => category.category === "radixAggregate");

    expect(radixAggregateAudit).toBeDefined();
    expect(() =>
      radixAggregateAudit?.assert({
        filePath: "components/ui/select.tsx",
        source: 'import { Select as SelectPrimitive } from "radix-ui";',
      }),
    ).toThrow();
    expect(() =>
      radixAggregateAudit?.assert({
        filePath: "package.json",
        source: JSON.stringify({ dependencies: { "radix-ui": "^1.4.3" } }),
      }),
    ).toThrow();
  });

  it("uses EinUI registry primitives instead of the old Slei primitive baseline", () => {
    const violations: string[] = [];

    for (const file of einUiRegistryPrimitiveFiles) {
      const absolute = resolve(SRC_ROOT, file);
      if (!existsSync(absolute)) {
        violations.push(`${file}: missing required EinUI registry primitive`);
        continue;
      }

      const source = readSource(file);
      if (/\bslei-[\w-]+/.test(source)) violations.push(`${file}: contains old Slei utility classes`);
      if (/--slei-[\w-]+/.test(source)) violations.push(`${file}: contains old Slei CSS variables`);
      if (file === "components/ui/input.tsx" && /\bchrome\b/.test(source)) {
        violations.push(`${file}: exposes old chrome prop`);
      }
      if (file === "components/ui/card.tsx" && /\b(?:variant|size)\?:/.test(source)) {
        violations.push(`${file}: exposes old size/variant props`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("detects Tabler icon usage in source imports, package dependencies, and lockfiles", () => {
    const iconsAudit = dependencyAuditCategories.find((category) => category.category === "icons");

    expect(iconsAudit).toBeDefined();
    expect(() =>
      iconsAudit?.assert({
        filePath: "components/icons.tsx",
        source: `import { IconCheck } from "${forbiddenTablerPackageName}";`,
      }),
    ).toThrow();
    expect(() =>
      iconsAudit?.assert({
        filePath: "package.json",
        source: JSON.stringify({ dependencies: { [forbiddenTablerPackageName]: "^3.44.0" } }),
      }),
    ).toThrow();
    expect(() =>
      iconsAudit?.assert({
        filePath: "pnpm-lock.yaml",
        source: `${forbiddenTablerPackageName}@3.44.0:`,
      }),
    ).toThrow();
  });

  it("detects SoftPanel component filenames and source references", () => {
    const softPanelAudit = legacyUiAuditCategories.find((category) => category.category === "softPanel");

    expect(softPanelAudit).toBeDefined();
    expect(() =>
      softPanelAudit?.assert({
        filePath: "components/SoftPanel.tsx",
        source: "export function Panel() {}",
      }),
    ).toThrow();
    expect(() =>
      softPanelAudit?.assert({
        filePath: "features/chat/ChatPageView.tsx",
        source: "const view = <SoftPanel />;",
      }),
    ).toThrow();
  });

  it("detects legacy raised, inset, and Slei variable shadow utilities", () => {
    const oldUtilitiesAudit = legacyUiAuditCategories.find((category) => category.category === "oldUtilities");
    const legacyArbitraryShadowClass = ["shadow-[var(", "--slei-shadow-overlay-xs", ")]"].join("");

    expect(oldUtilitiesAudit).toBeDefined();
    for (const source of [
      '"slei-raised-small"',
      '"slei-inset-small"',
      `"${legacyArbitraryShadowClass}"`,
    ]) {
      expect(() =>
        oldUtilitiesAudit?.assert({
          filePath: "components/ui/button.tsx",
          source,
        }),
      ).toThrow();
    }
  });

  it("keeps legacy arbitrary class fixtures hidden from Tailwind static scanning", () => {
    const auditSource = readSource(AUDIT_TEST_SOURCE_PATH);
    const legacyArbitraryShadowClass = ["shadow-[var(", "--slei-shadow-overlay-xs", ")]"].join("");

    expect(auditSource).not.toContain(`"${legacyArbitraryShadowClass}"`);
    expect(auditSource).not.toContain(`'${legacyArbitraryShadowClass}'`);
  });

  it("allows scoped Tailwind theme mappings and generic animation tokens", () => {
    const themeTokensAudit = legacyUiAuditCategories.find((category) => category.category === "themeTokens");

    expect(themeTokensAudit).toBeDefined();
    expect(() =>
      themeTokensAudit?.assert({
        filePath: "app/app.css",
        source: `
@theme inline {
  --color-background: var(--background);
  --color-card: var(--card);
  --color-foreground: var(--foreground);
  --radius-lg: var(--radius-base);
  --shadow-lg: var(--shadow-lg);
}

:root {
  --background: oklch(0.15 0.03 250);
  --radius-base: 8px;
  --glass-bg: rgba(255, 255, 255, 0.05);
  --glass-border: rgba(255, 255, 255, 0.1);
  --glass-blur: 16px;
  --glow-cyan: rgba(6, 182, 212, 0.3);
  --glow-purple: rgba(147, 51, 234, 0.3);
  --text-primary: rgba(255, 255, 255, 0.95);
  --dropdown-open-dur: 250ms;
  --modal-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
`,
      }),
    ).not.toThrow();
  });

  it("rejects suspicious Tailwind theme mappings and legacy root tokens", () => {
    const themeTokensAudit = legacyUiAuditCategories.find((category) => category.category === "themeTokens");

    expect(themeTokensAudit).toBeDefined();
    for (const source of [
      "@theme inline { --color-background: red; }",
      "@theme inline { --shadow-lg: var(--old-shadow); }",
      "@theme inline { --color-background: var(--slei-background); }",
      "@theme inline { --letter-spacing: var(--letter-spacing); }",
      ":root { --color-bg: var(--background); }",
      ".workspace { --background: oklch(0 0 0); }",
      ":root { --dropdown-open-dur: var(--slei-duration); }",
    ]) {
      expect(() =>
        themeTokensAudit?.assert({
          filePath: "app/app.css",
          source,
        }),
      ).toThrow();
    }
  });

  it("keeps disabled legacy UI audit categories ready for sliced migration work", () => {
    runEnabledAuditCategories(legacyUiAuditCategories);
  });

  it("keeps business UI on shadcn primitives instead of raw JSX controls", () => {
    const violations: string[] = [];

    for (const file of sourceFiles()) {
      const source = readSource(file);
      const lines = source.split("\n");
      for (const [index, line] of lines.entries()) {
        if (/<button(?=[\s>/])/.test(line)) violations.push(`${file}:${index + 1}: raw <button> ${line.trim()}`);
        if (/<select(?=[\s>/])/.test(line)) violations.push(`${file}:${index + 1}: raw <select> ${line.trim()}`);
        if (/<textarea(?=[\s>/])/.test(line)) violations.push(`${file}:${index + 1}: raw <textarea> ${line.trim()}`);
        if (/<input(?=[\s>/])/.test(line)) {
          const tagContext = lines.slice(index, index + 8).join(" ");
          if (/\btype="file"/.test(tagContext) && (/\bhidden\b/.test(tagContext) || /\bsr-only\b/.test(tagContext))) continue;
          violations.push(`${file}:${index + 1}: raw <input> ${line.trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("uses Tooltip for DOM tooltips instead of title attributes", () => {
    const violations: string[] = [];

    for (const file of sourceFiles()) {
      const source = readSource(file);
      for (const tag of Array.from(source.matchAll(/<[a-z][\w.-]*\b[^>]*\btitle=/g), (match) => match[0])) {
        violations.push(`${file}: DOM title attribute ${tag}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("does not move shared buttons on press", () => {
    const source = readSource("components/ui/button.tsx");

    expect(source).not.toMatch(/\bactive:[^\s"]*(?:translate|scale)/);
    expect(source).not.toMatch(/\bactive:not-[^\s"]*(?:translate|scale)/);
  });

  it("does not keep the old hand-rolled member add menu shell", () => {
    const source = readSource("features/chat/ChatPageView.tsx");
    expect(source).not.toContain('data-testid="slei-channel-member-add-menu"');
    expect(source).not.toContain("absolute right-2 top-8 z-30");
  });

  it("keeps shared button and card APIs free of legacy Slei token dependencies", () => {
    const buttonSource = readSource("components/ui/button.tsx");
    const cardSource = readSource("components/ui/card.tsx");

    expect(buttonSource).not.toContain("slei-");
    expect(buttonSource).not.toContain("--slei-");
    expect(buttonSource).not.toMatch(/\bhover:[^\s"]*scale/);
    expect(buttonSource).not.toMatch(/\bactive:[^\s"]*scale/);
    expect(buttonSource).not.toContain("shadow-sm");
    expect(buttonSource).toContain("export { Button, GlassButton, buttonVariants, glassButtonVariants }");
    expect(buttonSource).toContain("data-slot=\"button\"");
    expect(buttonSource).toContain('data-variant={variant ?? "default"}');
    expect(buttonSource).toContain('data-size={size ?? "default"}');
    expect(buttonSource).toContain("const buttonVariants");
    expect(buttonSource).toContain("buttonVariants({ variant, size, className })");
    expect(buttonSource).toContain("border-white/30 bg-white/20");
    expect(buttonSource).toContain("bg-linear-to-r from-cyan-500/80");
    expect(buttonSource).toContain("bg-red-500/30");
    expect(cardSource).not.toContain("slei-");
    expect(cardSource).not.toContain("--slei-");
    expect(cardSource).not.toContain("variant?:");
    expect(cardSource).not.toContain("size?:");
    expect(cardSource).toContain("data-slot=\"card\"");
    expect(cardSource).toContain("data-slot=\"card-header\"");
    expect(cardSource).toContain("data-slot=\"card-title\"");
    expect(cardSource).toContain("data-slot=\"card-description\"");
    expect(cardSource).toContain("data-slot=\"card-content\"");
    expect(cardSource).toContain("data-slot=\"card-footer\"");
    expect(cardSource).toContain("border border-white/20 bg-white/10");
    expect(cardSource).toContain("backdrop-blur-xl");
  });

  it("does not keep legacy hover transition utilities in primitives", () => {
    const appCss = readSource("app/app.css");
    const buttonSource = readSource("components/ui/button.tsx");
    const cardSource = readSource("components/ui/card.tsx");
    const badgeSource = readSource("components/ui/badge.tsx");

    expect(appCss).not.toContain("@utility slei-hover-transition");
    expect(buttonSource).not.toContain("slei-hover-transition");
    expect(cardSource).not.toContain("slei-hover-transition");
    expect(badgeSource).not.toContain("slei-hover-transition");
  });

  it("removes old Slei raised and inset token definitions from app.css", () => {
    const appCss = readSource("app/app.css");

    expect(appCss).not.toContain("--slei-shadow-");
    expect(appCss).not.toContain("--slei-overlay-shadow-color");
    expect(appCss).not.toContain("@utility slei-raised");
    expect(appCss).not.toContain("@utility slei-inset");
    expect(appCss).not.toContain("@utility slei-hover-transition");
  });

  it("does not emit old raised, inset, or hover-transition utility classes in live source", () => {
    const violations: string[] = [];
    const disallowed = /\bslei-(?:raised|inset|hover-transition)(?:-[\w]+)?\b/g;

    for (const file of sourceFiles()) {
      const source = readSource(file);
      for (const match of source.matchAll(disallowed)) {
        violations.push(`${file}: ${match[0]}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("does not reintroduce old arbitrary control radius values", () => {
    const buttonSource = readSource("components/ui/button.tsx");
    const selectSource = readSource("components/ui/select.tsx");
    const badgeSource = readSource("components/ui/badge.tsx");
    const searchSource = readSource("features/search/SearchPageView.tsx");

    expect(buttonSource).not.toContain("rounded-[min(");
    expect(selectSource).not.toContain("rounded-[12px]");
    expect(selectSource).not.toContain("rounded-[14px]");
    expect(selectSource).not.toContain("rounded-[10px]");

    expect(searchSource).not.toContain("rounded-[12px]");
    expect(badgeSource).not.toContain("rounded-4xl");
  });

  it("keeps switch and separator primitive contracts anchored to slots and state hooks", () => {
    const switchSource = readSource("components/ui/switch.tsx");
    const separatorSource = readSource("components/ui/separator.tsx");

    expect(switchSource).toContain('data-slot="switch"');
    expect(switchSource).toContain('data-slot="switch-thumb"');
    expect(switchSource).toContain("h-6 w-11");
    expect(switchSource).toContain("h-5 w-5");
    expect(switchSource).toContain("data-[state=checked]:");
    expect(switchSource).toContain("data-[state=checked]:translate-x-5");
    expect(separatorSource).toContain('data-slot="separator"');
    expect(separatorSource).toContain('orientation = "horizontal"');
    expect(separatorSource).toContain('orientation === "horizontal" ? "h-px w-full" : "h-full w-px"');
  });

  it("keeps text input-like and segmented controls free of legacy inset styling", () => {
    const inputSource = readSource("components/ui/input.tsx");
    const textareaSource = readSource("components/ui/textarea.tsx");
    const tabsSource = readSource("components/ui/tabs.tsx");

    expect(inputSource).not.toContain("slei-inset");
    expect(inputSource).not.toContain("--slei-");
    expect(inputSource).not.toContain("focus-visible:ring-3");
    expect(textareaSource).not.toContain("slei-inset");
    expect(textareaSource).not.toContain("--slei-");
    expect(textareaSource).not.toContain("focus-visible:ring-3");
    expect(tabsSource).not.toContain("slei-");
    expect(tabsSource).toContain('data-slot="tabs-list"');
    expect(tabsSource).toContain('data-slot="tabs-trigger"');
    expect(tabsSource).toContain("data-variant={variant}");
    expect(tabsSource).toContain("variant?: \"line\" | \"soft\"");
    expect(tabsSource).toContain("data-[state=active]:bg-white/20");
    expect(tabsSource).toContain("data-[state=active]:before:bg-gradient-to-b");
  });

  it("does not keep the old tab implementation markers", () => {
    const appCss = readSource("app/app.css");
    const tabsSource = readSource("components/ui/tabs.tsx");

    expect(tabsSource).not.toContain("data-slei-");
    expect(tabsSource).not.toContain("data-slei-tabs-pill");
    expect(tabsSource).not.toContain("requestAnimationFrame(() => moveTo(active(), false))");
    expect(appCss).not.toContain(".t-tabs-pill");
  });

  it("keeps static surfaces and badges free of old elevated variants", () => {
    const cardSource = readSource("components/ui/card.tsx");
    const badgeSource = readSource("components/ui/badge.tsx");

    expect(cardSource).not.toContain("variant ===");
    expect(badgeSource).not.toContain("shadow-sm");
    expect(badgeSource).not.toContain("slei-");

    for (const file of [
      "features/onboarding/ProfileStep.ts",
      "features/onboarding/ConnectionStep.ts",
      "features/onboarding/RuntimeStep.ts",
      "features/diagnostics/DiagnosticsPage.ts",
      "features/diagnostics/ErrorPanel.ts",
    ]) {
      expect(readSource(file)).not.toContain("shadow-sm");
    }
  });

  it("keeps tooltip free of legacy overlay shadow tokens", () => {
    const source = readSource("components/ui/tooltip.tsx");

    expect(source).not.toContain("--slei-");
    expect(source).not.toContain("slei-raised");
    expect(source).not.toContain("slei-inset");
  });

  it("renders tooltip as a bubble without an arrow pointer", () => {
    const source = readSource("components/ui/tooltip.tsx");

    expect(source).toContain("sideOffset = 4");
    expect(source).not.toContain("TooltipPrimitive.Arrow");
  });

  it("keeps floating primitives free of legacy Slei overlay shadow tokens", () => {
    const floatingPrimitiveFiles = [
      "components/ui/dialog.tsx",
      "components/ui/alert-dialog.tsx",
      "components/ui/sheet.tsx",
      "components/ui/popover.tsx",
      "components/ui/dropdown-menu.tsx",
      "components/ui/select.tsx",
    ];

    for (const file of floatingPrimitiveFiles) {
      const source = readSource(file);
      expect(source).not.toContain("--slei-");
      expect(source).not.toContain("slei-raised");
      expect(source).not.toContain("slei-inset");
    }
  });

  it("keeps select menus free of old highlighted item state classes", () => {
    const selectSource = readSource("components/ui/select.tsx");

    expect(selectSource).toContain('data-slot="select-trigger"');
    expect(selectSource).toContain('data-slot="select-content"');
    expect(selectSource).toContain('data-slot="select-item"');
    expect(selectSource).toContain("t-dropdown");
    expect(selectSource).toContain("focus:bg-white/15");
    expect(selectSource).toContain("focus:bg-white/10");
    expect(selectSource).toContain("data-[disabled]:pointer-events-none");
    expect(selectSource).not.toContain("data-[highlighted]:bg-accent");
    expect(selectSource).not.toContain("ring-1 ring-border/80");
  });

  it("keeps transition hooks wired through neutral dropdown, modal, and icon-swap contracts", () => {
    const appCss = readSource("app/app.css");

    expect(appCss).toContain("--dropdown-open-dur:");
    expect(appCss).toContain("--dropdown-close-dur:");
    expect(appCss).toContain("--modal-open-dur:");
    expect(appCss).toContain("--modal-close-dur:");
    expect(appCss).toContain("--icon-swap-dur:");
    expect(appCss).toContain(".t-dropdown");
    expect(appCss).toContain('.t-dropdown[data-state="open"]');
    expect(appCss).toContain('.t-dropdown[data-state="closed"]');
    expect(appCss).toContain(".t-modal");
    expect(appCss).toContain('.t-modal[data-state="open"]');
    expect(appCss).toContain('.t-modal[data-state="closed"]');
    expect(appCss).toContain(".t-icon-swap");
    expect(appCss).toContain('.t-icon-swap[data-state="a"] > .t-icon[data-icon="a"]');
    expect(appCss).not.toContain('.t-icon-swap[data-state="a"] .t-icon[data-icon="a"]');
    expect(appCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(appCss).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.t-dropdown\s*\{[\s\S]*animation: none !important;/);
    expect(appCss).toContain(".t-modal { transition: none !important; }");
    expect(appCss).toContain(".t-icon-swap .t-icon { transition: none !important; }");
  });

  it("keeps dropdown and modal primitives on Radix content APIs without old data-open animation classes", () => {
    for (const file of [
      "components/ui/dropdown-menu.tsx",
      "components/ui/popover.tsx",
      "components/ui/select.tsx",
    ]) {
      const source = readSource(file);
      expect(source).toContain("t-dropdown");
      expect(source).not.toContain("data-open:animate-in");
      expect(source).not.toContain("data-open:zoom-in-95");
      expect(source).not.toContain("data-closed:zoom-out-95");
    }

    const dropdownSource = readSource("components/ui/dropdown-menu.tsx");
    expect(dropdownSource).toContain("<DropdownMenuPrimitive.Content");
    expect(dropdownSource).toContain("<DropdownMenuPrimitive.SubContent");
    expect(dropdownSource).toContain("forceMount");

    const selectSource = readSource("components/ui/select.tsx");
    const selectContentSource = selectSource.slice(
      selectSource.indexOf("const SelectContent"),
      selectSource.indexOf("const SelectLabel"),
    );
    expect(selectContentSource).toContain("t-dropdown");
    expect(selectContentSource).not.toContain("forceMount");

    for (const file of [
      "components/ui/dialog.tsx",
      "components/ui/alert-dialog.tsx",
    ]) {
      const source = readSource(file);
      expect(source).toContain("t-modal");
      expect(source).not.toContain("data-open:zoom-in-95");
      expect(source).not.toContain("data-closed:zoom-out-95");
    }
  });

  it("routes stateful icon changes through the transitions-dev icon swap component", () => {
    const iconSwapSource = readSource("components/SleiIconSwap.tsx");

    expect(iconSwapSource).toContain("t-icon-swap");
    expect(iconSwapSource).toContain('data-state={active ? "b" : "a"}');
    expect(iconSwapSource).toContain('data-icon="a"');
    expect(iconSwapSource).toContain('data-icon="b"');

    for (const file of [
      "features/chat/ChatPageView.tsx",
      "features/chat/TaskRootEntry.tsx",
      "features/members/MembersPageView.tsx",
    ]) {
      const source = readSource(file);
      expect(source).toContain("SleiIconSwap");
    }

    expect(readSource("features/chat/ChatPageView.tsx")).not.toContain('name={showChannelMembersPanel ? "panelClose" : "panelOpen"}');
    expect(readSource("features/chat/ChatPageView.tsx")).not.toContain('name={saved ? "bookmark" : "bookmarkOutline"}');
    expect(readSource("features/chat/TaskRootEntry.tsx")).not.toContain('name={input.saved ? "bookmark" : "bookmarkOutline"}');
    expect(readSource("features/members/MembersPageView.tsx")).not.toContain('name={expanded ? "chevronDown" : "chevronRight"}');
    expect(readSource("features/members/MembersPageView.tsx")).not.toContain('name={input.expanded ? "chevronDown" : "chevronRight"}');
  });
});
