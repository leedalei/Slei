import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("desktop design-system wiring", () => {
  it("loads Animal Island styles before Slei semantic overrides", () => {
    const webEntry = readFileSync("src/web.ts", "utf8");
    const appCss = readFileSync("src/app/app.css", "utf8");
    const formControlsTsx = readFileSync("src/components/FormControls.tsx", "utf8");
    const tokensCss = readFileSync("../../packages/ui/src/styles/tokens.css", "utf8");

    expect(webEntry).toContain("animal-island-ui/style");
    expect(webEntry.indexOf("animal-island-ui/style")).toBeLessThan(webEntry.indexOf("@slei/ui/styles/tokens.css"));
    expect(webEntry.indexOf("animal-island-ui/style")).toBeLessThan(webEntry.indexOf("@slei/ui/styles/globals.css"));
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
    expect(tokensCss).toContain("--rail-width: 80px;");
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

  it("reserves overlay titlebar space inside the left rail", () => {
    const appCss = readFileSync("src/app/app.css", "utf8");
    const railRule = appCss.match(/\.slei-rail\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body ?? "";
    const railButtonRule = appCss.match(/\.slei-rail__button\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body ?? "";
    const railLabelRule = appCss.match(/\.slei-rail__label\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body ?? "";

    expect(railRule).toContain("align-items: center");
    expect(railRule).toContain("box-shadow: var(--border-panel) 0 0 var(--color-border)");
    expect(railRule).not.toContain("border-right");
    expect(railRule).toContain("padding: var(--titlebar-height) var(--gap-sm) var(--gap-sm)");
    expect(railButtonRule).toContain("width: 64px");
    expect(railButtonRule).toContain("justify-items: center");
    expect(railLabelRule).toContain("font-size: 12px");
    expect(appCss).not.toContain(".slei-window-control");
  });

  it("renders the rail brand mark as text without an image tile", () => {
    const appCss = readFileSync("src/app/app.css", "utf8");
    const brandRule = appCss.match(/\.slei-brand\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body ?? "";
    const brandMarkRule = appCss.match(/\.slei-brand__mark\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body ?? "";

    expect(brandRule).toContain("background: transparent");
    expect(brandRule).toContain("border: 0");
    expect(brandRule).toContain("box-shadow: none");
    expect(brandRule).toContain("justify-content: center");
    expect(brandRule).toContain("width: 64px");
    expect(appCss).not.toContain(".slei-brand__logo");
    expect(brandMarkRule).toContain("font-weight: var(--weight-black)");
    expect(brandMarkRule).toContain("font-style: italic");
  });
});
