export const TOAST_VISIBLE_MS = 2500;

type ToastClipboard = {
  writeText: (text: string) => Promise<void> | void;
};

export async function copyToastContent(text: string, environment?: { clipboard?: ToastClipboard }) {
  const content = text.trim();
  if (!content) return false;
  const clipboard = environment?.clipboard ?? (typeof navigator !== "undefined" ? navigator.clipboard : undefined);
  if (clipboard?.writeText) {
    await clipboard.writeText(content);
    return true;
  }
  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

export function Toast({ message, text }: { message?: string; text?: string }) {
  const content = (text ?? message)?.trim();
  if (!content) return null;

  return (
    <div aria-live="polite" className="pointer-events-none fixed top-4 left-1/2 z-50 -translate-x-1/2" role="status">
      <button
        className="pointer-events-auto rounded-md border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-md"
        onClick={() => void copyToastContent(content)}
        title="点击复制"
        type="button"
      >
        {content}
      </button>
    </div>
  );
}
