const STORAGE_PREFIX = "tandem:onboarding:v1";
const SETUP_STORAGE_PREFIX = "tandem:setup-checklist:v1";

export type OnboardingStep = {
  id: string;
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

export type SetupChecklistItemId =
  | "deposit-usdc"
  | "deposit-agent-sol"
  | "agent-json-file"
  | "agent-setup-command";

export type SetupChecklistItem = {
  id: SetupChecklistItemId;
  title: string;
  body: string;
  actionLabel?: string;
};

export type SetupChecklistProgress = {
  completedItems: SetupChecklistItemId[];
  dismissed: boolean;
  updatedAt: string;
};

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "vault-name",
    title: "Name the vault",
    body: "Use a human-friendly label so you can recognize this vault later.",
    targetId: "vault-name",
  },
  {
    id: "spending-limit",
    title: "Set the spending limit",
    body: "This is the max USDC per transaction your agent can send without approval. You can edit it later.",
    targetId: "spending-limit",
  },
  {
    id: "agent-keypair",
    title: "Generate the agent keypair",
    body: "Recommended. This creates the wallet and signing key your agent will use for Tandem actions.",
    targetId: "agent-keypair",
  },
  {
    id: "download-keypair",
    title: "Download the keypair JSON",
    body: "Recommended: download the JSON and give it to your agent. If you avoid browser downloads, open Advanced and manually save the copied JSON as a plain-text .json file.",
    targetId: "agent-keypair-download",
    fallbackTargetId: "agent-keypair",
  },
  {
    id: "create-vault",
    title: "Create the vault",
    body: "This creates the on-chain vault and links your wallet, agent wallet, and spending limit.",
    targetId: "create-vault",
  },
];

export const SETUP_CHECKLIST_ITEMS: SetupChecklistItem[] = [
  {
    id: "deposit-usdc",
    title: "Deposit USDC",
    body: "This is the vault balance your agent can spend from.",
    actionLabel: "Top up",
  },
  {
    id: "deposit-agent-sol",
    title: "Deposit agent SOL",
    body: "This pays gas for agent sends and proposals. It goes to the agent wallet, not the USDC vault.",
    actionLabel: "Top up",
  },
  {
    id: "agent-json-file",
    title: "Give the agent the JSON file",
    body: "Upload the downloaded or manually saved JSON file to the agent, or store it somewhere the agent can access. Click Done after that is handled.",
  },
  {
    id: "agent-setup-command",
    title: "Send the setup command",
    body: "Copy this command, paste it into your agent, then come back and click Done.",
    actionLabel: "Copy command",
  },
];

export const FIRST_ONBOARDING_STEP_ID = ONBOARDING_STEPS[0].id;
export const FINAL_ONBOARDING_STEP_ID =
  ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1].id;

function storageKey(walletAddress: string): string {
  return `${STORAGE_PREFIX}:${walletAddress}`;
}

function setupStorageKey(walletAddress: string, vaultAddress: string): string {
  return `${SETUP_STORAGE_PREFIX}:${walletAddress}:${vaultAddress}`;
}

function emptySetupProgress(): SetupChecklistProgress {
  return {
    completedItems: [],
    dismissed: false,
    updatedAt: new Date().toISOString(),
  };
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

function normalizeSetupProgress(value: unknown): SetupChecklistProgress {
  if (!value || typeof value !== "object") {
    return emptySetupProgress();
  }

  const progress = value as Partial<SetupChecklistProgress>;
  const validIds = new Set(SETUP_CHECKLIST_ITEMS.map((item) => item.id));
  const completedItems = Array.isArray(progress.completedItems)
    ? progress.completedItems.filter((id): id is SetupChecklistItemId =>
        validIds.has(id as SetupChecklistItemId)
      )
    : [];

  return {
    completedItems: [...new Set(completedItems)],
    dismissed: Boolean(progress.dismissed),
    updatedAt:
      typeof progress.updatedAt === "string"
        ? progress.updatedAt
        : new Date().toISOString(),
  };
}

export function loadSetupChecklistProgress(
  walletAddress: string | null,
  vaultAddress: string | null
): SetupChecklistProgress {
  if (!walletAddress || !vaultAddress || typeof window === "undefined") {
    return emptySetupProgress();
  }

  try {
    const raw = window.localStorage.getItem(
      setupStorageKey(walletAddress, vaultAddress)
    );
    if (!raw) return emptySetupProgress();
    return normalizeSetupProgress(JSON.parse(raw));
  } catch {
    return emptySetupProgress();
  }
}

export function saveSetupChecklistProgress(
  walletAddress: string,
  vaultAddress: string,
  progress: Omit<SetupChecklistProgress, "updatedAt">
): SetupChecklistProgress {
  const next = {
    ...progress,
    completedItems: [...new Set(progress.completedItems)],
    updatedAt: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(
      setupStorageKey(walletAddress, vaultAddress),
      JSON.stringify(next)
    );
  } catch {
    // Setup checklist progress should not block vault use.
  }

  return next;
}

export function firstIncompleteSetupItem(
  completedItems: SetupChecklistItemId[]
): SetupChecklistItemId | null {
  const completed = new Set(completedItems);
  return (
    SETUP_CHECKLIST_ITEMS.find((item) => !completed.has(item.id))?.id ?? null
  );
}

export function stepIndexForId(stepId: string): number {
  return Math.max(
    0,
    ONBOARDING_STEPS.findIndex((step) => step.id === stepId)
  );
}
