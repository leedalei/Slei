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
    expect(buttonSource).toContain("border-[var(--slei-raised-border)]");
    expect(buttonSource).not.toContain("shadow-sm");
    expect(buttonSource).toContain('ghost:\n          "hover:bg-muted/70 hover:text-foreground');
    expect(buttonSource).toContain('link: "text-primary underline-offset-4 hover:underline"');
    expect(cardSource).toContain('variant === "raised" && "border-transparent bg-card shadow-[var(--slei-shadow-raised-md)]"');
    expect(cardSource).toContain("hover:shadow-[var(--slei-shadow-raised-md)]");
    expect(panelSource).toContain('raised: "border-transparent bg-card shadow-[var(--slei-shadow-raised-md)]"');
    expect(panelSource).toContain("hover:shadow-[var(--slei-shadow-raised-md)]");
  });

  it("defines raised shadows as paired upper-left glow and lower-right shade", () => {
    const appCss = readSource("app/app.css");
    const lightThemeCss = appCss.slice(0, appCss.indexOf(".dark {"));
    const darkThemeCss = appCss.slice(appCss.indexOf(".dark {"), appCss.indexOf("@layer base"));

    for (const themeCss of [lightThemeCss, darkThemeCss]) {
      expect(themeCss).toContain("--slei-shadow-highlight: rgb(255 255 255 /");
      expect(themeCss).toContain("--slei-shadow-lowlight: rgb(0 0 0 /");
      expect(themeCss).toContain("--slei-overlay-shadow-color: rgb(0 0 0 /");
      expect(themeCss).toContain("--slei-shadow-raised-glow: rgb(255 255 255 /");
      expect(themeCss).toContain("--slei-shadow-raised-shade: rgb(0 0 0 /");
      expect(themeCss).toContain("--slei-shadow-inset-shade: rgb(0 0 0 /");
      expect(themeCss).not.toMatch(/--slei-shadow-(?:highlight|lowlight|raised-glow|raised-shade|inset-shade): oklch\(/);
      expect(themeCss).not.toMatch(/--slei-overlay-shadow-color: oklch\(/);
    }

    for (const size of ["xs", "sm", "md", "lg"]) {
      const tokenMatch = appCss.match(new RegExp(`--slei-shadow-raised-${size}: ([^;]+);`));
      expect(tokenMatch?.[1]).toContain("var(--slei-shadow-raised-glow)");
      expect(tokenMatch?.[1]).toContain("var(--slei-shadow-raised-shade)");
      expect(tokenMatch?.[1]).toMatch(/-[0-9]+px -[0-9]+px [0-9]+px var\(--slei-shadow-raised-glow\)/);
      expect(tokenMatch?.[1]).toMatch(/[0-9]+px [0-9]+px [0-9]+px var\(--slei-shadow-raised-shade\)/);
    }

    expect(lightThemeCss).toContain("--slei-shadow-raised-md: -6px -6px 16px var(--slei-shadow-raised-glow)");
    expect(darkThemeCss).toContain("--slei-shadow-raised-md: -6px -6px 15px var(--slei-shadow-raised-glow)");
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

  it("installs transitions-dev dropdown, modal, and icon swap snippets", () => {
    const appCss = readSource("app/app.css");

    for (const token of [
      "--dropdown-open-dur: 250ms",
      "--dropdown-close-dur: 150ms",
      "--modal-open-dur: 250ms",
      "--modal-close-dur: 150ms",
      "--icon-swap-dur: 250ms",
      "--icon-swap-blur: 2px",
    ]) {
      expect(appCss).toContain(token);
    }

    expect(appCss).toContain(".t-dropdown");
    expect(appCss).toContain(".t-modal");
    expect(appCss).toContain(".t-icon-swap");
    expect(appCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(appCss).toContain(".t-dropdown { transition: none !important; }");
    expect(appCss).toContain(".t-modal { transition: none !important; }");
    expect(appCss).toContain(".t-icon-swap .t-icon { transition: none !important; }");
  });

  it("uses transitions-dev classes for dropdown and modal primitives", () => {
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
