export function Toast({ message, text }: { message?: string; text?: string }) {
  const content = (text ?? message)?.trim();
  if (!content) return null;

  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50" role="status">
      <div className="rounded-md border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-md">
        {content}
      </div>
    </div>
  );
}
