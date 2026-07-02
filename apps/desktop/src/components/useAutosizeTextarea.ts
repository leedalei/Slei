import { useLayoutEffect, useRef } from "react";

export function useAutosizeTextarea(value: string, input: { maxHeight: number | (() => number) }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;

    const syncTextareaHeight = () => {
      const maxHeight = typeof input.maxHeight === "function" ? input.maxHeight() : input.maxHeight;
      textarea.style.height = "auto";
      textarea.style.maxHeight = `${maxHeight}px`;
      const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = `${nextHeight}px`;
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    };

    syncTextareaHeight();
    if (typeof input.maxHeight !== "function") return undefined;
    window.addEventListener("resize", syncTextareaHeight);
    return () => window.removeEventListener("resize", syncTextareaHeight);
  }, [value, input.maxHeight]);

  return ref;
}
