import { useState, type ReactNode } from "react";

import type { SettingsOverlayPanel } from "../../app/model";
import type { DesktopMessages } from "../../i18n";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SleiIcon, type SleiIconName } from "../../components";
import { cn } from "@/lib/utils";

export type SettingsOverlayProps = {
  activePanel: SettingsOverlayPanel;
  messages: DesktopMessages;
  onClose: () => void;
  onPanelChange: (panel: SettingsOverlayPanel) => void;
  renderDetail: (panel: SettingsOverlayPanel) => ReactNode;
};

export function SettingsDetailHost(props: {
  panel: SettingsOverlayPanel;
  renderAccount: () => ReactNode;
  renderPreferences: () => ReactNode;
  renderMembers: () => ReactNode;
  renderDevices: () => ReactNode;
  renderAbout: () => ReactNode;
}) {
  switch (props.panel) {
    case "account":
      return props.renderAccount();
    case "preferences":
      return props.renderPreferences();
    case "members":
      return props.renderMembers();
    case "devices":
      return props.renderDevices();
    case "about":
      return props.renderAbout();
  }
  const exhaustivePanel: never = props.panel;
  return exhaustivePanel;
}

type SettingsOverlayGroup = {
  id: "personal" | "workspace" | "system";
  panels: SettingsOverlayPanel[];
};

type WorkspacePanel = Extract<SettingsOverlayPanel, "members" | "devices">;

const settingsOverlayGroups: SettingsOverlayGroup[] = [
  { id: "personal", panels: ["account", "preferences"] },
  { id: "workspace", panels: ["members", "devices"] },
  { id: "system", panels: ["about"] },
];

const settingsOverlayPanelIcons: Record<SettingsOverlayPanel, SleiIconName> = {
  account: "user",
  preferences: "settings",
  members: "members",
  devices: "computer",
  about: "info",
};

export function SettingsOverlay({
  activePanel,
  messages,
  onClose,
  onPanelChange,
  renderDetail,
}: SettingsOverlayProps) {
  const labels = messages.settings.overlay;
  const [expandedWorkspacePanels, setExpandedWorkspacePanels] = useState<Record<WorkspacePanel, boolean>>({
    members: true,
    devices: true,
  });

  function toggleWorkspacePanel(panel: WorkspacePanel) {
    setExpandedWorkspacePanels((current) => ({
      ...current,
      [panel]: !current[panel],
    }));
  }

  function renderPanelButton(panel: SettingsOverlayPanel, options: { nested?: boolean } = {}) {
    const active = panel === activePanel;
    const label = options.nested ? labels.panelItems[panel] ?? labels.panels[panel] : labels.panels[panel];
    return (
      <Button
        aria-current={active ? "page" : undefined}
        className={cn(
          "h-auto justify-start gap-3 rounded-md text-left",
          options.nested ? "ml-6 px-2 py-1.5" : "px-2 py-2",
          active && "bg-accent text-accent-foreground",
        )}
        key={panel}
        onClick={() => onPanelChange(panel)}
        type="button"
        variant="ghost"
      >
        <SleiIcon className="size-4 shrink-0" name={settingsOverlayPanelIcons[panel]} />
        <span className="grid min-w-0 gap-0.5">
          <span className="truncate text-sm font-medium">{label}</span>
          {!options.nested ? (
            <span className="line-clamp-2 text-xs font-normal text-muted-foreground">
              {labels.panelDescriptions[panel]}
            </span>
          ) : null}
        </span>
      </Button>
    );
  }

  return (
    <section
      className="fixed inset-0 z-50 flex min-h-0 bg-background text-foreground"
      data-settings-overlay-layout="continuous"
      data-testid="slei-settings-overlay"
    >
      <aside
        className="flex w-72 shrink-0 flex-col bg-[var(--workspace-sidebar-bg)] md:w-80"
        data-settings-nav-surface="workspace-sidebar-bg"
        data-testid="slei-settings-overlay-nav"
      >
        <div
          className="flex h-[var(--app-chrome-height)] shrink-0 items-center border-b px-3 pl-[calc(var(--app-native-controls-width)+var(--app-gap-sm))]"
          data-settings-chrome-align="native-controls-center"
          data-testid="slei-settings-overlay-chrome"
        >
          <Button
            aria-label={labels.returnToChat}
            className="ml-auto h-8 gap-1.5 px-2.5"
            data-settings-return-placement="top-right"
            onClick={onClose}
            data-testid="slei-settings-return"
            type="button"
            variant="ghost"
          >
            <SleiIcon className="size-4" name="arrowLeft" />
            {labels.returnToChat}
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <nav aria-label={messages.settings.title} className="grid gap-5 px-3 py-4">
            {settingsOverlayGroups.map((group) => (
              <section className="grid gap-2" key={group.id}>
                <h2 className="px-2 text-xs font-medium text-muted-foreground">{labels.groups[group.id]}</h2>
                <div className="grid gap-1">
                  {group.panels.map((panel) => {
                    if (panel === "members" || panel === "devices") {
                      const expanded = expandedWorkspacePanels[panel] || activePanel === panel;
                      return (
                        <div className="grid gap-1" key={panel}>
                          <Button
                            aria-expanded={expanded}
                            className="h-auto justify-start gap-3 rounded-md px-2 py-2 text-left"
                            onClick={() => toggleWorkspacePanel(panel)}
                            type="button"
                            variant="ghost"
                          >
                            <SleiIcon className="size-4 shrink-0" name={settingsOverlayPanelIcons[panel]} />
                            <span className="grid min-w-0 flex-1 gap-0.5">
                              <span className="truncate text-sm font-medium">{labels.panels[panel]}</span>
                              <span className="line-clamp-2 text-xs font-normal text-muted-foreground">
                                {labels.panelDescriptions[panel]}
                              </span>
                            </span>
                            <SleiIcon className="size-4 shrink-0 text-muted-foreground" name={expanded ? "chevronDown" : "chevronRight"} />
                          </Button>
                          {expanded ? (
                            <div className="grid gap-1" data-settings-submenu={panel}>
                              {renderPanelButton(panel, { nested: true })}
                            </div>
                          ) : null}
                        </div>
                      );
                    }
                    return renderPanelButton(panel);
                  })}
                </div>
              </section>
            ))}
          </nav>
        </ScrollArea>
      </aside>

      <main
        className="relative z-10 min-w-0 flex-1 border-l border-border/70 bg-[var(--workspace-glass-bg)] shadow-[-12px_0_24px_-18px_rgba(15,23,42,0.16)]"
        data-settings-detail-surface="right-raised-left-shadow"
        data-settings-divider-shadow="casts-left"
        data-testid="slei-settings-overlay-detail"
      >
        <ScrollArea className="h-full min-h-0">
          {renderDetail(activePanel)}
        </ScrollArea>
      </main>
    </section>
  );
}
