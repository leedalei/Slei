# Slei Design System — Neo-Brutalism

- Status: Design specification
- Date: 2026-05-27
- Applies to: `packages/desktop` (Tauri v2 + React + Tailwind + shadcn/ui)
- Style: Neo-Brutalism — thick solid borders, hard offset shadows, flat fills,
  strong typography, black/white primary palette, amber accent

---

## 1. Primitive Tokens

These are the raw values. They must **never** be used directly in components —
always go through semantic tokens.

### 1.1 Color Primitives

```css
/* Neutrals */
--primitive-black:   #000000;
--primitive-white:   #FFFFFF;
--primitive-gray-50: #FAFAFA;
--primitive-gray-100:#F4F4F5;
--primitive-gray-200:#E4E4E7;
--primitive-gray-300:#D4D4D8;
--primitive-gray-400:#A1A1AA;
--primitive-gray-500:#71717A;
--primitive-gray-700:#3F3F46;

/* Accent — Amber (primary Neo-Brutalism energy color) */
--primitive-amber-300: #FCD34D;
--primitive-amber-400: #FBBF24;
--primitive-amber-500: #F59E0B;

/* Status */
--primitive-green-500:  #22C55E;
--primitive-green-100:  #DCFCE7;
--primitive-blue-500:   #3B82F6;
--primitive-blue-100:   #DBEAFE;
--primitive-amber-100:  #FEF3C7;
--primitive-red-500:    #EF4444;
--primitive-red-100:    #FEE2E2;
--primitive-red-600:    #DC2626;

/* Agent identity palette (8 colors, cycle when more agents) */
--primitive-agent-1: #A78BFA;  /* violet */
--primitive-agent-2: #34D399;  /* emerald */
--primitive-agent-3: #60A5FA;  /* blue */
--primitive-agent-4: #F87171;  /* red */
--primitive-agent-5: #FBBF24;  /* amber */
--primitive-agent-6: #4ADE80;  /* green */
--primitive-agent-7: #F472B6;  /* pink */
--primitive-agent-8: #818CF8;  /* indigo */
```

### 1.2 Typography Primitives

```css
/* Sans — Inter first for Latin; Chinese glyphs fall back to system fonts */
--primitive-font-sans: 'Inter', 'PingFang SC', 'Hiragino Sans GB',
                       'Noto Sans SC', 'Microsoft YaHei', system-ui,
                       -apple-system, sans-serif;
/* Mono */
--primitive-font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code',
                       monospace;

/* Size scale */
--primitive-text-10: 10px;
--primitive-text-11: 11px;
--primitive-text-12: 12px;
--primitive-text-13: 13px;
--primitive-text-14: 14px;
--primitive-text-15: 15px;
--primitive-text-16: 16px;
--primitive-text-18: 18px;
--primitive-text-20: 20px;
--primitive-text-24: 24px;
--primitive-text-30: 30px;

/* Weight */
--primitive-weight-400: 400;
--primitive-weight-500: 500;
--primitive-weight-600: 600;
--primitive-weight-700: 700;
--primitive-weight-800: 800;
--primitive-weight-900: 900;

/* Line height */
--primitive-leading-tight:   1.2;
--primitive-leading-snug:    1.375;
--primitive-leading-normal:  1.5;
--primitive-leading-relaxed: 1.625;
```

### 1.3 Spacing Primitives (4px grid)

```css
--primitive-space-0:  0px;
--primitive-space-1:  4px;
--primitive-space-2:  8px;
--primitive-space-3:  12px;
--primitive-space-4:  16px;
--primitive-space-5:  20px;
--primitive-space-6:  24px;
--primitive-space-8:  32px;
--primitive-space-10: 40px;
--primitive-space-12: 48px;
--primitive-space-16: 64px;
--primitive-space-20: 80px;
```

### 1.4 Border Primitives

```css
--primitive-border-1: 1px;
--primitive-border-2: 2px;
--primitive-border-3: 3px;
--primitive-border-4: 4px;

--primitive-radius-0:  0px;
--primitive-radius-2:  2px;
--primitive-radius-4:  4px;
--primitive-radius-6:  6px;
--primitive-radius-8:  8px;
--primitive-radius-full: 9999px;
```

### 1.5 Shadow Primitives (hard offset, no blur — Neo-Brutalism)

```css
--primitive-shadow-2: 2px 2px 0px #000000;
--primitive-shadow-3: 3px 3px 0px #000000;
--primitive-shadow-4: 4px 4px 0px #000000;
--primitive-shadow-6: 6px 6px 0px #000000;
--primitive-shadow-8: 8px 8px 0px #000000;
--primitive-shadow-0: 0px 0px 0px #000000;
```

### 1.6 Motion Primitives

```css
--primitive-duration-fast:   100ms;
--primitive-duration-base:   150ms;
--primitive-duration-slow:   200ms;
--primitive-ease-default: cubic-bezier(0.4, 0, 0.2, 1);
```

---

## 2. Semantic Tokens

Semantic tokens map primitives to **roles**. Components use only semantic
tokens, never primitives. This is the single place to update for theme changes.

### 2.1 Color Semantics

```css
/* Surface */
--color-bg:          var(--primitive-white);       /* page background */
--color-surface:     var(--primitive-white);       /* panel / card bg */
--color-surface-alt: var(--primitive-gray-50);    /* zebra, code bg */
--color-surface-hover: var(--primitive-gray-100); /* hover row bg */

/* Text */
--color-text-primary:   var(--primitive-black);
--color-text-secondary: var(--primitive-gray-500);
--color-text-muted:     var(--primitive-gray-400);
--color-text-inverse:   var(--primitive-white);
--color-text-link:      var(--primitive-black);    /* underlined links */

/* Border */
--color-border:         var(--primitive-black);    /* all component borders */
--color-border-subtle:  var(--primitive-gray-200); /* intra-content dividers only */

/* Accent */
--color-accent:         var(--primitive-amber-400);
--color-accent-hover:   var(--primitive-amber-500);
--color-accent-subtle:  var(--primitive-amber-100);

/* Interactive states */
--color-focus-ring:     var(--primitive-amber-400);
--color-disabled-bg:    var(--primitive-gray-100);
--color-disabled-text:  var(--primitive-gray-400);

/* Status */
--color-success:       var(--primitive-green-500);
--color-success-bg:    var(--primitive-green-100);
--color-info:          var(--primitive-blue-500);
--color-info-bg:       var(--primitive-blue-100);
--color-warning:       var(--primitive-amber-500);
--color-warning-bg:    var(--primitive-amber-100);
--color-error:         var(--primitive-red-600);
--color-error-bg:      var(--primitive-red-100);

/* Run status colors */
--color-run-queued:    var(--primitive-gray-400);
--color-run-running:   var(--primitive-blue-500);
--color-run-approval:  var(--primitive-amber-500);
--color-run-done:      var(--primitive-green-500);
--color-run-failed:    var(--primitive-red-600);
--color-run-cancelled: var(--primitive-gray-400);
```

### 2.2 Typography Semantics

```css
/* Role-based font sizes */
--text-xs:      var(--primitive-text-11);   /* timestamps, secondary labels */
--text-sm:      var(--primitive-text-13);   /* badges, captions, sidebar items */
--text-base:    var(--primitive-text-14);   /* primary UI text, inputs */
--text-md:      var(--primitive-text-15);   /* message body */
--text-lg:      var(--primitive-text-16);   /* section labels */
--text-xl:      var(--primitive-text-18);   /* panel headers */
--text-2xl:     var(--primitive-text-24);   /* page titles */
--text-display: var(--primitive-text-30);   /* onboarding headings */

--text-sans: var(--primitive-font-sans);
--text-mono: var(--primitive-font-mono);

/* Weight roles */
--weight-normal:   var(--primitive-weight-400);
--weight-medium:   var(--primitive-weight-500);
--weight-semibold: var(--primitive-weight-600);
--weight-bold:     var(--primitive-weight-700);
--weight-black:    var(--primitive-weight-900); /* Neo-Brutalism headings */

/* Line height roles */
--leading-tight:   var(--primitive-leading-tight);
--leading-body:    var(--primitive-leading-relaxed); /* message content */
--leading-ui:      var(--primitive-leading-normal);  /* buttons, badges */
```

### 2.3 Border & Shadow Semantics

```css
/* Border widths by hierarchy */
--border-panel:     var(--primitive-border-3);  /* column/panel separators */
--border-card:      var(--primitive-border-2);  /* cards, modals, inputs */
--border-subtle:    var(--primitive-border-1);  /* intra-content dividers */

/* Border radius by component type */
--radius-none:      var(--primitive-radius-0);
--radius-control:   var(--primitive-radius-4);  /* buttons, inputs, cards */
--radius-modal:     var(--primitive-radius-6);  /* modals, popovers */
--radius-badge:     var(--primitive-radius-2);  /* badges, tags */
--radius-avatar:    var(--primitive-radius-4);  /* avatars (square-ish) */
--radius-full:      var(--primitive-radius-full); /* dot indicators */

/* Shadows by prominence */
--shadow-xs:    var(--primitive-shadow-2);  /* badges, small tags */
--shadow-sm:    var(--primitive-shadow-3);  /* buttons, small cards */
--shadow-md:    var(--primitive-shadow-4);  /* cards, task cards */
--shadow-lg:    var(--primitive-shadow-6);  /* modals, approval cards */
--shadow-xl:    var(--primitive-shadow-8);  /* featured / error modals */
--shadow-none:  var(--primitive-shadow-0);  /* pressed/active state */
```

### 2.4 Spacing Semantics

```css
/* Layout gaps */
--gap-xs:   var(--primitive-space-1);  /* 4px  — icon + label */
--gap-sm:   var(--primitive-space-2);  /* 8px  — inline elements */
--gap-md:   var(--primitive-space-3);  /* 12px — between related items */
--gap-lg:   var(--primitive-space-4);  /* 16px — between sections */
--gap-xl:   var(--primitive-space-6);  /* 24px — between major blocks */

/* Component padding */
--padding-badge:     2px var(--primitive-space-2);
--padding-button-sm: var(--primitive-space-1) var(--primitive-space-3);
--padding-button-md: var(--primitive-space-2) var(--primitive-space-4);
--padding-button-lg: var(--primitive-space-3) var(--primitive-space-5);
--padding-input:     var(--primitive-space-2) var(--primitive-space-3);
--padding-card:      var(--primitive-space-4);
--padding-panel:     var(--primitive-space-4);
```

### 2.5 Motion Semantics

```css
--duration-interaction: var(--primitive-duration-fast);  /* hover, focus */
--duration-transition:  var(--primitive-duration-base);  /* state changes */
--duration-appear:      var(--primitive-duration-slow);  /* panels sliding in */
--ease-ui:              var(--primitive-ease-default);
```

---

## 3. Interaction Pattern — Neo-Brutalism Press Effect

All interactive elements (buttons, clickable cards) share this press behavior.
It is the single most distinctive Neo-Brutalism interaction.

```
Default:  translate(0, 0)        shadow: --shadow-sm or --shadow-md
Hover:    translate(-1px, -1px)  shadow: --shadow-md or --shadow-lg  (lifts)
Active:   translate(2px, 2px)    shadow: --shadow-none               (presses in)
Disabled: translate(0, 0)        shadow: --shadow-none, reduced opacity
```

Transition: `transform var(--duration-interaction) var(--ease-ui), box-shadow var(--duration-interaction) var(--ease-ui)`

---

## 4. Component Specifications

Every component is built exclusively from semantic tokens. The sections below
define the **base** for each type; variants **extend** the base, never
redefine it from scratch.

---

### 4.1 Button

**Base anatomy:** `border: --border-card solid --color-border` | `radius: --radius-control` | Neo-Brutalism press effect applied to all variants.

| Property | Value |
|----------|-------|
| Font size | `--text-base` |
| Font weight | `--weight-bold` |
| Line height | `--leading-ui` |
| Border | `--border-card solid --color-border` |
| Border radius | `--radius-control` |
| Transition | press effect (see §3) |
| Cursor | `pointer` |
| Disabled opacity | `0.45`, cursor `not-allowed` |

**Variants:**

| Variant | Background | Text | Shadow |
|---------|-----------|------|--------|
| **Primary** | `--color-text-primary` (black) | `--color-text-inverse` (white) | `--shadow-sm` |
| **Secondary** | `--color-surface` (white) | `--color-text-primary` | `--shadow-sm` |
| **Accent** | `--color-accent` (amber) | `--color-text-primary` | `--shadow-sm` |
| **Destructive** | `--color-error-bg` | `--color-error` | `--shadow-sm` |
| **Ghost** | transparent | `--color-text-primary` | none |

**Sizes:**

| Size | Height | Padding | Font |
|------|--------|---------|------|
| sm | 28px | `--padding-button-sm` | `--text-sm` |
| md (default) | 36px | `--padding-button-md` | `--text-base` |
| lg | 44px | `--padding-button-lg` | `--text-lg` |
| icon-sm | 28×28px | 0 (centered) | — |
| icon-md | 36×36px | 0 (centered) | — |

**States (all variants):**

| State | Transform | Shadow | Opacity |
|-------|-----------|--------|---------|
| Default | `translate(0,0)` | `--shadow-sm` | 1 |
| Hover | `translate(-1px,-1px)` | `--shadow-md` | 1 |
| Active / Pressed | `translate(2px,2px)` | `--shadow-none` | 1 |
| Focus-visible | `translate(0,0)` | `--shadow-sm` + `outline: 2px solid --color-focus-ring; outline-offset: 2px` | 1 |
| Disabled | `translate(0,0)` | `--shadow-none` | 0.45, `cursor: not-allowed` |
| Loading | `translate(0,0)` | `--shadow-sm` | 0.7; replace label with spinner (16px) |

Transition: `transform var(--duration-interaction), box-shadow var(--duration-interaction)`

---

### 4.2 Input & Textarea

**Base anatomy:** same border/radius as Button; no shadow by default; shadow added on focus.

| Property | Value |
|----------|-------|
| Background | `--color-surface` |
| Border | `--border-card solid --color-border` |
| Border radius | `--radius-control` |
| Padding | `--padding-input` |
| Font | `--text-base`, `--text-sans` |
| Line height | `--leading-body` (textarea) / `--leading-ui` (input) |
| Shadow | none (default) |
| Focus shadow | `--shadow-sm` + outline: `2px solid --color-focus-ring` offset `2px` |
| Error border | `2px solid --color-error` |
| Disabled | bg `--color-disabled-bg`, text `--color-disabled-text` |

**States:**

| State | Border | Shadow | Outline |
|-------|--------|--------|---------|
| Default | `--border-card solid --color-border` | none | none |
| Hover | `--border-card solid --color-border` | `--shadow-xs` | none |
| Focus | `--border-card solid --color-border` | `--shadow-sm` | `2px solid --color-focus-ring; offset 2px` |
| Error | `2px solid --color-error` | none | none |
| Error + Focus | `2px solid --color-error` | none | `2px solid --color-error; offset 2px` |
| Disabled | `--border-card solid --color-border` | none | none; cursor `not-allowed` |
| Readonly | same as Default; cursor `default` | none | none |

**Variants:**

- `Input` — single line, fixed height 36px
- `Textarea` — multi-line, auto-grows; min-height 80px
- `Composer` — full-width textarea inside the panel composer; border on top/sides only (bottom edge is panel floor); min-height 40px, grows up to 200px then scrolls

---

### 4.3 Checkbox

Used for the **「As Task」toggle** in the Composer and settings forms.

| Property | Value |
|----------|-------|
| Size | 16×16px |
| Border | `--border-card solid --color-border` |
| Border radius | `--radius-badge` |
| Background (unchecked) | `--color-surface` |
| Background (checked) | `--color-text-primary` (black fill) |
| Checkmark | white SVG icon |
| Focus ring | `2px solid --color-focus-ring` offset `2px` |
| Label | `--text-base`, `--weight-medium`, gap `--gap-sm` |

---

### 4.4 Select / Dropdown / Combobox

**Trigger** shares Input base anatomy.

| Property | Value |
|----------|-------|
| Trigger | same as `Input` with trailing chevron icon |
| Dropdown panel | `--color-surface` bg, `--border-card solid --color-border`, `--radius-control`, `--shadow-lg` |
| Option padding | `--padding-button-sm` |
| Option hover | bg `--color-surface-hover` |
| Option selected | bg `--color-accent`, text `--color-text-primary`, `--weight-bold` |
| Separator | `1px solid --color-border-subtle` |

---

### 4.5 Badge / Status Tag

Badges communicate status at a glance. All badges share a base; color fills distinguish type.

| Property | Value |
|----------|-------|
| Height | 20px |
| Padding | `--padding-badge` |
| Border | `--border-card solid --color-border` |
| Border radius | `--radius-badge` |
| Shadow | `--shadow-xs` |
| Font | `--text-xs`, `--weight-semibold` |
| Text color | always `--color-text-primary` (black for legibility) |

**Variant fills:**

| Variant | Background |
|---------|-----------|
| `todo` | `--color-surface-alt` |
| `in_progress` | `--color-info-bg` |
| `in_review` | `--color-warning-bg` |
| `done` | `--color-success-bg` |
| `closed` | `--color-surface-alt` |
| `attention` | `--color-accent` (amber) |
| `error` | `--color-error-bg` |

---

### 4.6 Avatar

Square avatars (not circles) reinforce the Neo-Brutalism grid feel.

| Property | Value |
|----------|-------|
| Shape | Square, `--radius-avatar` |
| Border | `--border-card solid --color-border` |
| Default bg | `--color-surface-alt` |
| Default content | 1–2 uppercase initials, `--weight-bold`, `--text-sm` |
| Image | object-fit cover |

**Sizes:**

| Name | Size | Font |
|------|------|------|
| xs | 16×16px | `--text-10` |
| sm | 20×20px | `--text-11` |
| md (default) | 28×28px | `--text-sm` |
| lg | 36×36px | `--text-base` |
| xl | 48×48px | `--text-lg` |

**Agent avatars:** the avatar's border color is replaced with the agent's assigned identity color from the agent palette (§2.1). This is the primary visual differentiator between agents in the timeline.

---

### 4.7 Card (Base)

All card-like surfaces share this base. Variants **extend** it.

| Property | Value |
|----------|-------|
| Background | `--color-surface` |
| Border | `--border-card solid --color-border` |
| Border radius | `--radius-control` |
| Shadow | `--shadow-md` |
| Padding | `--padding-card` |

**Hover behavior (clickable cards only):** apply Neo-Brutalism press effect (§3) — shadow grows to `--shadow-lg` and translates `-1px, -1px`.

**Card variants:**

| Variant | Extends base | Differences |
|---------|-------------|-------------|
| **Task Card** | ✓ | Fixed layout: title (bold), status badge, assignee avatar, reply count, attention indicator |
| **Approval Card** | ✓ | Border `--border-panel` (3px), shadow `--shadow-lg`, top stripe in `--color-warning` (4px); action description + risk label + Allow/Deny buttons |
| **Interactive Card** | ✓ | Proposed-action summary label + detail button; outcome states: pending / confirmed (accent border) / dismissed (muted) |
| **Agent Capability Card** | ✓ | Shadow `none` (non-interactive); capability name + scope badge + description |
| **Delegation Card** | ✓ | Shows source agent → target agent arrow, brief context; shadow `--shadow-sm` |

---

### 4.8 Message Entry (Timeline Row)

The flat inline message layout has **no border and no shadow**. Visual separation
comes from spacing and the sender identity header only.

| Property | Value |
|----------|-------|
| Layout | Full-width column |
| Padding | `--primitive-space-3` vertical, `--primitive-space-4` horizontal |
| Hover bg | `--color-surface-hover` (subtle, full-width) |
| Sender header | Avatar (md) + display name (`--weight-semibold`, `--text-sm`) + timestamp (`--text-xs`, `--color-text-muted`) — one row |
| Message body | `--text-md`, `--leading-body`, `--text-sans`; code spans use `--text-mono` |
| Agent identity | Avatar border uses agent's identity color |
| System event | No sender avatar; italic `--text-sm --color-text-muted`; collapsible when consecutive |

**Agent streaming state:** while streaming, the message body ends with a blinking
cursor (1px solid `--color-text-primary`, 1s blink). A "working" pill
(`--text-xs`, `--color-run-running`, `--shadow-xs`) appears above the message body before any text arrives.

**Message grouping:** consecutive messages from the same sender within 5 minutes
are grouped. Only the first entry in a group shows the full sender header
(avatar + name + timestamp). Subsequent entries in the group show only a
narrower left indent (28px to align body with the group's text column) and
no avatar/header.

**Timestamp display rules:**

| Condition | Display format |
|-----------|---------------|
| Within 1 minute | `刚刚` / `just now` |
| Within today | `HH:mm` (e.g., `14:32`) |
| Yesterday | `昨天 HH:mm` / `Yesterday HH:mm` |
| Within 7 days | `周X HH:mm` / `Mon HH:mm` |
| Older | `MM-DD HH:mm` / `MMM D, HH:mm` |
| Year differs | `YYYY-MM-DD HH:mm` |

Hover over any timestamp to reveal the full ISO-style absolute timestamp in a
Tooltip.

---

### 4.9 Tool Call Block (Collapsible)

Appears inside an agent message entry when the agent invokes tools.

| Property | Value |
|----------|-------|
| Background | `--color-surface-alt` |
| Border | `--border-subtle solid --color-border` (1px) on left; `--border-card solid --color-border` on top/right/bottom |
| Border radius | `--radius-control` |
| Shadow | `--shadow-xs` |
| Margin | `--gap-md` top, left indent `--primitive-space-6` |
| Collapsed height | 28px; shows tool name + status dot + expand chevron |
| Expanded | full content; code/output uses `--text-mono`, `--text-sm` |
| Status dot | `--radius-full`, 8×8px, color from `--color-run-*` |

---

### 4.10 Composer Panel

The bottom-of-channel input area.

| Property | Value |
|----------|-------|
| Container border-top | `--border-panel solid --color-border` |
| Container padding | `--padding-card` |
| Textarea | Composer variant of Input (§4.2) |
| Action row | below textarea; contains: attachment icon-button, mention hint, spacer, **「As Task」checkbox**, send Button (Primary, sm) |
| Attachment chips | above textarea when files added; each chip shows: file-type icon (16px) + truncated filename (max 20 chars) + file size (`--text-xs`, `--color-text-muted`) + ×-remove icon-button; `--shadow-xs`; drag-over the composer shows a dashed `--border-card` overlay on the textarea |
|「As Task」checkbox | standard Checkbox (§4.3) + label `--text-sm` |

---

### 4.11 Tabs

| Property | Value |
|----------|-------|
| Tab bar border-bottom | `--border-card solid --color-border` |
| Tab item padding | `--padding-button-sm` |
| Tab item font | `--text-sm`, `--weight-medium` |
| Active tab | border-bottom `3px solid --color-border` (overrides bar border), `--weight-bold` |
| Hover | bg `--color-surface-hover` |
| Indicator spacing | gap between tabs `--gap-md` |

---

### 4.12 Sidebar Nav Item

| Property | Value |
|----------|-------|
| Height | 36px |
| Padding | `--padding-button-sm` |
| Border radius | `--radius-control` |
| Font | `--text-sm`, `--weight-medium` |
| Default | transparent bg |
| Hover | bg `--color-surface-hover` |
| Active | bg `--color-text-primary`, text `--color-text-inverse`, `--weight-bold` |
| Icon | 16×16px, left of label, gap `--gap-sm` |
| Badge | right-aligned, numeric unread count, `--text-xs`, `--color-accent` bg |

**Channel list item** extends Sidebar Nav Item:
- prepend `#` prefix in `--color-text-muted`
- unread dot: 8×8px `--radius-full`, `--color-accent` fill

---

### 4.13 Panel Separator

The three-column shell uses visible borders as separators.

| Property | Value |
|----------|-------|
| Nav Sidebar right border | `--border-panel solid --color-border` |
| Right Detail Panel left border | `--border-panel solid --color-border` |
| Channel tab bar bottom | `--border-card solid --color-border` |
| Section dividers inside panels | `1px solid --color-border-subtle` |

---

### 4.14 Modal / Dialog

Used for the Interactive Card confirmation flow and destructive confirmations.

| Property | Value |
|----------|-------|
| Overlay | `rgba(0,0,0,0.5)` |
| Container bg | `--color-surface` |
| Container border | `--border-panel solid --color-border` |
| Container shadow | `--shadow-xl` |
| Container radius | `--radius-modal` |
| Container min-width | 400px; max-width 560px |
| Header | padding `--padding-card`; border-bottom `--border-card solid --color-border`; title `--text-xl`, `--weight-black` |
| Body | padding `--padding-card`; `--text-base`, `--leading-body` |
| Footer | padding `--padding-card`; border-top `--border-card solid --color-border`; actions right-aligned; gap `--gap-sm` |
| Appear animation | slide up 8px + fade in, `--duration-appear` |

---

### 4.15 Toast / Notification Banner

| Property | Value |
|----------|-------|
| Container bg | `--color-text-primary` (black) |
| Text | `--color-text-inverse` (white), `--text-sm`, `--weight-medium` |
| Border | `--border-card solid --color-border` |
| Shadow | `--shadow-md` |
| Border radius | `--radius-control` |
| Max width | 360px |
| Position | bottom-right, `--primitive-space-4` from edges |
| Dismiss | auto after 4s or manual close icon |
| Error variant | bg `--color-error`, text white |
| Success variant | bg `--color-success`, text white |

---

### 4.16 Scrollbar

| Property | Value |
|----------|-------|
| Width (vertical) | 6px |
| Track bg | `--color-surface-alt` |
| Thumb bg | `--primitive-gray-300` |
| Thumb hover bg | `--primitive-gray-400` |
| Thumb radius | `--radius-full` |

---

### 4.17 Status / Presence Dot

Inline indicator on member list and agent headers.

| Property | Value |
|----------|-------|
| Size | 8×8px |
| Border radius | `--radius-full` |
| Border | `1.5px solid --color-surface` (creates ring against any bg) |
| Online / Running | `--color-success` |
| Away / Idle | `--color-warning` |
| Offline / Error | `--color-error` |
| Disabled / Unknown | `--primitive-gray-300` |

---

### 4.18 Code Block / Monospace Output

Used inside Tool Call blocks, artifact previews and inline code in messages.

| Property | Value |
|----------|-------|
| Background | `--color-surface-alt` |
| Border | `--border-subtle solid --color-border` |
| Border radius | `--radius-control` |
| Padding | `--primitive-space-3` |
| Font | `--text-mono`, `--text-sm` |
| Line height | `--leading-relaxed` |
| Overflow | horizontal scroll |

---

## 5. Tailwind Config Mapping

All semantic tokens map directly to Tailwind config so components can use
utility classes (`border-border`, `bg-surface`, `shadow-md`, etc.) without
inline styles.

```ts
// tailwind.config.ts (excerpt)
export default {
  theme: {
    extend: {
      colors: {
        border:        'var(--color-border)',
        'border-subtle': 'var(--color-border-subtle)',
        bg:            'var(--color-bg)',
        surface:       'var(--color-surface)',
        'surface-alt': 'var(--color-surface-alt)',
        'surface-hover': 'var(--color-surface-hover)',
        text:          'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-muted':  'var(--color-text-muted)',
        'text-inverse': 'var(--color-text-inverse)',
        accent:        'var(--color-accent)',
        'accent-hover': 'var(--color-accent-hover)',
        'accent-subtle': 'var(--color-accent-subtle)',
        success:       'var(--color-success)',
        'success-bg':  'var(--color-success-bg)',
        info:          'var(--color-info)',
        'info-bg':     'var(--color-info-bg)',
        warning:       'var(--color-warning)',
        'warning-bg':  'var(--color-warning-bg)',
        error:         'var(--color-error)',
        'error-bg':    'var(--color-error-bg)',
      },
      borderWidth: {
        panel:   'var(--border-panel)',
        card:    'var(--border-card)',
        subtle:  'var(--border-subtle)',
      },
      borderRadius: {
        control: 'var(--radius-control)',
        modal:   'var(--radius-modal)',
        badge:   'var(--radius-badge)',
        avatar:  'var(--radius-avatar)',
      },
      boxShadow: {
        xs:   'var(--shadow-xs)',
        sm:   'var(--shadow-sm)',
        md:   'var(--shadow-md)',
        lg:   'var(--shadow-lg)',
        xl:   'var(--shadow-xl)',
        none: 'var(--shadow-none)',
      },
      fontFamily: {
        sans: 'var(--text-sans)',
        mono: 'var(--text-mono)',
      },
      fontSize: {
        xs:      ['var(--text-xs)',  { lineHeight: 'var(--leading-ui)' }],
        sm:      ['var(--text-sm)',  { lineHeight: 'var(--leading-ui)' }],
        base:    ['var(--text-base)',{ lineHeight: 'var(--leading-ui)' }],
        md:      ['var(--text-md)',  { lineHeight: 'var(--leading-body)' }],
        lg:      ['var(--text-lg)',  { lineHeight: 'var(--leading-ui)' }],
        xl:      ['var(--text-xl)',  { lineHeight: 'var(--leading-tight)' }],
        '2xl':   ['var(--text-2xl)',  { lineHeight: 'var(--leading-tight)' }],
        display: ['var(--text-display)', { lineHeight: 'var(--leading-tight)' }],
      },
      transitionDuration: {
        interaction: 'var(--duration-interaction)',
        transition:  'var(--duration-transition)',
        appear:      'var(--duration-appear)',
      },
    },
  },
}
```

---

### 4.19 Tooltip

Triggered on hover (300ms delay) or focus on any element with a `title`-equivalent label. Dismisses immediately on mouseout/blur.

| Property | Value |
|----------|-------|
| Background | `--color-text-primary` (black) |
| Text | `--color-text-inverse`, `--text-xs`, `--weight-medium` |
| Padding | `4px 8px` |
| Border radius | `--radius-badge` |
| Shadow | `--shadow-xs` |
| Max width | 240px |
| Arrow | 4px triangle pointing toward trigger element |
| Appear animation | fade in 100ms |
| Z-index | `--z-tooltip` (see §5.1) |

---

### 4.20 Dropdown Menu / Context Menu

Shared surface for: nav overflow menus, message right-click, task card actions, member context actions.

| Property | Value |
|----------|-------|
| Background | `--color-surface` |
| Border | `--border-card solid --color-border` |
| Border radius | `--radius-control` |
| Shadow | `--shadow-lg` |
| Min width | 180px; max width 280px |
| Z-index | `--z-dropdown` |
| Appear animation | scale from 0.95 + fade in, `--duration-transition`, origin near trigger |

**Item anatomy:**

| State | Background | Text |
|-------|-----------|------|
| Default | transparent | `--color-text-primary`, `--text-sm` |
| Hover | `--color-surface-hover` | `--color-text-primary` |
| Active | `--color-accent` | `--color-text-primary` |
| Destructive default | transparent | `--color-error` |
| Destructive hover | `--color-error-bg` | `--color-error` |
| Disabled | transparent | `--color-text-muted`; cursor `not-allowed` |

Item height: 32px; padding `--padding-button-sm`; icon 14px left of label; gap `--gap-sm`.
Separator: `1px solid --color-border-subtle`, margin `4px 0`.

**Message context menu items (right-click on message):**
Copy text | 创建为任务 (if not already a task) | Mention sender | — (separator) | Delete (own human messages only, destructive)

---

### 4.21 Mention Picker

Appears in the Composer when the user types `@`. Floats above the composer, anchored to the cursor position.

| Property | Value |
|----------|-------|
| Inherits | Dropdown Menu surface (§4.20) |
| Trigger | `@` character in composer, immediately |
| Dismiss | `Esc`, click outside, or empty query after backspace |
| Width | 240px fixed |
| Max visible items | 6; scroll for more |
| Z-index | `--z-dropdown` |

**Item layout:** Avatar (sm) + Display name (`--weight-semibold`) + handle (`--text-xs`, `--color-text-muted`) + type badge (`Agent` / `You`).

**Filter behavior:** filter by display name and handle substring from first keystroke after `@`. Human user always appears if query matches. Keyboard: `↑↓` to navigate, `Enter` or `Tab` to confirm, `Esc` to cancel.

---

### 4.22 Empty State

Every list or content surface that can be empty defines its empty state. Do not show a blank area.

| Property | Value |
|----------|-------|
| Layout | Centered column: icon (32px, `--color-text-muted`) → title → subtitle → optional CTA |
| Title | `--text-lg`, `--weight-bold` |
| Subtitle | `--text-sm`, `--color-text-secondary`, max-width 320px |
| CTA | Button.Secondary (sm) if action available |
| Padding | `--primitive-space-12` top and bottom |

**Per-surface copy:**

| Surface | Icon | Title (zh-CN) | Subtitle |
|---------|------|---------------|---------|
| Channel list (no channels) | `hash` | 还没有频道 | 引导员会帮你创建第一个频道 |
| Timeline (empty channel) | `message-square` | 开始对话 | 发送一条消息，或创建任务 |
| Tasks board (no tasks) | `check-square` | 没有任务 | 在对话中勾选「创建为任务」来开始 |
| Members (no agents) | `bot` | 还没有 Agent | 前往运行节点页面添加 |
| Files tab (no artifacts) | `paperclip` | 没有产物 | Agent 执行任务后产生的文件会在这里显示 |
| Search results | `search` | 没有匹配结果 | 试试其他关键词 |

---

### 4.23 Skeleton / Loading Placeholder

Used while async data is loading (initial channel load, thread open, board load).

| Property | Value |
|----------|-------|
| Background | `--color-surface-alt` |
| Shimmer | left-to-right gradient sweep, `--color-surface` highlight, 1.5s loop |
| Border radius | matches the element being replaced (`--radius-control` for text lines, `--radius-avatar` for avatar) |

**Timeline skeleton:** 3–4 rows of MessageEntry shape — avatar circle (28px) + two text lines (80% width, 60% width); 12px vertical gap between rows.
**Card skeleton:** full Card.Task shape with placeholder lines.
**Board skeleton:** 3 column headers + 2 skeleton cards per column.

---

### 4.24 Markdown Rendering in Messages

All message body text is rendered as Markdown. Styles apply inside `.message-body`.

| Element | Style |
|---------|-------|
| Paragraph | `--text-md`, `--leading-body`; margin-bottom `--gap-md` |
| `# H1` | `--text-2xl`, `--weight-black`; border-bottom `1px solid --color-border-subtle`; padding-bottom `--gap-sm`; margin-bottom `--gap-md` |
| `## H2` | `--text-xl`, `--weight-bold`; margin-bottom `--gap-md` |
| `### H3` | `--text-lg`, `--weight-semibold`; margin-bottom `--gap-sm` |
| Unordered list | `--gap-xs` between items; bullet `--color-text-muted`; indent `--primitive-space-5` |
| Ordered list | same indent; counter `--color-text-muted` |
| Blockquote | left border `3px solid --color-border`; padding-left `--gap-md`; text `--color-text-secondary` italic |
| `inline code` | `--text-mono`, `--text-sm`; bg `--color-surface-alt`; border `--border-subtle solid --color-border`; radius `--radius-badge`; padding `1px 4px` |
| Code block | CodeBlock component (§4.18); header bar shows language label + copy button (icon-sm, Ghost) |
| Link | `--color-text-primary`; underline `--color-border`; hover underline `--color-accent` |
| Table | border `--border-subtle solid --color-border`; th bg `--color-surface-alt`, `--weight-semibold`; td/th padding `--padding-button-sm`; row hover `--color-surface-hover` |
| Bold `**` | `--weight-bold` |
| Italic `*` | `font-style: italic` |
| Strikethrough `~~` | `text-decoration: line-through; color: --color-text-muted` |
| HR `---` | `1px solid --color-border-subtle`; margin `--gap-xl` 0 |
| Image `![]()` | max-width 100%; border `--border-card solid --color-border`; radius `--radius-control`; shadow `--shadow-xs` |

---

### 4.25 Date Divider

Separates messages from different calendar days in the timeline.

| Property | Value |
|----------|-------|
| Layout | Horizontal line with centered date label |
| Line | `1px solid --color-border-subtle` |
| Label | `--text-xs`, `--weight-semibold`, `--color-text-muted`; bg `--color-bg`; padding `0 --gap-md` |
| Vertical spacing | `--gap-xl` above and below |
| Date format | same relative rules as timestamps (§4.8) except no time component |

---

### 4.26 Notification List

Accessible via a bell icon in the Nav Sidebar header. Opens as a Popover (anchored to bell icon) or a dedicated panel in the Right Detail Panel area.

| Property | Value |
|----------|-------|
| Container | Inherits Dropdown Menu surface; width 340px |
| Header | `--text-base`, `--weight-bold`; "全部标为已读" link button right-aligned |
| Empty | Empty State (§4.22): bell icon, "没有新通知" |
| Max height | 480px; scroll internally |

**Notification item:**

| Property | Value |
|----------|-------|
| Height | auto (min 52px) |
| Padding | `--padding-button-sm` |
| Unread indicator | 6px `--radius-full` dot, `--color-accent` fill, left of content |
| Read bg | `--color-surface` |
| Unread bg | `--color-accent-subtle` |
| Hover | `--color-surface-hover` |
| Icon | 20px, type-specific: `@` for mention, `shield` for approval, `message` for task reply |
| Body | `--text-sm`; actor name `--weight-semibold`; action description; target truncated to 1 line |
| Timestamp | `--text-xs`, `--color-text-muted`; relative format |
| Click | Navigate to the relevant task/thread/message and mark as read |

---

### 4.27 Window Chrome (macOS)

Slei uses a custom frameless Tauri window to maintain Neo-Brutalism consistency.

| Property | Value |
|----------|-------|
| Window style | Frameless (`decorations: false` in Tauri config) |
| Titlebar area | 40px tall strip at top of Nav Sidebar; `data-tauri-drag-region` attribute; bg matches sidebar |
| Traffic lights (macOS) | Positioned at `left: 12px, top: 12px`; default macOS style (do not restyle) |
| App name / icon | 16px app icon + "Slei" label centered in titlebar area |
| Minimum window size | 900×600px (ensures 3-column layout is usable) |
| Default window size | 1280×800px |
| Border | `--border-panel solid --color-border` around entire window on macOS (supplements native window shadow) |

---

### 4.28 Z-Index Ladder

All layered elements use named tokens to prevent conflicts.

```css
--z-base:     0;      /* normal document flow */
--z-raised:   10;     /* sticky headers, floating composer */
--z-dropdown: 100;    /* dropdowns, context menus, mention picker */
--z-tooltip:  200;    /* tooltips */
--z-modal:    300;    /* modals, dialogs */
--z-toast:    400;    /* toast notifications */
--z-overlay:  500;    /* full-screen overlays (onboarding) */
```

Add to Tailwind config:
```ts
zIndex: {
  raised:   'var(--z-raised)',
  dropdown: 'var(--z-dropdown)',
  tooltip:  'var(--z-tooltip)',
  modal:    'var(--z-modal)',
  toast:    'var(--z-toast)',
  overlay:  'var(--z-overlay)',
},
```

---

## 6. Component Reuse Hierarchy

```
Primitive Tokens
    └── Semantic Tokens
            ├── Button (base)
            │       ├── Button.Primary
            │       ├── Button.Secondary
            │       ├── Button.Accent
            │       ├── Button.Destructive
            │       ├── Button.Ghost
            │       └── Button.Icon (xs/sm/md)
            ├── Input (base)
            │       ├── Input.Text
            │       ├── Input.Textarea
            │       └── Input.Composer
            ├── Checkbox
            ├── Select (trigger = Input.Text)
            ├── Badge (base)
            │       ├── Badge.Status  (todo/in_progress/…)
            │       ├── Badge.Attention
            │       └── Badge.Count
            ├── Avatar (base)
            │       ├── Avatar.Human
            │       └── Avatar.Agent  (identity-color border)
            ├── Card (base)
            │       ├── Card.Task
            │       ├── Card.Approval  (extends Card.Task)
            │       ├── Card.Interactive
            │       ├── Card.Capability
            │       └── Card.Delegation
            ├── MessageEntry (no card border/shadow)
            │       └── ToolCallBlock  (nested inside MessageEntry)
            ├── ComposerPanel
            │       ├── Input.Composer
            │       ├── Checkbox (As Task)
            │       └── Button.Primary (Send)
            ├── Tabs
            ├── SidebarNavItem
            │       └── ChannelListItem
            ├── Modal
            ├── Toast
            ├── Tooltip
            ├── DropdownMenu
            │       └── ContextMenu (message right-click)
            ├── MentionPicker (uses DropdownMenu surface)
            ├── EmptyState
            ├── Skeleton
            ├── MarkdownBody
            ├── DateDivider
            ├── NotificationList
            ├── StatusDot
            ├── CodeBlock
            └── Scrollbar
```

---

## 7. Open Decisions

| Item | Status | Notes |
|------|--------|-------|
| Accent color final hex | Provisional `#FBBF24` (amber-400) | Adjust after first visual prototype |
| Dark mode | Deferred post-MVP | Token layer is dark-mode-ready; swap surface/text/border values |
| Agent palette assignment | Runtime (round-robin by creation order) | Persisted per agent in `AgentProfile` |
| Font hosting | Bundled in app assets | Inter + JetBrains Mono + Noto Sans SC; no CDN |
| Icon library | Lucide | Tree-shakeable, MIT, matches shadcn/ui conventions |
