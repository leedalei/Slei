import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("desktop design-system wiring", () => {
  it("loads shared Neo-Brutalism tokens instead of local hard-coded shell colors", () => {
    const webEntry = readFileSync("src/web.ts", "utf8");
    const appCss = readFileSync("src/app/app.css", "utf8");
    const formControlsTsx = readFileSync("src/app/form-controls.tsx", "utf8");
    const tokensCss = readFileSync("../../packages/ui/src/styles/tokens.css", "utf8");

    expect(webEntry).toContain("@slei/ui/styles/tokens.css");
    expect(webEntry).toContain("@slei/ui/styles/globals.css");
    expect(webEntry).not.toContain("./web.css");
    expect(appCss).toContain("var(--color-accent)");
    expect(appCss).toContain("var(--border-panel)");
    expect(appCss).toContain("var(--shadow-lg)");
    expect(appCss).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(formControlsTsx.match(/<select/g)).toHaveLength(1);
    expect(formControlsTsx).toContain("function SelectControl");
    expect(formControlsTsx.match(/type=\"checkbox\"/g)).toHaveLength(1);
    expect(formControlsTsx).toContain("function CheckboxControl");
    expect(tokensCss).toContain("--rail-width: var(--primitive-space-16);");
    expect(tokensCss).toContain("--sidebar-width: 240px;");
    expect(tokensCss).toContain("--radius-control: var(--radius-none);");
  });

  it("keeps global scrollbars compact and neutral", () => {
    const appCss = readFileSync("src/app/app.css", "utf8");

    expect(appCss).toContain("--scrollbar-size: 8px");
    expect(appCss).toContain("--scrollbar-radius: 8px");
    expect(appCss).toContain("--scrollbar-thumb: rgb(128 128 128 / 48%)");
    expect(appCss).toContain("scrollbar-width: thin");
    expect(appCss).toContain("border-radius: var(--scrollbar-radius)");
  });

  it("keeps custom window controls compact and visually quiet", () => {
    const appCss = readFileSync("src/app/app.css", "utf8");
    const windowControlRule = appCss.match(/\.slei-window-control\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body ?? "";

    expect(appCss).toContain(".slei-window-control__glyph");
    expect(windowControlRule).toContain("height: 22px");
    expect(windowControlRule).toContain("width: 22px");
    expect(windowControlRule).toContain("background: transparent");
    expect(windowControlRule).toContain("border: 0");
    expect(windowControlRule).not.toContain("box-shadow");
    expect(appCss).not.toContain(".slei-window-control--close::before {\n  background: var(--color-danger);");
    expect(appCss).not.toContain(".slei-window-control--minimize::before {\n  background: var(--color-warning);");
    expect(appCss).not.toContain(".slei-window-control--maximize::before {\n  background: var(--color-success);");
  });
});
