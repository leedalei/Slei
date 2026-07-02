import { useLayoutEffect, useRef } from "react";

export function useAutosizeTextarea(value: string, input: { maxHeight: number | (() => number) }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    const maxHeight = typeof input.maxHeight === "function" ? input.maxHeight() : input.maxHeight;
    textarea.style.height = "auto";
    textarea.style.maxHeight = `${maxHeight}px`;
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, input.maxHeight]);

  return ref;
}
