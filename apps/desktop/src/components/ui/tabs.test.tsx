import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Tabs, TabsList, TabsTrigger } from "./tabs";

describe("Tabs", () => {
  it("binds horizontal line tab sizing to Radix orientation attributes", () => {
    const html = renderToStaticMarkup(
      <Tabs defaultValue="chat">
        <TabsList aria-label="Views" variant="line">
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    expect(html).toContain('data-orientation="horizontal"');
    expect(html).toContain("data-[orientation=horizontal]:flex-col");
    expect(html).toContain("group-data-[orientation=horizontal]/tabs:h-8");
    expect(html).toContain("group-data-[orientation=horizontal]/tabs:after:bottom-[-5px]");
    expect(html).not.toContain(["data", "horizontal:flex-col"].join("-"));
    expect(html).not.toContain(["group", "data", "horizontal/tabs:h-8"].join("-"));
  });
});
