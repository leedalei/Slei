export type MentionTarget = {
  displayName: string;
  handle: string;
  kind: "agent" | "human";
};

export function mentionSuggestions(query: string, targets: MentionTarget[]): MentionTarget[] {
  const normalized = query.replace(/^@/, "").toLowerCase();
  return targets.filter(
    (target) =>
      target.handle.toLowerCase().includes(normalized) ||
      target.displayName.toLowerCase().includes(normalized),
  );
}
