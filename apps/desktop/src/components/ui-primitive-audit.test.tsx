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

    expect(buttonSource).toContain("slei-raised-small");
    expect(buttonSource).toContain("slei-raised-medium");
    expect(buttonSource).not.toContain("shadow-[var(--slei-shadow-raised-");
    expect(buttonSource).toContain("border-[var(--slei-raised-border)]");
    expect(buttonSource).not.toContain("shadow-sm");
    expect(buttonSource).toContain('ghost:\n          "hover:bg-muted/70 hover:text-foreground');
    expect(buttonSource).toContain('link: "text-primary underline-offset-4 hover:underline"');
    expect(cardSource).toContain('variant === "raised" && "border-transparent bg-card slei-raised-large"');
    expect(cardSource).toContain("hover:slei-raised-medium");
    expect(panelSource).toContain('raised: "border-transparent bg-card slei-raised-large"');
    expect(panelSource).toContain("hover:slei-raised-medium");
  });

  it("defines reusable raised and inset neumorphic shadow size tokens", () => {
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

    for (const [size, px] of [["s", "2px"], ["m", "4px"], ["l", "6px"], ["xl", "8px"]] as const) {
      const raisedTokenMatch = appCss.match(new RegExp(`--slei-shadow-raised-${size}: ([^;]+);`));
      expect(raisedTokenMatch?.[1]).toContain("var(--slei-shadow-raised-glow)");
      expect(raisedTokenMatch?.[1]).toContain("var(--slei-shadow-raised-shade)");
      expect(raisedTokenMatch?.[1]).toContain(`-${px} -${px} 2px var(--slei-shadow-raised-glow)`);
      expect(raisedTokenMatch?.[1]).toContain(`${px} ${px} 2px var(--slei-shadow-raised-shade)`);

      const insetTokenMatch = appCss.match(new RegExp(`--slei-shadow-inset-${size}: ([^;]+);`));
      expect(insetTokenMatch?.[1]).toContain("var(--slei-shadow-inset-shade)");
      expect(insetTokenMatch?.[1]).toContain("var(--slei-shadow-highlight)");
      expect(insetTokenMatch?.[1]).toContain(`inset ${px} ${px} 2px var(--slei-shadow-inset-shade)`);
      expect(insetTokenMatch?.[1]).toContain(`inset -${px} -${px} 2px var(--slei-shadow-highlight)`);
    }

    for (const themeCss of [lightThemeCss, darkThemeCss]) {
      expect(themeCss).toContain("--slei-shadow-raised-small: var(--slei-shadow-raised-s)");
      expect(themeCss).toContain("--slei-shadow-raised-medium: var(--slei-shadow-raised-m)");
      expect(themeCss).toContain("--slei-shadow-raised-large: var(--slei-shadow-raised-l)");
      expect(themeCss).toContain("--slei-shadow-inset-small: var(--slei-shadow-inset-s)");
      expect(themeCss).toContain("--slei-shadow-inset-medium: var(--slei-shadow-inset-m)");
      expect(themeCss).toContain("--slei-shadow-inset-large: var(--slei-shadow-inset-l)");
      expect(themeCss).toContain("--slei-shadow-raised: var(--slei-shadow-raised-m)");
      expect(themeCss).toContain("--slei-shadow-inset: var(--slei-shadow-inset-m)");
    }

    expect(appCss).toContain("@utility slei-raised-s");
    expect(appCss).toContain("box-shadow: var(--slei-shadow-raised-s)");
    expect(appCss).toContain("@utility slei-raised-m");
    expect(appCss).toContain("box-shadow: var(--slei-shadow-raised-m)");
    expect(appCss).toContain("@utility slei-raised-l");
    expect(appCss).toContain("box-shadow: var(--slei-shadow-raised-l)");
    expect(appCss).toContain("@utility slei-raised-xl");
    expect(appCss).toContain("box-shadow: var(--slei-shadow-raised-xl)");
    expect(appCss).toContain("@utility slei-raised-small");
    expect(appCss).toContain("box-shadow: var(--slei-shadow-raised-small)");
    expect(appCss).toContain("@utility slei-raised-medium");
    expect(appCss).toContain("box-shadow: var(--slei-shadow-raised-medium)");
    expect(appCss).toContain("@utility slei-raised-large");
    expect(appCss).toContain("box-shadow: var(--slei-shadow-raised-large)");
    expect(appCss).toContain("@utility slei-inset-s");
    expect(appCss).toContain("box-shadow: var(--slei-shadow-inset-s)");
    expect(appCss).toContain("@utility slei-inset-m");
    expect(appCss).toContain("box-shadow: var(--slei-shadow-inset-m)");
    expect(appCss).toContain("@utility slei-inset-l");
    expect(appCss).toContain("box-shadow: var(--slei-shadow-inset-l)");
    expect(appCss).toContain("@utility slei-inset-xl");
    expect(appCss).toContain("box-shadow: var(--slei-shadow-inset-xl)");
    expect(appCss).toContain("@utility slei-inset-small");
    expect(appCss).toContain("box-shadow: var(--slei-shadow-inset-small)");
    expect(appCss).toContain("@utility slei-inset-medium");
    expect(appCss).toContain("box-shadow: var(--slei-shadow-inset-medium)");
    expect(appCss).toContain("@utility slei-inset-large");
    expect(appCss).toContain("box-shadow: var(--slei-shadow-inset-large)");
  });

  it("keeps shared control radii on the 6px, 8px, and 10px scale", () => {
    const buttonSource = readSource("components/ui/button.tsx");
    const selectSource = readSource("components/ui/select.tsx");
    const badgeSource = readSource("components/ui/badge.tsx");
    const searchSource = readSource("features/search/SearchPageView.tsx");

    expect(buttonSource).not.toContain("rounded-[min(");
    expect(buttonSource).toContain('xs: "h-6 gap-1 rounded-sm');
    expect(buttonSource).toContain('sm: "h-7 gap-1 rounded-sm');
    expect(buttonSource).toContain('"icon-xs":\n          "size-6 rounded-sm');
    expect(buttonSource).toContain('"icon-sm":\n          "size-7 rounded-sm');

    expect(selectSource).toContain("rounded-lg");
    expect(selectSource).toContain("data-[size=sm]:rounded-sm");
    expect(selectSource).toContain("overflow-y-auto rounded-xl");
    expect(selectSource).toContain("gap-2 rounded-md");
    expect(selectSource).not.toContain("rounded-[12px]");
    expect(selectSource).not.toContain("rounded-[14px]");
    expect(selectSource).not.toContain("rounded-[10px]");

    expect(searchSource).toContain("const filterSelectTriggerClassName = \"min-w-36 rounded-lg");
    expect(searchSource).not.toContain("rounded-[12px]");
    expect(badgeSource).toContain("rounded-sm");
    expect(badgeSource).not.toContain("rounded-4xl");
  });

  it("uses inset shadows for text input-like and segmented controls", () => {
    const appCss = readSource("app/app.css");
    const inputSource = readSource("components/ui/input.tsx");
    const textareaSource = readSource("components/ui/textarea.tsx");

    expect(inputSource).toContain("slei-inset-small");
    expect(inputSource).toContain("slei-inset-focus-small");
    expect(inputSource).not.toContain("focus-visible:ring-3");
    expect(textareaSource).toContain("slei-inset-medium");
    expect(textareaSource).toContain("slei-inset-focus-medium");
    expect(textareaSource).not.toContain("focus-visible:ring-3");
    expect(appCss).toContain(".slei-inset-focus-small:focus-visible");
    expect(appCss).toContain("var(--slei-shadow-inset-small), 0 0 0 1px");
    expect(appCss).toContain(".slei-inset-focus-medium:focus-visible");
    expect(appCss).toContain("var(--slei-shadow-inset-medium), 0 0 0 1px");
    expect(readSource("components/ui/tabs.tsx")).toContain("slei-inset-small");
  });

  it("uses transitions-dev sliding pills for soft tabs", () => {
    const appCss = readSource("app/app.css");
    const tabsSource = readSource("components/ui/tabs.tsx");

    expect(tabsSource).toContain('className="t-tabs-pill"');
    expect(tabsSource).toContain("data-slei-tabs-pill");
    expect(tabsSource).toContain("requestAnimationFrame(() => moveTo(active(), false))");
    expect(tabsSource).toContain('window.addEventListener("resize", syncWithoutAnimation)');
    expect(tabsSource).toContain('getPropertyValue("--tabs-dur")');
    expect(appCss).toContain("--tabs-dur: 250ms");
    expect(appCss).toContain(".t-tabs-pill");
    expect(appCss).toContain("border: 1px solid color-mix(in srgb, var(--slei-shadow-highlight) 72%, var(--border));");
    expect(appCss).toContain("border-radius: var(--slei-radius-medium)");
    expect(appCss).not.toContain(".t-tabs-pill {\n  position: absolute;\n  top: 4px;\n  left: 0;\n  height: calc(100% - 8px);\n  width: 0;\n  background: var(--tabs-pill-bg);\n  border-radius: var(--slei-radius-large)");
    expect(appCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(appCss).toContain(".t-tabs-pill,");
    expect(appCss).toContain(".t-tab {");
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
    expect(selectContentSource).toContain("shadow-[var(--slei-shadow-overlay-xs)]");
    expect(selectContentSource).not.toContain("shadow-[var(--slei-shadow-raised");
    expect(selectContentSource).not.toContain("shadow-[var(--slei-shadow-inset");
  });

  it("keeps select menus flat with compact rounded corners and soft item states", () => {
    const selectSource = readSource("components/ui/select.tsx");

    expect(selectSource).toContain("shadow-none");
    expect(selectSource).toContain("shadow-[var(--slei-shadow-overlay-xs)]");
    expect(selectSource).toContain("rounded-xl");
    expect(selectSource).toContain("data-[highlighted]:bg-muted/70");
    expect(selectSource).toContain("data-[state=checked]:font-semibold");
    expect(selectSource).toContain("data-[state=open]:[&_svg:last-child]:rotate-180");
    expect(readSource("app/app.css")).toContain('[data-slot="select-item"]:focus-visible');
    expect(selectSource).not.toContain("data-[highlighted]:bg-accent");
    expect(selectSource).not.toContain("ring-1 ring-border/80");
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
