"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { OnboardingStep } from "@/lib/onboarding";

type TargetBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type Viewport = {
  width: number;
  height: number;
};

function findOnboardingTarget(step: OnboardingStep): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const primary = step.targetId
    ? document.querySelector<HTMLElement>(
        `[data-onboarding="${step.targetId}"]`
      )
    : null;
  if (primary) return primary;

  return step.fallbackTargetId
    ? document.querySelector<HTMLElement>(
        `[data-onboarding="${step.fallbackTargetId}"]`
      )
    : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function panelStyle(box: TargetBox | null, viewport: Viewport): CSSProperties {
  const width = Math.min(360, Math.max(280, viewport.width - 32));

  if (!box || viewport.width === 0 || viewport.height === 0) {
    return {
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      width,
    };
  }

  const gap = 14;
  const minEdge = 16;
  const left = clamp(box.left, minEdge, viewport.width - width - minEdge);
  const estimatedHeight = 260;
  const belowTop = box.top + box.height + gap;
  const showBelow =
    belowTop + estimatedHeight <= viewport.height || box.top < viewport.height / 2;

  if (showBelow) {
    return {
      left,
      top: clamp(belowTop, minEdge, viewport.height - estimatedHeight),
      width,
    };
  }

  return {
    left,
    bottom: clamp(viewport.height - box.top + gap, minEdge, viewport.height - 96),
    width,
  };
}

function dimPanels(box: TargetBox | null, viewport: Viewport) {
  if (!box || viewport.width === 0 || viewport.height === 0) {
    return (
      <div className="fixed inset-0 bg-black/70" aria-hidden="true" />
    );
  }

  const topHeight = Math.max(0, box.top);
  const bottomTop = Math.min(viewport.height, box.top + box.height);
  const bottomHeight = Math.max(0, viewport.height - bottomTop);
  const leftWidth = Math.max(0, box.left);
  const rightLeft = Math.min(viewport.width, box.left + box.width);
  const rightWidth = Math.max(0, viewport.width - rightLeft);

  return (
    <>
      <div
        className="fixed left-0 top-0 bg-black/70"
        style={{ width: "100vw", height: topHeight }}
        aria-hidden="true"
      />
      <div
        className="fixed left-0 bg-black/70"
        style={{ top: bottomTop, width: "100vw", height: bottomHeight }}
        aria-hidden="true"
      />
      <div
        className="fixed bg-black/70"
        style={{
          left: 0,
          top: box.top,
          width: leftWidth,
          height: box.height,
        }}
        aria-hidden="true"
      />
      <div
        className="fixed bg-black/70"
        style={{
          left: rightLeft,
          top: box.top,
          width: rightWidth,
          height: box.height,
        }}
        aria-hidden="true"
      />
    </>
  );
}

export function OnboardingOverlay({
  active,
  step,
  stepIndex,
  totalSteps,
  nextDisabled = false,
  nextLabel = "Next",
  onNext,
  onBack,
  onSkip,
  onFinish,
}: {
  active: boolean;
  step: OnboardingStep;
  stepIndex: number;
  totalSteps: number;
  nextDisabled?: boolean;
  nextLabel?: string;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onFinish: () => void;
}) {
  const [box, setBox] = useState<TargetBox | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });
  const isFinalStep = stepIndex === totalSteps - 1;

  const measure = useCallback(() => {
    if (!active || typeof window === "undefined") return;

    setViewport({
      width: window.innerWidth,
      height: window.innerHeight,
    });

    const target = findOnboardingTarget(step);
    if (!target) {
      setBox(null);
      return;
    }

    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      setBox(null);
      return;
    }

    const padding = 6;
    setBox({
      top: clamp(rect.top - padding, 8, window.innerHeight - 24),
      left: clamp(rect.left - padding, 8, window.innerWidth - 24),
      width: Math.min(rect.width + padding * 2, window.innerWidth - 16),
      height: Math.min(rect.height + padding * 2, window.innerHeight - 16),
    });
  }, [active, step]);

  useEffect(() => {
    if (!active) return;

    const scrollTargetIntoView = () => {
      findOnboardingTarget(step)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    };

    window.requestAnimationFrame(() => {
      scrollTargetIntoView();
      measure();
    });

    const interval = window.setInterval(measure, 300);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [active, measure, step]);

  const popoverStyle = useMemo(() => panelStyle(box, viewport), [box, viewport]);

  if (!active) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {dimPanels(box, viewport)}
      {box && (
        <div
          className="fixed border border-accent shadow-[0_0_0_1px_rgba(73,212,208,0.35),0_0_32px_rgba(10,186,181,0.28)]"
          style={{
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
          }}
          aria-hidden="true"
        />
      )}
      <div
        className="pointer-events-auto fixed border border-line bg-[rgba(2,10,12,0.96)] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.65)]"
        style={popoverStyle}
        role="dialog"
        aria-label="Tandem setup guide"
      >
        <button
          type="button"
          aria-label="Close tutorial"
          onClick={onSkip}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center border border-line-soft text-muted transition-colors hover:border-line hover:text-text"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M6 6l12 12" />
            <path d="M18 6L6 18" />
          </svg>
        </button>
        <div className="mb-3 pr-9">
          <p className="font-display text-[0.62rem] uppercase tracking-[0.18em] text-accent-2">
            Step {stepIndex + 1} / {totalSteps}
          </p>
        </div>
        <h2 className="font-display text-lg font-bold text-text">{step.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
        {!box && (
          <p className="mt-3 border border-line-soft bg-[rgba(10,186,181,0.04)] p-2 text-xs text-accent-2">
            Continue in the app to reveal this step.
          </p>
        )}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={onSkip}
            className="text-left text-[0.65rem] font-display uppercase tracking-[0.14em] text-muted transition-colors hover:text-text"
          >
            Skip tutorial
          </button>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onBack}
              disabled={stepIndex === 0}
              className="border border-line-soft px-3 py-2 text-xs font-display uppercase tracking-[0.14em] text-muted transition-colors hover:border-line hover:text-text disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              onClick={isFinalStep ? onFinish : onNext}
              disabled={nextDisabled}
              className="brackets-accent px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-[#032b2a] disabled:opacity-50"
            >
              {isFinalStep ? "Finish" : nextLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function OnboardingControl({
  visible,
  active,
  hasProgress,
  completed,
  skipped,
  stepIndex,
  totalSteps,
  onResume,
  onRestart,
}: {
  visible: boolean;
  active: boolean;
  hasProgress: boolean;
  completed: boolean;
  skipped: boolean;
  stepIndex: number;
  totalSteps: number;
  onResume: () => void;
  onRestart: () => void;
}) {
  if (!visible) return null;

  const status = !hasProgress
    ? "Not started"
    : completed
    ? "Complete"
    : skipped
      ? `Paused at step ${stepIndex + 1}`
      : `Step ${stepIndex + 1} / ${totalSteps}`;

  return (
    <div className="fixed bottom-4 left-4 z-30 max-w-[calc(100vw-2rem)] border border-line-soft bg-[rgba(2,10,12,0.92)] p-3 shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="font-display text-[0.58rem] uppercase tracking-[0.18em] text-accent-2">
            Setup guide
          </p>
          <p className="mt-1 font-display text-xs text-text">{status}</p>
        </div>
        <div className="flex gap-2">
          {!active && !completed && (
            <button
              type="button"
              onClick={onResume}
              className="border border-line-soft px-2.5 py-1.5 text-[0.62rem] font-display uppercase tracking-[0.14em] text-accent-2 transition-colors hover:border-line hover:text-text"
            >
              {hasProgress || skipped ? "Resume" : "Start"}
            </button>
          )}
          {completed ? (
            <button
              type="button"
              onClick={onRestart}
              className="border border-line-soft px-2.5 py-1.5 text-[0.62rem] font-display uppercase tracking-[0.14em] text-muted transition-colors hover:border-line hover:text-text"
            >
              Restart
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
