# Slei Chinese Members MVP Spec

## Summary

This spec fixes three desktop MVP gaps: the default channel model, the default UI language, and the Members/agent role management surface. The desktop React app should feel like a Chinese-first local product by default, with only the `#all` channel visible until real channel creation exists. Members should move from a card gallery to a management layout: member list on the left, selected member details and configuration on the right.

## Requirements

1. **Default channel**
   - The default fixture and first-render UI include only one channel: `#all`.
   - The channel description is Chinese.
   - No `runtime` or `mvp` fixture channels should render by default.

2. **Chinese-first desktop UI**
   - `SleiApp` keeps `locale="zh-CN"` as the default.
   - React shell visible labels are Chinese: navigation labels, context sidebar labels, Chat header, composer, Tasks, Members, Computers, Settings, onboarding-adjacent labels where touched.
   - Icon-only nav may keep accessible labels, but those labels should also be Chinese by default.

3. **Members/agent role management**
   - Members page follows the provided screenshot structure.
   - The left context sidebar is a members navigator, not a generic summary panel.
   - The members navigator includes:
     - page title `成员`
     - graph entry
     - `AGENTS` group with add button, node hint, agent rows, selected row, status dots
     - `HUMANS` group with add button and current human user
   - The right detail surface includes:
     - top identity header with avatar, display name, one-line description, and action buttons
     - tab strip: 资料, 权限, Agent 私信, 提醒, 工作区, 应用, 活动
     - selected Profile/资料 tab with screenshot-equivalent sections:
       - DISPLAY NAME / 显示名称
       - DESCRIPTION / 描述
       - INFO / 信息: Computer, Created, Creator
       - RUNTIME CONFIGURATION / Runtime 配置: Runtime and Model
       - ENVIRONMENT VARIABLES / 环境变量
       - CREATED AGENTS / 创建的 Agent
       - Loading skills / 正在加载技能
       - ACTIONS / 操作: Stop Agent, Restart / Reset, Copy Diagnostic Info
   - Full editing/persistence is out of scope for this pass; the selected screenshot-like agent is fixture-backed.

## Screenshot Mapping

- Screenshot selected agent `Coda` maps to fixture agent `Coda`.
- Screenshot English field labels are localized to Chinese where they are visible product UI, while the section structure and field set are preserved.
- Pixel-perfect matching is not required in this implementation pass; structure, information architecture, and configuration fields are required.

## Assumptions

- The page remains backed by fixtures until daemon member APIs exist.
- Neo-Brutalism styling remains token-driven through `@slei/ui` semantic variables.

## Test Plan

- Add React SSR tests for:
  - default channel list contains only `# all`
  - default React shell visible strings are Chinese
  - Members page renders screenshot-level navigator, tabs, profile sections, runtime config, env/created-agent empty states, and actions
- Run:
  - `pnpm --filter @slei/desktop test -- chinese-members.spec.tsx react-shell.spec.tsx desktop-interactions.spec.tsx`
  - `pnpm --filter @slei/desktop lint`
  - `pnpm --filter @slei/desktop typecheck`
  - `pnpm --filter @slei/desktop test`
  - `pnpm --filter @slei/desktop build`
