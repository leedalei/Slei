import { useState, type ReactNode } from "react";

import type { SettingsOverlayPanel } from "../../app/model";
import type { DesktopMessages } from "../../i18n";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SleiIcon, type SleiIconName } from "../../components";
import { cn } from "@/lib/utils";

export type SettingsOverlayProps = {
  activePanel: SettingsOverlayPanel;
  activeDeviceId?: string;
  activeMemberId?: string;
  deviceItems?: SettingsOverlayNavItem[];
  memberItems?: SettingsOverlayNavItem[];
  messages: DesktopMessages;
  motion?: "enter" | "exit";
  onClose: () => void;
  onDeviceItemSelect?: (deviceId: string) => void;
  onMemberItemSelect?: (memberId: string) => void;
  onPanelChange: (panel: SettingsOverlayPanel) => void;
  renderDetail: (panel: SettingsOverlayPanel) => ReactNode;
};

export type SettingsOverlayNavItem = {
  id: string;
  label: string;
  description?: string;
};

export type SettingsOverlayNavProps = Omit<SettingsOverlayProps, "motion" | "renderDetail"> & {
  surface?: "card" | "page";
};

export type SettingsOverlayDetailProps = Pick<SettingsOverlayProps, "activePanel" | "renderDetail"> & {
  surface?: "card" | "page";
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

const settingsOverlayNavButtonClassName =
  "hover:bg-[var(--workspace-sidebar-hover-bg)] hover:text-foreground dark:hover:bg-[var(--workspace-sidebar-hover-bg)]";
const settingsOverlayActiveNavClassName =
  "bg-[var(--workspace-sidebar-active-bg)] text-foreground hover:bg-[var(--workspace-sidebar-active-bg)] hover:text-foreground dark:hover:bg-[var(--workspace-sidebar-active-bg)]";

export function SettingsOverlayNav({
  activePanel,
  activeDeviceId,
  activeMemberId,
  deviceItems = [],
  memberItems = [],
  messages,
  onClose,
  onDeviceItemSelect,
  onMemberItemSelect,
  onPanelChange,
  surface = "card",
}: SettingsOverlayNavProps) {
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

  function renderPanelButton(panel: SettingsOverlayPanel) {
    const active = panel === activePanel;
    return (
      <Button
        aria-current={active ? "page" : undefined}
        className={cn(
          "h-auto justify-start gap-3 rounded-md px-2 py-2 text-left",
          settingsOverlayNavButtonClassName,
          active && settingsOverlayActiveNavClassName,
        )}
        key={panel}
        onClick={() => onPanelChange(panel)}
        type="button"
        variant="ghost"
      >
        <SleiIcon className="size-4 shrink-0" name={settingsOverlayPanelIcons[panel]} />
        <span className="grid min-w-0 gap-0.5">
          <span className="truncate text-sm font-medium">{labels.panels[panel]}</span>
          <span className="line-clamp-2 text-xs font-normal text-muted-foreground">
            {labels.panelDescriptions[panel]}
          </span>
        </span>
      </Button>
    );
  }

  function renderWorkspaceItem(panel: WorkspacePanel, item: SettingsOverlayNavItem) {
    const active = activePanel === panel && (
      panel === "members" ? item.id === activeMemberId : item.id === activeDeviceId
    );
    return (
      <Button
        aria-current={active ? "page" : undefined}
        className={cn(
          "h-auto justify-start rounded-md py-1.5 pl-9 pr-2 text-left",
          settingsOverlayNavButtonClassName,
          active && settingsOverlayActiveNavClassName,
        )}
        key={item.id}
        onClick={() => {
          onPanelChange(panel);
          if (panel === "members") {
            onMemberItemSelect?.(item.id);
          } else {
            onDeviceItemSelect?.(item.id);
          }
        }}
        type="button"
        variant="ghost"
      >
        <span className="grid min-w-0 gap-0.5">
          <span className="truncate text-sm font-medium">{item.label}</span>
          {item.description ? (
            <span className="truncate text-xs font-normal text-muted-foreground">{item.description}</span>
          ) : null}
        </span>
      </Button>
    );
  }

  function workspaceItems(panel: WorkspacePanel) {
    return panel === "members" ? memberItems : deviceItems;
  }

  return (
      <aside
        className={cn(
          "slei-settings-overlay-nav-card flex min-h-0 flex-col bg-[var(--settings-sidebar-bg)] max-[760px]:hidden",
          surface === "card" ? "slei-settings-overlay-card" : "slei-settings-overlay-nav-page h-full",
        )}
        data-settings-nav-surface="settings-sidebar-card"
        data-testid="slei-settings-overlay-nav"
      >
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
                            className={cn(
                              "h-auto justify-start gap-3 rounded-md px-2 py-2 text-left",
                              settingsOverlayNavButtonClassName,
                            )}
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
                          {expanded && workspaceItems(panel).length > 0 ? (
                            <div className="grid gap-1" data-settings-submenu={panel}>
                              {workspaceItems(panel).map((item) => renderWorkspaceItem(panel, item))}
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
        <div
          className="slei-settings-overlay-footer shrink-0 border-t px-3 py-3"
          data-testid="slei-settings-overlay-footer"
        >
          <div className="flex min-w-0 items-center gap-2 px-1">
            <span
              className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground"
              data-testid="slei-settings-overlay-footer-label"
            >
              {messages.settings.title}
            </span>
            <Button
              aria-label={labels.returnToChat}
              className="size-8 [&_svg]:size-3.5"
              data-settings-return-placement="bottom-settings-slot"
              onClick={onClose}
              data-testid="slei-settings-return"
              size="icon"
              type="button"
              variant="ghost"
            >
              <SleiIcon name="arrowLeft" size={15} />
              <span className="sr-only">{labels.returnToChat}</span>
            </Button>
          </div>
        </div>
      </aside>
  );
}

export function SettingsOverlayDetail({
  activePanel,
  renderDetail,
  surface = "card",
}: SettingsOverlayDetailProps) {
  return (
    <div
      className={cn(
        "slei-settings-overlay-detail-card relative z-10 min-h-0 min-w-0 bg-[var(--settings-detail-bg)]",
        surface === "card" ? "slei-settings-overlay-card" : "slei-settings-overlay-detail-page h-full",
      )}
      data-settings-detail-surface="settings-detail-card"
      data-testid="slei-settings-overlay-detail"
    >
      <ScrollArea className="h-full min-h-0">
        {renderDetail(activePanel)}
      </ScrollArea>
    </div>
  );
}

export function SettingsOverlay({
  activePanel,
  activeDeviceId,
  activeMemberId,
  deviceItems = [],
  memberItems = [],
  messages,
  motion = "enter",
  onClose,
  onDeviceItemSelect,
  onMemberItemSelect,
  onPanelChange,
  renderDetail,
}: SettingsOverlayProps) {
  return (
    <section
      className="slei-settings-overlay absolute z-50 min-h-0 bg-transparent text-foreground"
      data-settings-overlay-layout="split-cards"
      data-settings-motion={motion}
      data-testid="slei-settings-overlay"
    >
      <div
        className="slei-settings-overlay-content min-h-0 min-w-0"
        data-testid="slei-settings-overlay-content"
      >
        <SettingsOverlayNav
          activePanel={activePanel}
          activeDeviceId={activeDeviceId}
          activeMemberId={activeMemberId}
          deviceItems={deviceItems}
          memberItems={memberItems}
          messages={messages}
          onClose={onClose}
          onDeviceItemSelect={onDeviceItemSelect}
          onMemberItemSelect={onMemberItemSelect}
          onPanelChange={onPanelChange}
        />
        <SettingsOverlayDetail activePanel={activePanel} renderDetail={renderDetail} />
      </div>
    </section>
  );
}
