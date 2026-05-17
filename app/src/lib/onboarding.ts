const STORAGE_PREFIX = "tandem:onboarding:v1";

export type OnboardingPhase = "create" | "vault";

export type OnboardingStep = {
  id: string;
  phase: OnboardingPhase;
  title: string;
  body: string;
  targetId?: string;
  fallbackTargetId?: string;
};

export type OnboardingProgress = {
  stepId: string;
  completed: boolean;
  skipped: boolean;
  updatedAt: string;
};

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "vault-name",
    phase: "create",
    title: "Name the vault",
    body: "Use a human-friendly label so you can recognize this vault later.",
    targetId: "vault-name",
  },
  {
    id: "spending-limit",
    phase: "create",
    title: "Set the spending limit",
    body: "This is the max USDC per transaction your agent can send without approval. You can edit it later.",
    targetId: "spending-limit",
  },
  {
    id: "agent-keypair",
    phase: "create",
    title: "Generate the agent keypair",
    body: "This creates the wallet and signing key your agent will use for Tandem actions.",
    targetId: "agent-keypair",
  },
  {
    id: "download-keypair",
    phase: "create",
    title: "Download the keypair JSON",
    body: "Tandem does not store this file. Save it and give it to your agent.",
    targetId: "agent-keypair-download",
    fallbackTargetId: "agent-keypair",
  },
  {
    id: "create-vault",
    phase: "create",
    title: "Create the vault",
    body: "This creates the on-chain vault and links your wallet, agent wallet, and spending limit.",
    targetId: "create-vault",
  },
  {
    id: "deposit-usdc",
    phase: "vault",
    title: "Deposit USDC",
    body: "This is the vault balance your agent can spend from.",
    targetId: "deposit-usdc",
  },
  {
    id: "deposit-agent-sol",
    phase: "vault",
    title: "Deposit agent SOL",
    body: "This pays gas for agent sends and proposals. It goes to the agent wallet, not the USDC vault.",
    targetId: "deposit-agent-sol",
  },
  {
    id: "agent-json-file",
    phase: "vault",
    title: "Give the agent the JSON file",
    body: "Upload the downloaded file to the agent, or store it somewhere the agent can access.",
    targetId: "agent-json-file",
  },
  {
    id: "agent-setup-command",
    phase: "vault",
    title: "Send the setup command",
    body: "Give this command to the agent. It connects the agent to this specific vault.",
    targetId: "agent-setup-command",
  },
  {
    id: "allowance-controls",
    phase: "vault",
    title: "Allowance controls",
    body: "Edit the per-transaction spending limit any time.",
    targetId: "allowance-controls",
  },
  {
    id: "pause-controls",
    phase: "vault",
    title: "Pause controls",
    body: "Pause blocks agent activity. Your human wallet still controls recovery.",
    targetId: "pause-controls",
  },
  {
    id: "withdraw-controls",
    phase: "vault",
    title: "Withdraw controls",
    body: "The human owner can withdraw USDC from the vault.",
    targetId: "withdraw-controls",
  },
  {
    id: "setup-test",
    phase: "vault",
    title: "Optional setup test",
    body: "Ask the agent to check vault state, then try a tiny send or an above-limit proposal.",
    targetId: "setup-test",
    fallbackTargetId: "agent-setup-command",
  },
];

export const FIRST_ONBOARDING_STEP_ID = ONBOARDING_STEPS[0].id;
export const FINAL_ONBOARDING_STEP_ID =
  ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1].id;

function storageKey(walletAddress: string): string {
  return `${STORAGE_PREFIX}:${walletAddress}`;
}

function normalizeProgress(value: unknown): OnboardingProgress | null {
  if (!value || typeof value !== "object") return null;
  const progress = value as Partial<OnboardingProgress>;
  const stepExists = ONBOARDING_STEPS.some((step) => step.id === progress.stepId);

  if (!progress.stepId || !stepExists) return null;

  return {
    stepId: progress.stepId,
    completed: Boolean(progress.completed),
    skipped: Boolean(progress.skipped),
    updatedAt:
      typeof progress.updatedAt === "string"
        ? progress.updatedAt
        : new Date().toISOString(),
  };
}

export function loadOnboardingProgress(
  walletAddress: string | null
): OnboardingProgress | null {
  if (!walletAddress || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(walletAddress));
    if (!raw) return null;
    return normalizeProgress(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveOnboardingProgress(
  walletAddress: string,
  progress: Omit<OnboardingProgress, "updatedAt">
): OnboardingProgress {
  const next = {
    ...progress,
    updatedAt: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(storageKey(walletAddress), JSON.stringify(next));
  } catch {
    // Tutorial progress should never block vault actions.
  }

  return next;
}

export function stepIndexForId(stepId: string): number {
  return Math.max(
    0,
    ONBOARDING_STEPS.findIndex((step) => step.id === stepId)
  );
}
