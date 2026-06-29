type ClipboardWriter = {
  writeText?: (text: string) => Promise<void>;
};

export async function copyPlainText(text: string): Promise<boolean> {
  if (text.length === 0) return false;
  const clipboard: ClipboardWriter | undefined = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (clipboard?.writeText) {
    await clipboard.writeText(text);
    return true;
  }
  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}
