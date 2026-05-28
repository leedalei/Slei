export type PrimitiveNode = {
  role: string;
  className: string;
  disabled?: boolean;
  children?: string;
};

export function Button(input: {
  children: string;
  variant?: "primary" | "secondary" | "accent" | "destructive" | "ghost";
  disabled?: boolean;
}): PrimitiveNode {
  const variant = input.variant ?? "primary";
  return {
    role: "button",
    children: input.children,
    disabled: input.disabled ?? false,
    className: joinClasses("slei-button", `slei-button--${variant}`),
  };
}

export function Input(input: {
  label: string;
  value?: string;
  disabled?: boolean;
}): PrimitiveNode & { label: string; value: string } {
  return {
    role: "textbox",
    label: input.label,
    value: input.value ?? "",
    disabled: input.disabled ?? false,
    className: "slei-input",
  };
}

export function Badge(input: {
  children: string;
  variant: "todo" | "in_progress" | "in_review" | "done" | "closed" | "attention" | "error";
}): PrimitiveNode {
  return {
    role: "status",
    children: input.children,
    className: joinClasses("slei-badge", `slei-badge--${input.variant}`),
  };
}

export function Avatar(input: { name: string; imageUrl?: string }): PrimitiveNode & {
  initials: string;
  imageUrl?: string;
} {
  return {
    role: "img",
    className: "slei-avatar",
    initials: initials(input.name),
    imageUrl: input.imageUrl,
  };
}

export function Dialog(input: {
  title: string;
  open: boolean;
  focusableIds: string[];
}) {
  let open = input.open;
  let focusIndex = 0;

  return {
    role: "dialog",
    title: input.title,
    className: "slei-dialog",
    isOpen: () => open,
    currentFocus: () => input.focusableIds[focusIndex],
    handleKey(key: "Tab" | "Shift+Tab" | "Escape") {
      if (key === "Escape") {
        open = false;
        return;
      }
      if (key === "Shift+Tab") {
        focusIndex =
          (focusIndex - 1 + input.focusableIds.length) % input.focusableIds.length;
        return;
      }
      focusIndex = (focusIndex + 1) % input.focusableIds.length;
    },
  };
}

export function Tabs(input: { tabs: string[]; active: string }) {
  let activeIndex = Math.max(0, input.tabs.indexOf(input.active));
  return {
    role: "tablist",
    className: "slei-tabs",
    active: () => input.tabs[activeIndex],
    handleKey(key: "ArrowLeft" | "ArrowRight") {
      const delta = key === "ArrowRight" ? 1 : -1;
      activeIndex = (activeIndex + delta + input.tabs.length) % input.tabs.length;
    },
  };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length > 1) {
    return parts
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function joinClasses(...classes: string[]): string {
  return classes.join(" ");
}
