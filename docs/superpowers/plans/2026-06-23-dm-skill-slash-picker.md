# DM Skill Slash Picker Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a DM-only `/skill` picker that inserts `/${skill.name} ` from the current Agent's daemon-provided skills and highlights only the leading `/skillName` token in DM messages.

**Architecture:** Keep daemon as the source of truth by loading skills through `listAgentSkills(agentId)` and storing them on `SleiMember.skills`. Add pure frontend helpers for slash query parsing, suggestion filtering, insertion, and leading token detection; `ChatPageView` consumes those helpers and never scans files. Message highlighting happens only for DM messages by splitting a leading token before passing the remaining body to the existing Markdown renderer.

**Tech Stack:** React 19, TypeScript, Vitest/jsdom, Tauri bridge DTOs, existing Slei design system components.

---

## File Structure

- Modify `apps/desktop/src/app/model.ts`
  - Add `ActiveSkillSlashQuery`, `activeSkillSlashQuery`, `skillSlashSuggestions`, `insertSkillSlash`, and `leadingSkillSlashToken`.
  - Reuse existing `moveMentionSelection` for keyboard movement; no new selection helper is needed.
- Modify `apps/desktop/src/app/model.test.ts`
  - Add unit tests for slash query parsing, suggestions, insertion, and leading token matching.
- Modify `apps/desktop/src/i18n/messages/zh-CN/chat.ts`
  - Add `chooseSkill`.
- Modify `apps/desktop/src/i18n/messages/en-US/chat.ts`
  - Add `chooseSkill`.
- Create `apps/desktop/src/features/chat/SkillSlashPicker.tsx`
  - Render current DM Agent skill suggestions with `/name`, description, keyboard selection state, and click handling.
- Modify `apps/desktop/src/features/chat/ChatPageView.tsx`
  - Wire DM-only slash query state, render `SkillSlashPicker`, handle keyboard selection, and render leading skill token badges for DM messages.
- Modify `apps/desktop/src/features/chat/ChatPageView.test.tsx`
  - Add DOM and keyboard coverage for DM picker, channel non-trigger, and message highlighting.
- Modify `apps/desktop/src/app/SleiApp.tsx`
  - Export a small async helper for loading missing active DM Agent skills, then call it from a `useEffect` when an active DM conversation opens.
- Modify `apps/desktop/src/app/SleiApp.test.ts`
  - Add pure helper coverage for DM skill lazy loading success and failure, matching the file's current non-jsdom test style.

## Task 1: Model Helpers

**Files:**
- Modify: `apps/desktop/src/app/model.ts`
- Modify: `apps/desktop/src/app/model.test.ts`

- [ ] **Step 1: Write failing helper tests**

Add imports to `apps/desktop/src/app/model.test.ts`:

```ts
import {
  activeSkillSlashQuery,
  insertSkillSlash,
  leadingSkillSlashToken,
  skillSlashSuggestions,
  // keep existing imports
} from "./model";
```

Add a test block near `describe("mention suggestions", ...)`:

```ts
describe("skill slash helpers", () => {
  const skills = [
    { id: "memory", name: "memory", trigger: "Remember facts", path: "/tmp/.claude/skills/memory/SKILL.md" },
    { id: "guide-create", name: "guide-create", trigger: "Create agents", path: "/tmp/.claude/skills/guide-create/SKILL.md" },
  ];

  it("detects only literal-start slash queries", () => {
    expect(activeSkillSlashQuery("/")).toEqual({ query: "", start: 0, end: 1 });
    expect(activeSkillSlashQuery("/me")).toEqual({ query: "me", start: 0, end: 3 });
    expect(activeSkillSlashQuery(" /me")).toBeNull();
    expect(activeSkillSlashQuery("hi /me")).toBeNull();
    expect(activeSkillSlashQuery("请用 /memory")).toBeNull();
    expect(activeSkillSlashQuery("/memory remember this")).toBeNull();
  });

  it("filters suggestions by skill name and id", () => {
    expect(skillSlashSuggestions("me", skills).map((skill) => skill.id)).toEqual(["memory"]);
    expect(skillSlashSuggestions("guide", skills).map((skill) => skill.id)).toEqual(["guide-create"]);
    expect(skillSlashSuggestions("", skills).map((skill) => skill.id)).toEqual(["memory", "guide-create"]);
  });

  it("inserts a selected slash skill with a trailing space", () => {
    const slash = activeSkillSlashQuery("/me");
    expect(slash).not.toBeNull();
    expect(insertSkillSlash("/me", slash!, skills[0])).toBe("/memory ");
  });

  it("matches only known leading skill tokens", () => {
    expect(leadingSkillSlashToken("/memory remember this", skills)).toEqual({
      skill: skills[0],
      token: "/memory",
      rest: " remember this",
    });
    expect(leadingSkillSlashToken("/guide-create", skills)?.skill.id).toBe("guide-create");
    expect(leadingSkillSlashToken(" /memory", skills)).toBeNull();
    expect(leadingSkillSlashToken("please /memory", skills)).toBeNull();
    expect(leadingSkillSlashToken("/unknown", skills)).toBeNull();
  });
});
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run:

```bash
pnpm --filter @slei/desktop test -- apps/desktop/src/app/model.test.ts
```

Expected: FAIL because the slash helper exports do not exist.

- [ ] **Step 3: Implement helper types and functions**

In `apps/desktop/src/app/model.ts`, update the daemon-bridge import:

```ts
import type { AppLocale, AppearancePreferences, ConversationAttachmentView, DaemonBridge, DesktopNodeView, NotificationPreferences, SkillView } from "../lib/daemon-bridge";
```

Add near `ActiveMention`:

```ts
export type ActiveSkillSlashQuery = {
  query: string;
  start: number;
  end: number;
};
```

Add near the existing mention helpers:

```ts
export function activeSkillSlashQuery(draft: string): ActiveSkillSlashQuery | null {
  const match = /^\/([\w-]*)$/u.exec(draft);
  if (!match) return null;
  return {
    query: match[1] ?? "",
    start: 0,
    end: draft.length,
  };
}

export function skillSlashSuggestions(query: string, skills: SkillView[]): SkillView[] {
  const normalized = normalizeSearch(query.replace(/^\//, ""));
  return skills.filter((skill) => {
    const name = normalizeSearch(skill.name);
    const id = normalizeSearch(skill.id);
    return Boolean(skill.name.trim()) && (!normalized || name.includes(normalized) || id.includes(normalized));
  });
}

export function insertSkillSlash(draft: string, slash: ActiveSkillSlashQuery, skill: Pick<SkillView, "name">): string {
  const name = skill.name.trim();
  if (!name) return draft;
  return `${draft.slice(0, slash.start)}/${name} ${draft.slice(slash.end)}`;
}

export function leadingSkillSlashToken(body: string, skills: SkillView[]): { skill: SkillView; token: string; rest: string } | null {
  const match = /^\/([\w-]+)(?=$|\s)/u.exec(body);
  if (!match) return null;
  const tokenName = match[1] ?? "";
  const normalized = normalizeSearch(tokenName);
  const skill = skills.find((candidate) =>
    normalizeSearch(candidate.name) === normalized || normalizeSearch(candidate.id) === normalized,
  );
  if (!skill) return null;
  return {
    skill,
    token: match[0],
    rest: body.slice(match[0].length),
  };
}
```

- [ ] **Step 4: Run helper tests to verify they pass**

Run:

```bash
pnpm --filter @slei/desktop test -- apps/desktop/src/app/model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit helper slice**

```bash
git add apps/desktop/src/app/model.ts apps/desktop/src/app/model.test.ts
git commit -m "feat(desktop): add skill slash helpers"
```

## Task 2: DM Skill Loading In App State

**Files:**
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/SleiApp.test.ts`

- [ ] **Step 1: Confirm the existing SleiApp test style**

Open `apps/desktop/src/app/SleiApp.test.ts`. It currently tests exported pure helpers and does not mount `SleiApp` in jsdom. Keep this task aligned with that style by adding an exported async helper in `SleiApp.tsx` and testing the helper directly.

- [ ] **Step 2: Write failing tests for the helper**

In `apps/desktop/src/app/SleiApp.test.ts`, add `vi` to the Vitest import if needed:

```ts
import { describe, expect, it, vi } from "vitest";
```

Add imports:

```ts
import {
  ensureActiveDmAgentSkills,
  // keep existing imports
} from "./SleiApp";
import type { SleiFixtures } from "./types";
```

Add a local minimal data helper near other helpers:

```ts
function dataWithDmAgent(skills?: SleiMember["skills"]): SleiFixtures {
  const member: SleiMember = {
    id: "agent_coda",
    name: "Coda",
    handle: "@coda",
    avatar: "CO",
    type: "agent",
    runtimeStatus: "idle",
    role: "Developer",
    description: "Builds features",
    computer: "Local",
    created: "2026-06-10",
    creator: "system",
    runtime: "ClaudeCode",
    model: "Sonnet",
    instructions: "",
    permissions: [],
    environmentVariables: [],
    createdAgents: [],
    activity: "",
    capabilities: [],
    skills,
  };
  return {
    nodes: [],
    channels: [{ id: "all", name: "all", description: "All", unread: 0 }],
    messages: [],
    tasks: [],
    members: [member],
    conversations: [{ id: "dm_agent_coda", kind: "dm", agentId: "agent_coda", createdAt: "0", updatedAt: "0" }],
    conversationSessions: [],
    channelSessions: [],
  };
}
```

Add tests:

```ts
describe("ensureActiveDmAgentSkills", () => {
  it("loads missing skills for the active DM agent", async () => {
    const data = dataWithDmAgent(undefined);
    const listAgentSkills = vi.fn().mockResolvedValue({
      skills: [{ id: "memory", name: "memory", trigger: "Remember facts", path: "/tmp/memory/SKILL.md" }],
    });

    const next = await ensureActiveDmAgentSkills({
      activeConversationId: "dm_agent_coda",
      data,
      listAgentSkills,
    });

    expect(listAgentSkills).toHaveBeenCalledWith("agent_coda");
    expect(next.members[0].skills?.map((skill) => skill.id)).toEqual(["memory"]);
  });

  it("does not reload skills that are already present", async () => {
    const data = dataWithDmAgent([]);
    const listAgentSkills = vi.fn();

    await expect(ensureActiveDmAgentSkills({ activeConversationId: "dm_agent_coda", data, listAgentSkills })).resolves.toBe(data);

    expect(listAgentSkills).not.toHaveBeenCalled();
  });

  it("keeps current data when loading skills fails", async () => {
    const data = dataWithDmAgent(undefined);
    const listAgentSkills = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(ensureActiveDmAgentSkills({ activeConversationId: "dm_agent_coda", data, listAgentSkills })).resolves.toBe(data);
  });

  it("ignores channel context and non-DM conversations", async () => {
    const data = dataWithDmAgent(undefined);
    const listAgentSkills = vi.fn();

    await expect(ensureActiveDmAgentSkills({ activeConversationId: undefined, data, listAgentSkills })).resolves.toBe(data);
    await expect(ensureActiveDmAgentSkills({ activeConversationId: "missing", data, listAgentSkills })).resolves.toBe(data);

    expect(listAgentSkills).not.toHaveBeenCalled();
  });

  it("wires the active DM effect through the helper", () => {
    const source = readFileSync(join(process.cwd(), "src/app/SleiApp.tsx"), "utf8");
    expect(source).toContain("ensureActiveDmAgentSkills({");
    expect(source).toContain("listAgentSkills: bridge.listAgentSkills");
  });
});
```

- [ ] **Step 3: Run SleiApp tests to verify they fail**

Run:

```bash
pnpm --filter @slei/desktop test -- apps/desktop/src/app/SleiApp.test.ts
```

Expected: FAIL because active DM does not yet trigger skill loading.

- [ ] **Step 4: Implement the exported helper**

In `apps/desktop/src/app/SleiApp.tsx`, export a helper near existing exported helper functions:

```ts
export async function ensureActiveDmAgentSkills(input: {
  activeConversationId?: string;
  data: SleiFixtures;
  listAgentSkills: (agentId: string) => Promise<SkillListReceipt>;
}): Promise<SleiFixtures> {
  if (!input.activeConversationId) return input.data;
  const conversation = input.data.conversations.find((candidate) => candidate.id === input.activeConversationId);
  if (conversation?.kind !== "dm") return input.data;
  const member = input.data.members.find((candidate) => candidate.id === conversation.agentId);
  if (!member || member.type !== "agent" || member.skills) return input.data;

  try {
    const receipt = await input.listAgentSkills(member.id);
    return createEmptySleiData({
      ...input.data,
      members: input.data.members.map((candidate) =>
        candidate.id === member.id ? { ...candidate, skills: receipt.skills } : candidate,
      ),
    });
  } catch {
    return input.data;
  }
}
```

Add `SkillListReceipt` to the type imports from `../lib/daemon-bridge` if needed.

- [ ] **Step 5: Wire the helper into SleiApp**

Find the existing effect that loads active member skills:

```ts
useEffect(() => {
  if (!activeMemberId) return;
  const member = data.members.find((candidate) => candidate.id === activeMemberId);
  if (!member || member.type !== "agent" || member.skills) return;
  // ...
}, [activeMemberId, bridge, data.members]);
```

Add a sibling effect for active DM conversations:

```ts
useEffect(() => {
  let mounted = true;
  ensureActiveDmAgentSkills({
    activeConversationId,
    data,
    listAgentSkills: bridge.listAgentSkills,
  })
    .then((nextData) => {
      if (!mounted) return;
      if (nextData !== data) setData(nextData);
    })
    .catch(() => undefined);

  return () => {
    mounted = false;
  };
}, [activeConversationId, bridge.listAgentSkills, data]);
```

If `activeConversationId` is not the exact state name in this file, use the existing active DM state variable.

- [ ] **Step 6: Run SleiApp tests to verify they pass**

Run:

```bash
pnpm --filter @slei/desktop test -- apps/desktop/src/app/SleiApp.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit DM skill loading slice**

```bash
git add apps/desktop/src/app/SleiApp.tsx apps/desktop/src/app/SleiApp.test.ts
git commit -m "feat(desktop): load skills for active dm"
```

## Task 3: Skill Slash Picker Component And i18n

**Files:**
- Create: `apps/desktop/src/features/chat/SkillSlashPicker.tsx`
- Modify: `apps/desktop/src/i18n/messages/zh-CN/chat.ts`
- Modify: `apps/desktop/src/i18n/messages/en-US/chat.ts`
- Modify: `apps/desktop/src/features/chat/ChatPageView.test.tsx`

- [ ] **Step 1: Write failing static render test**

In `apps/desktop/src/features/chat/ChatPageView.test.tsx`, add a test that renders a DM page with an initial slash draft and expects the skill picker label. Use `renderToStaticMarkup` first if possible:

```tsx
it("renders the DM skill slash picker for a leading slash draft", () => {
  const messages = createDesktopMessages("zh-CN");
  const member = memberWithLongMentionText();
  const data = createSleiFixtures({
    conversations: [{ id: "dm_agent_architect", kind: "dm", agentId: member.id, createdAt: "0", updatedAt: "0" }],
    members: [
      {
        ...member,
        skills: [{ id: "memory", name: "memory", trigger: "Remember facts", path: "/tmp/memory/SKILL.md" }],
      },
    ],
  });

  const html = renderToStaticMarkup(
    <ChatPage
      activeChannel={data.channels[0]}
      activeConversation={data.conversations[0]}
      data={data}
      initialDraft="/"
      messages={messages}
      profile={defaultProfile}
    />,
  );

  expect(html).toContain(messages.chat.chooseSkill);
  expect(html).toContain("/memory");
});
```

- [ ] **Step 2: Run ChatPageView test to verify it fails**

Run:

```bash
pnpm --filter @slei/desktop test -- apps/desktop/src/features/chat/ChatPageView.test.tsx
```

Expected: FAIL because `chooseSkill` and `SkillSlashPicker` do not exist.

- [ ] **Step 3: Add i18n key**

In `apps/desktop/src/i18n/messages/zh-CN/chat.ts`, add near `chooseMentionMember`:

```ts
chooseSkill: "选择技能",
```

In `apps/desktop/src/i18n/messages/en-US/chat.ts`, add:

```ts
chooseSkill: "Choose skill",
```

- [ ] **Step 4: Create SkillSlashPicker**

Create `apps/desktop/src/features/chat/SkillSlashPicker.tsx`:

```tsx
import type { SkillView } from "../../lib/daemon-bridge";
import type { DesktopMessages } from "../../i18n";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { ScrollArea } from "../../components/ui/scroll-area";
import { cn } from "../../lib/utils";

export function SkillSlashPicker({
  messages,
  onSelect,
  optionRef,
  selectedIndex,
  skills,
}: {
  messages: DesktopMessages;
  onSelect: (index: number) => void;
  optionRef?: (index: number, node: HTMLButtonElement | null) => void;
  selectedIndex: number;
  skills: SkillView[];
}) {
  if (skills.length === 0) return null;

  return (
    <Card aria-label={messages.chat.chooseSkill} className="max-h-[12.5rem] w-full max-w-full gap-2 overflow-hidden py-2" data-testid="slei-skill-slash-panel" size="sm">
      <CardContent className="grid min-h-0 gap-1 px-2">
        <ScrollArea className="max-h-[10.5rem] min-h-0 pr-2">
          <div className="grid min-w-0 gap-1">
            {skills.map((skill, index) => (
              <Button
                aria-current={index === selectedIndex ? "true" : undefined}
                className={cn("h-auto min-h-12 w-full min-w-0 max-w-full overflow-hidden justify-start gap-2 px-2 py-2 text-left", index === selectedIndex && "bg-accent text-accent-foreground")}
                data-skill-slash-option-index={index}
                key={skill.id}
                onClick={() => onSelect(index)}
                ref={(node) => optionRef?.(index, node)}
                type="button"
                variant="ghost"
              >
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <strong className="truncate text-sm">/{skill.name}</strong>
                  {skill.trigger ? <small className="block truncate text-xs font-normal text-muted-foreground">{skill.trigger}</small> : null}
                </span>
              </Button>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Wire minimal render in ChatPageView**

In `apps/desktop/src/features/chat/ChatPageView.tsx`:

- Import helpers and component:

```ts
import { activeSkillSlashQuery, insertSkillSlash, skillSlashSuggestions, /* existing imports */ } from "../../app/model";
import { SkillSlashPicker } from "./SkillSlashPicker";
```

- Add refs/state near mention state:

```ts
const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
const skillOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
```

- Compute candidates after `dmMember` is known:

```ts
const skillSlash = dmMember ? activeSkillSlashQuery(draft) : null;
const skillSlashTargets = skillSlash ? skillSlashSuggestions(skillSlash.query, dmMember.skills ?? []) : [];
```

- Add a `selectSkillSlash` function:

```ts
function selectSkillSlash(index = selectedSkillIndex) {
  if (!skillSlash || !skillSlashTargets[index]) return;
  setDraft(insertSkillSlash(draft, skillSlash, skillSlashTargets[index]));
  setSelectedSkillIndex(0);
}
```

- Render before the form, next to mention picker:

```tsx
{skillSlash && skillSlashTargets.length > 0 ? (
  <div className="px-4 pt-3">
    <SkillSlashPicker
      messages={messages}
      onSelect={selectSkillSlash}
      optionRef={(index, node) => {
        skillOptionRefs.current[index] = node;
      }}
      selectedIndex={selectedSkillIndex}
      skills={skillSlashTargets}
    />
  </div>
) : null}
```

Do not add keyboard handling yet; this task only gets static rendering working.

- [ ] **Step 6: Run static render test**

Run:

```bash
pnpm --filter @slei/desktop test -- apps/desktop/src/features/chat/ChatPageView.test.tsx
```

Expected: PASS for the new render test; unrelated existing tests should continue passing.

- [ ] **Step 7: Commit picker render slice**

```bash
git add apps/desktop/src/features/chat/SkillSlashPicker.tsx apps/desktop/src/features/chat/ChatPageView.tsx apps/desktop/src/features/chat/ChatPageView.test.tsx apps/desktop/src/i18n/messages/zh-CN/chat.ts apps/desktop/src/i18n/messages/en-US/chat.ts
git commit -m "feat(desktop): render dm skill slash picker"
```

## Task 4: Composer Keyboard Interaction

**Files:**
- Modify: `apps/desktop/src/features/chat/ChatPageView.tsx`
- Modify: `apps/desktop/src/features/chat/ChatPageView.test.tsx`

- [ ] **Step 1: Write failing interaction tests**

In `ChatPageView.test.tsx`, add jsdom interaction tests using existing `mountChatPage` helper:

```tsx
it("does not render the skill picker in channels", async () => {
  const messages = createDesktopMessages("zh-CN");
  const data = createSleiFixtures({
    members: [memberWithLongMentionText()],
  });

  const container = await mountChatPage(
    <ChatPage
      activeChannel={data.channels[0]}
      data={data}
      initialDraft="/"
      messages={messages}
      profile={defaultProfile}
    />,
  );

  expect(container.querySelector('[data-testid="slei-skill-slash-panel"]')).toBeNull();
});

it("selects a DM skill slash option with keyboard", async () => {
  const messages = createDesktopMessages("zh-CN");
  const member = {
    ...memberWithLongMentionText(),
    skills: [
      { id: "guide-create", name: "guide-create", trigger: "Create agents", path: "/tmp/guide/SKILL.md" },
      { id: "memory", name: "memory", trigger: "Remember facts", path: "/tmp/memory/SKILL.md" },
    ],
  };
  const data = createSleiFixtures({
    conversations: [{ id: "dm_agent_architect", kind: "dm", agentId: member.id, createdAt: "0", updatedAt: "0" }],
    members: [member],
  });
  const container = await mountChatPage(
    <ChatPage
      activeChannel={data.channels[0]}
      activeConversation={data.conversations[0]}
      data={data}
      initialDraft="/me"
      messages={messages}
      profile={defaultProfile}
    />,
  );

  const input = container.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]')!;
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });

  expect(input.value).toBe("/memory ");
});
```

Add a test for arrow movement:

```tsx
it("moves the selected DM skill slash option with arrow keys", async () => {
  // mount DM with initialDraft="/" and at least two skills
  // assert option 0 has aria-current="true"
  // dispatch ArrowDown
  // assert option 1 has aria-current="true"
  // dispatch ArrowUp
  // assert option 0 has aria-current="true"
});
```

Add a test for `Tab` selection:

```tsx
it("selects a DM skill slash option with Tab", async () => {
  // mount DM with initialDraft="/me"
  // dispatch Tab
  expect(input.value).toBe("/memory ");
});
```

Add a test for `Escape`:

```tsx
it("clears the leading skill slash query with Escape", async () => {
  // mount DM with initialDraft="/me"
  // dispatch Escape
  expect(input.value).toBe("");
  expect(container.querySelector('[data-testid="slei-skill-slash-panel"]')).toBeNull();
});
```

- [ ] **Step 2: Run interaction tests to verify they fail**

Run:

```bash
pnpm --filter @slei/desktop test -- apps/desktop/src/features/chat/ChatPageView.test.tsx
```

Expected: FAIL for keyboard selection and Escape.

- [ ] **Step 3: Add scroll effect for selected skill**

In `ChatPageView.tsx`, add effect near mention scroll effect:

```ts
useEffect(() => {
  if (!skillSlash || skillSlashTargets.length === 0) return;
  skillOptionRefs.current[selectedSkillIndex]?.scrollIntoView({ block: "nearest" });
}, [skillSlash, skillSlashTargets.length, selectedSkillIndex]);
```

- [ ] **Step 4: Add keyboard handling**

In textarea `onKeyDown`, compute both target flags:

```ts
const hasMentionTargets = Boolean(mention && mentionTargets.length > 0);
const hasSkillSlashTargets = Boolean(skillSlash && skillSlashTargets.length > 0);
```

Before mention handling, add skill handling because slash picker is more constrained and should own Enter/Tab while active:

```ts
if (!composing && skillSlash && skillSlashTargets.length > 0) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    setSelectedSkillIndex((current) => moveMentionSelection(current, 1, skillSlashTargets.length));
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    setSelectedSkillIndex((current) => moveMentionSelection(current, -1, skillSlashTargets.length));
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    setDraft(draft.slice(0, skillSlash.start));
    setSelectedSkillIndex(0);
    return;
  }
  if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    selectSkillSlash();
    return;
  }
}
```

Leave `composerShortcutAction` unchanged; it remains mention/submit aware. Skill slash handling is local to `ChatPageView`.

- [ ] **Step 5: Reset selected index when query changes**

Add an effect:

```ts
useEffect(() => {
  setSelectedSkillIndex(0);
}, [skillSlash?.query, dmMember?.id]);
```

This prevents stale selection after filtering.

- [ ] **Step 6: Run interaction tests**

Run:

```bash
pnpm --filter @slei/desktop test -- apps/desktop/src/features/chat/ChatPageView.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit interaction slice**

```bash
git add apps/desktop/src/features/chat/ChatPageView.tsx apps/desktop/src/features/chat/ChatPageView.test.tsx
git commit -m "feat(desktop): support dm skill slash keyboard selection"
```

## Task 5: DM Message Leading Skill Token Highlight

**Files:**
- Modify: `apps/desktop/src/features/chat/ChatPageView.tsx`
- Modify: `apps/desktop/src/features/chat/ChatPageView.test.tsx`

- [ ] **Step 1: Write failing highlight tests**

In `ChatPageView.test.tsx`, add render tests:

```tsx
it("highlights only a known leading DM skill slash token", () => {
  const messages = createDesktopMessages("zh-CN");
  const member = {
    ...memberWithLongMentionText(),
    skills: [{ id: "memory", name: "memory", trigger: "Remember facts", path: "/tmp/memory/SKILL.md" }],
  };
  const data = createSleiFixtures({
    conversations: [{ id: "dm_agent_architect", kind: "dm", agentId: member.id, createdAt: "0", updatedAt: "0" }],
    members: [member],
    messages: [
      {
        id: "msg_skill",
        author: "Lei",
        role: "human",
        time: "10:00",
        body: "/memory **重点**",
        channelId: "dm_agent_architect",
      },
    ],
  });

  const html = renderToStaticMarkup(
    <ChatPage
      activeChannel={data.channels[0]}
      activeConversation={data.conversations[0]}
      data={data}
      messages={messages}
      profile={defaultProfile}
    />,
  );

  expect(html).toContain("slei-message-skill");
  expect(html).toContain("/memory");
  expect(html).toContain("<strong>重点</strong>");
});

it("does not highlight middle, unknown, or channel slash tokens", () => {
  // Render one DM message body "请用 /memory" and assert no slei-message-skill.
  // Render one DM message body "/unknown" and assert no slei-message-skill.
  // Render one channel message body "/memory" and assert no slei-message-skill.
});
```

- [ ] **Step 2: Run highlight tests to verify they fail**

Run:

```bash
pnpm --filter @slei/desktop test -- apps/desktop/src/features/chat/ChatPageView.test.tsx
```

Expected: FAIL because no skill token is rendered.

- [ ] **Step 3: Import leading token helper**

In `ChatPageView.tsx`, add `leadingSkillSlashToken` to the `../../app/model` imports.

- [ ] **Step 4: Add local renderer helper**

Near other local render helpers in `ChatPageView.tsx`, add:

```tsx
function MessageBody({ body, skillToken }: { body: string; skillToken?: ReturnType<typeof leadingSkillSlashToken> }) {
  if (!skillToken) {
    return <MarkdownMessage markdown={body} />;
  }
  const rest = skillToken.rest;
  return (
    <div className="slei-markdown-message mt-1 max-w-none text-sm leading-relaxed text-foreground">
      <span className="slei-message-skill inline-flex items-center rounded-md bg-accent px-1.5 py-0.5 font-mono text-xs font-medium text-accent-foreground">
        {skillToken.token}
      </span>
      {rest ? <MarkdownMessage markdown={rest.replace(/^\s+/, "")} /> : null}
    </div>
  );
}
```

If nesting `MarkdownMessage` inside a div creates doubled top margin, adjust classes so the test and screenshot remain visually clean. Keep the token class `slei-message-skill` stable for tests.

- [ ] **Step 5: Use helper in timeline rendering**

Replace the existing timeline body render:

```tsx
<MarkdownMessage markdown={message.body} />
```

with:

```tsx
<MessageBody
  body={message.body}
  skillToken={dmMember ? leadingSkillSlashToken(message.body, dmMember.skills ?? []) : null}
/>
```

Because `dmMember` is only set for DM conversations, channel messages never get skill highlighting.

- [ ] **Step 6: Run highlight tests**

Run:

```bash
pnpm --filter @slei/desktop test -- apps/desktop/src/features/chat/ChatPageView.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit highlight slice**

```bash
git add apps/desktop/src/features/chat/ChatPageView.tsx apps/desktop/src/features/chat/ChatPageView.test.tsx
git commit -m "feat(desktop): highlight leading dm skill slash token"
```

## Task 6: Final Verification

**Files:**
- All files changed by Tasks 1-5.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
pnpm --filter @slei/desktop test -- apps/desktop/src/app/model.test.ts apps/desktop/src/features/chat/ChatPageView.test.tsx apps/desktop/src/app/SleiApp.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 3: Run locale verification if available**

Run:

```bash
pnpm verify:locales
```

If the script name differs, inspect `package.json` and use the existing locale verification command. Expected: PASS.

- [ ] **Step 4: Inspect git history and status**

Run:

```bash
git status --short
git log --oneline -6
```

Expected: worktree clean except any intentionally uncommitted artifacts; recent commits show the plan and feature slices.

- [ ] **Step 5: Final handoff**

Report:

- Files changed.
- Tests run and pass/fail status.
- Explicitly note that `/` works only in DM, only at the literal start of the composer, and highlighting only applies to known leading DM skill tokens.
- Ask whether to merge to `master` or another branch, as required by Slei project instructions.
