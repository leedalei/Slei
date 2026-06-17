import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Tabs, TabsList, TabsTrigger } from "./tabs";

describe("Tabs", () => {
  it("keeps line tabs at the shared app tab height while binding sizing to Radix orientation attributes", () => {
    const html = renderToStaticMarkup(
      <Tabs defaultValue="profile">
        <TabsList aria-label="成员配置" variant="line">
          <TabsTrigger value="profile">资料</TabsTrigger>
          <TabsTrigger value="activity">活动</TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    expect(html).toContain('data-orientation="horizontal"');
    expect(html).toContain("data-[orientation=horizontal]:flex-col");
    expect(html).toContain("group-data-[orientation=horizontal]/tabs:h-8");
    expect(html).toContain("gap-4");
    expect(html).toContain("p-0");
    expect(html).not.toContain("border-b");
    expect(html).toContain("group-data-[variant=line]/tabs-list:py-0");
    expect(html).toContain("group-data-[variant=line]/tabs-list:data-active:font-bold");
    expect(html).toContain("group-data-[variant=line]/tabs-list:data-active:text-primary");
    expect(html).toContain("after:bg-primary");
    expect(html).toContain("group-data-[orientation=horizontal]/tabs:after:bottom-[-8px]");
    expect(html).toContain("group-data-[orientation=horizontal]/tabs:after:h-[3px]");
    expect(html).not.toContain(["data", "horizontal:flex-col"].join("-"));
    expect(html).not.toContain(["group", "data", "horizontal/tabs:h-6"].join("-"));
  });
});
