export function Toast({ message }: { message?: string }) {
  const text = message?.trim();
  if (!text) return null;

  return (
    <div aria-live="polite" className="slei-toast-viewport" role="status">
      <div className="slei-toast">{text}</div>
    </div>
  );
}
