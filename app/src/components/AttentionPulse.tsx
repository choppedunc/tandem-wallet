export function AttentionPulse({
  label = "Action needed",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`relative inline-flex h-2.5 w-2.5 shrink-0 ${className}`}
      title={label}
    >
      <span
        aria-hidden="true"
        className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#d45f67] opacity-60"
      />
      <span
        aria-hidden="true"
        className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#d45f67] shadow-[0_0_10px_rgba(212,95,103,0.45)]"
      />
    </span>
  );
}
