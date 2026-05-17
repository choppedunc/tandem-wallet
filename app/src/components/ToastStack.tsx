"use client";

import {
  useEffect,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

export type ToastNotification = {
  id: string;
  title: string;
  message?: string;
  actionLabel?: string;
  href?: string;
  externalHref?: string;
  external?: boolean;
  onActivate?: () => void;
  durationMs?: number;
};

const DEFAULT_TOAST_DURATION_MS = 15_000;

function ToastItem({
  toast,
  onClose,
}: {
  toast: ToastNotification;
  onClose: (id: string) => void;
}) {
  const duration = toast.durationMs ?? DEFAULT_TOAST_DURATION_MS;
  const progressStyle = {
    "--toast-duration": `${duration}ms`,
  } as CSSProperties;

  useEffect(() => {
    const timeout = window.setTimeout(() => onClose(toast.id), duration);
    return () => window.clearTimeout(timeout);
  }, [duration, onClose, toast.id]);

  const hasAction = Boolean(toast.href || toast.onActivate);
  const newTabHref =
    toast.externalHref ?? (toast.external && toast.href ? toast.href : null);

  function activate() {
    if (toast.onActivate) {
      toast.onActivate();
      return;
    }
    if (toast.href) {
      if (toast.external) {
        window.open(toast.href, "_blank", "noopener,noreferrer");
      } else {
        window.location.href = toast.href;
      }
    }
  }

  function openNewTab(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!newTabHref) return;
    window.open(newTabHref, "_blank", "noopener,noreferrer");
  }

  function activateFromKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!hasAction) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  }

  return (
    <div
      role={hasAction ? "button" : "status"}
      tabIndex={hasAction ? 0 : undefined}
      onClick={hasAction ? activate : undefined}
      onKeyDown={activateFromKeyboard}
      className={`relative min-h-20 overflow-hidden border border-line bg-[rgba(2,10,12,0.96)] p-3 ${newTabHref ? "pr-20" : "pr-10"} shadow-[0_18px_48px_rgba(0,0,0,0.42)] ${
        hasAction ? "cursor-pointer transition-colors hover:bg-[rgba(4,20,23,0.98)]" : ""
      }`}
    >
      <div className="flex min-w-0 items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-xs font-bold uppercase tracking-[0.16em] text-accent-2">
            {toast.title}
          </div>
          {toast.message ? (
            <div className="mt-1 truncate text-sm text-text">{toast.message}</div>
          ) : null}
        </div>
        {toast.actionLabel ? (
          <div className="hidden shrink-0 font-display text-[0.62rem] uppercase tracking-[0.14em] text-muted sm:block">
            {toast.actionLabel}
          </div>
        ) : null}
        {newTabHref ? (
          <button
            type="button"
            aria-label="Open transaction in block explorer"
            onClick={openNewTab}
            className="absolute right-10 top-2 flex h-6 w-6 items-center justify-center border border-line-soft text-muted transition-colors hover:border-line hover:text-text"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7 17L17 7" />
              <path d="M8 7h9v9" />
              <path d="M5 5v14h14" />
            </svg>
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Close notification"
          onClick={(event) => {
            event.stopPropagation();
            onClose(toast.id);
          }}
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center border border-line-soft font-display text-sm text-muted transition-colors hover:border-line hover:text-text"
        >
          ×
        </button>
      </div>

      <div
        className="toast-progress absolute inset-x-0 bottom-0 h-0.5 bg-accent"
        style={progressStyle}
      />
    </div>
  );
}

export function ToastStack({
  toasts,
  onClose,
}: {
  toasts: ToastNotification[];
  onClose: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(34rem,calc(100vw-2rem))] flex-col gap-3">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onClose={onClose} />
        </div>
      ))}
    </div>
  );
}
