import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const SRC_ROOT = resolve(__dirname, "..");

function sourceFiles() {
  function collect(dir: string, prefix = ""): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const absolute = resolve(dir, entry);
      const relativePath = prefix ? `${prefix}/${entry}` : entry;
      if (statSync(absolute).isDirectory()) return collect(absolute, relativePath);
      return relativePath.endsWith(".tsx") ? [relativePath] : [];
    });
  }

  return collect(SRC_ROOT).filter((file) => {
    if (file.endsWith(".test.tsx")) return false;
    if (file.startsWith("components/ui/")) return false;
    return true;
  });
}

function readSource(file: string) {
  return readFileSync(resolve(SRC_ROOT, file), "utf8");
}

describe("desktop UI primitive usage", () => {
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

  it("uses raised shadows only for clickable control surfaces", () => {
    const buttonSource = readSource("components/ui/button.tsx");
    const cardSource = readSource("components/ui/card.tsx");
    const panelSource = readSource("components/SoftPanel.tsx");

    expect(buttonSource).toContain("shadow-[var(--slei-shadow-raised-sm)]");
    expect(buttonSource).not.toContain("shadow-sm");
    expect(cardSource).toContain('variant === "raised" && "border-transparent bg-card shadow-[var(--slei-shadow-raised-md)]"');
    expect(cardSource).toContain("hover:shadow-[var(--slei-shadow-raised-md)]");
    expect(panelSource).toContain('raised: "border-transparent bg-card shadow-[var(--slei-shadow-raised-md)]"');
    expect(panelSource).toContain("hover:shadow-[var(--slei-shadow-raised-md)]");
  });

  it("uses inset shadows for input-like and segmented controls", () => {
    for (const file of [
      "components/ui/input.tsx",
      "components/ui/textarea.tsx",
      "components/ui/select.tsx",
      "components/ui/tabs.tsx",
    ]) {
      expect(readSource(file)).toContain("shadow-[var(--slei-shadow-inset");
    }
  });

  it("keeps static surfaces and badges flat", () => {
    const panelSource = readSource("components/SoftPanel.tsx");
    const cardSource = readSource("components/ui/card.tsx");
    const badgeSource = readSource("components/ui/badge.tsx");

    expect(panelSource).toContain('surface: "border-border/60 bg-card"');
    expect(panelSource).not.toContain('surface: "border-border/60 bg-card shadow');
    expect(cardSource).toContain('variant === "surface" && "border-border/60 bg-card"');
    expect(cardSource).not.toContain('variant === "surface" && "border-border/60 bg-card shadow');
    expect(badgeSource).not.toContain("shadow-sm");
    expect(badgeSource).not.toContain("slei-shadow");

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

  it("uses a compact overlay shadow for tooltip instead of raised or inset shadows", () => {
    const source = readSource("components/ui/tooltip.tsx");

    expect(source).toContain("shadow-[var(--slei-shadow-overlay-xs)]");
    expect(source).not.toContain("shadow-[var(--slei-shadow-raised)]");
    expect(source).not.toContain("shadow-[var(--slei-shadow-inset)]");
  });

  it("uses regular overlay shadows for floating primitives", () => {
    const floatingPrimitiveFiles = [
      "components/ui/dialog.tsx",
      "components/ui/alert-dialog.tsx",
      "components/ui/sheet.tsx",
      "components/ui/popover.tsx",
      "components/ui/dropdown-menu.tsx",
    ];

    for (const file of floatingPrimitiveFiles) {
      const source = readSource(file);
      expect(source).not.toContain("shadow-[var(--slei-shadow-raised)]");
      expect(source).not.toContain("shadow-[var(--slei-shadow-inset)]");
    }

    expect(readSource("components/ui/dialog.tsx")).toContain("shadow-[var(--slei-shadow-overlay-md)]");
    expect(readSource("components/ui/alert-dialog.tsx")).toContain("shadow-[var(--slei-shadow-overlay-md)]");
    expect(readSource("components/ui/sheet.tsx")).toContain("shadow-[var(--slei-shadow-overlay-md)]");
    expect(readSource("components/ui/popover.tsx")).toContain("shadow-[var(--slei-shadow-overlay-sm)]");
    expect(readSource("components/ui/dropdown-menu.tsx")).toContain("shadow-[var(--slei-shadow-overlay-sm)]");

    const selectSource = readSource("components/ui/select.tsx");
    const selectContentSource = selectSource.slice(
      selectSource.indexOf("function SelectContent"),
      selectSource.indexOf("function SelectLabel"),
    );
    expect(selectContentSource).toContain("shadow-[var(--slei-shadow-overlay-sm)]");
    expect(selectContentSource).not.toContain("shadow-[var(--slei-shadow-raised");
    expect(selectContentSource).not.toContain("shadow-[var(--slei-shadow-inset");
  });
});
