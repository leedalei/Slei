import { useMemo, useState, type ReactNode } from "react";

import type { SettingsOverlayPanel } from "../../app/model";
import type { DesktopMessages } from "../../i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

type SettingsOverlayGroup = {
  id: "personal" | "workspace" | "system";
  panels: SettingsOverlayPanel[];
};

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
  const [searchQuery, setSearchQuery] = useState("");
  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return settingsOverlayGroups;

    return settingsOverlayGroups.flatMap((group) => {
      const groupLabel = labels.groups[group.id];
      if (groupLabel.toLocaleLowerCase().includes(query)) {
        return [group];
      }

      const panels = group.panels.filter((panel) => labels.panels[panel].toLocaleLowerCase().includes(query));
      return panels.length > 0 ? [{ ...group, panels }] : [];
    });
  }, [labels, searchQuery]);

  return (
    <section
      className="fixed inset-0 z-50 flex min-h-0 bg-background text-foreground"
      data-settings-overlay-layout="continuous"
      data-testid="slei-settings-overlay"
    >
      <aside
        className="flex w-72 shrink-0 flex-col border-r bg-muted/25 md:w-80"
        data-testid="slei-settings-overlay-nav"
      >
        <div className="grid gap-3 border-b px-4 py-4">
          <Button
            aria-label={labels.returnToApp}
            className="w-fit"
            onClick={onClose}
            data-testid="slei-settings-return"
            type="button"
            variant="ghost"
          >
            <SleiIcon className="size-4" name="panelClose" />
            {labels.returnToApp}
          </Button>
          <div className="relative">
            <SleiIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" name="search" />
            <Input
              aria-label={labels.searchPlaceholder}
              className="pl-9"
              onInput={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder={labels.searchPlaceholder}
              role="searchbox"
              type="search"
              value={searchQuery}
            />
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <nav aria-label={messages.settings.title} className="grid gap-5 px-3 py-4">
            {filteredGroups.map((group) => (
              <section className="grid gap-2" key={group.id}>
                <h2 className="px-2 text-xs font-medium text-muted-foreground">{labels.groups[group.id]}</h2>
                <div className="grid gap-1">
                  {group.panels.map((panel) => {
                    const active = panel === activePanel;
                    return (
                      <Button
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "h-auto justify-start gap-3 rounded-md px-2 py-2 text-left",
                          active && "bg-accent text-accent-foreground",
                        )}
                        key={panel}
                        onClick={() => onPanelChange(panel)}
                        type="button"
                        variant="ghost"
                      >
                        <SleiIcon className="size-4" name={settingsOverlayPanelIcons[panel]} />
                        <span className="grid min-w-0 gap-0.5">
                          <span className="truncate text-sm font-medium">{labels.panels[panel]}</span>
                          <span className="line-clamp-2 text-xs font-normal text-muted-foreground">
                            {labels.panelDescriptions[panel]}
                          </span>
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </section>
            ))}
          </nav>
        </ScrollArea>
      </aside>

      <main
        className="min-w-0 flex-1 border-l bg-background shadow-[-4px_0_4px_-4px_rgba(15,23,42,0.16)]"
        data-settings-detail-surface="border-left-shadow-left"
        data-testid="slei-settings-overlay-detail"
      >
        <ScrollArea className="h-full min-h-0">
          {renderDetail(activePanel)}
        </ScrollArea>
      </main>
    </section>
  );
}
