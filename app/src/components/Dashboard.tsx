"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  useAnchorWallet,
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";
import type { Connection, PublicKey } from "@solana/web3.js";
import { getProgram } from "@/lib/program";
import { syncVaultMetadata } from "@/lib/vaultMetadataSync";
import {
  fallbackVaultName,
  loadVaultCreatedOrder,
  loadVaultNames,
  saveVaultCreatedAt,
  saveVaultName,
} from "@/lib/vaultNames";
import {
  FIRST_ONBOARDING_STEP_ID,
  FINAL_ONBOARDING_STEP_ID,
  ONBOARDING_STEPS,
  loadOnboardingProgress,
  saveOnboardingProgress,
  stepIndexForId,
  type OnboardingProgress,
} from "@/lib/onboarding";
import { CreateVaultForm } from "./CreateVaultForm";
import {
  OnboardingControl,
  OnboardingOverlay,
} from "./OnboardingOverlay";
import { VaultDetail, type VaultData, type VaultTab } from "./VaultDetail";

const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

const VAULT_TABS = new Set<VaultTab>([
  "overview",
  "funds",
  "proposals",
  "history",
  "whitelist",
  "agent",
]);

type DeepLinkState = {
  vault: string | null;
  tab: VaultTab | null;
  proposal: string | null;
};

const MAX_CREATION_SIGNATURE_PAGES = 3;
const CREATION_SIGNATURE_PAGE_SIZE = 1000;

function readDeepLink(): DeepLinkState {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  return {
    vault: params.get("vault"),
    tab: tab && VAULT_TABS.has(tab as VaultTab) ? (tab as VaultTab) : null,
    proposal: params.get("proposal"),
  };
}

async function discoverVaultCreatedAt(
  connection: Connection,
  address: PublicKey
): Promise<number | null> {
  try {
    let before: string | undefined;
    let oldestBlockTime: number | null = null;

    for (let page = 0; page < MAX_CREATION_SIGNATURE_PAGES; page += 1) {
      const signatures = await connection.getSignaturesForAddress(address, {
        limit: CREATION_SIGNATURE_PAGE_SIZE,
        before,
      });

      if (signatures.length === 0) break;

      const oldestSignature = signatures[signatures.length - 1];
      oldestBlockTime = oldestSignature.blockTime ?? oldestBlockTime;

      if (signatures.length < CREATION_SIGNATURE_PAGE_SIZE) break;
      before = oldestSignature.signature;
    }

    return oldestBlockTime ? oldestBlockTime * 1000 : null;
  } catch {
    return null;
  }
}

export function Dashboard() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const { signMessage } = useWallet();
  const walletAddress = wallet?.publicKey.toBase58() ?? null;
  const [vaults, setVaults] = useState<VaultData[] | null>(null);
  const [vaultNames, setVaultNames] = useState<Record<string, string>>({});
  const [selectedVaultAddress, setSelectedVaultAddress] = useState<
    string | null
  >(null);
  const [showCreateVault, setShowCreateVault] = useState(false);
  const [deepLink, setDeepLink] = useState<DeepLinkState>({
    vault: null,
    tab: null,
    proposal: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [onboardingProgress, setOnboardingProgress] =
    useState<OnboardingProgress | null>(null);
  const [onboardingActive, setOnboardingActive] = useState(false);
  const [onboardingLoadedWallet, setOnboardingLoadedWallet] = useState<
    string | null
  >(null);
  const appliedDeepLinkVaultRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const metadataSyncInFlightRef = useRef(false);
  const metadataSyncSkippedRef = useRef(false);

  const program = useMemo(
    () => (wallet ? getProgram(connection, wallet) : null),
    [connection, wallet]
  );

  useEffect(() => {
    setVaultNames(loadVaultNames());
    setDeepLink(readDeepLink());
  }, []);

  useEffect(() => {
    metadataSyncSkippedRef.current = false;
  }, [walletAddress]);

  useEffect(() => {
    const progress = loadOnboardingProgress(walletAddress);
    setOnboardingProgress(progress);
    setOnboardingLoadedWallet(walletAddress);
    setOnboardingActive(
      Boolean(progress && !progress.completed && !progress.skipped)
    );
  }, [walletAddress]);

  const refresh = useCallback(async () => {
    if (!program || !wallet) return;
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const accounts = await program.account.vault.all([
        { memcmp: { offset: 8, bytes: wallet.publicKey.toBase58() } },
      ]);
      const mapped: VaultData[] = accounts.map((a) => ({
        address: a.publicKey,
        human: a.account.human,
        agent: a.account.agent,
        usdcMint: a.account.usdcMint,
        vaultUsdcAta: a.account.vaultUsdcAta,
        spendingLimit: a.account.spendingLimit,
        paused: a.account.paused,
        proposalCount: a.account.proposalCount,
      }));

      let orderForDisplay = loadVaultCreatedOrder();
      const missingCreationTimes = mapped.filter(
        (vault) => orderForDisplay[vault.address.toBase58()] === undefined
      );

      for (const vault of missingCreationTimes) {
        const createdAt = await discoverVaultCreatedAt(connection, vault.address);
        if (createdAt !== null) {
          orderForDisplay = saveVaultCreatedAt(vault.address, createdAt);
        }
      }

      if (
        signMessage &&
        !metadataSyncInFlightRef.current &&
        !metadataSyncSkippedRef.current
      ) {
        metadataSyncInFlightRef.current = true;
        const result = await syncVaultMetadata({
          publicKey: wallet.publicKey,
          signMessage,
        });
        metadataSyncInFlightRef.current = false;

        if (result.synced) {
          orderForDisplay = loadVaultCreatedOrder();
        } else if (result.error) {
          metadataSyncSkippedRef.current = true;
        }
      }

      setVaultNames(loadVaultNames());

      const ordered = mapped
        .map((vault, index) => ({ vault, index }))
        .sort((a, b) => {
          const aCreatedAt = orderForDisplay[a.vault.address.toBase58()];
          const bCreatedAt = orderForDisplay[b.vault.address.toBase58()];

          if (aCreatedAt !== undefined && bCreatedAt !== undefined) {
            return bCreatedAt - aCreatedAt;
          }
          if (aCreatedAt !== undefined) return -1;
          if (bCreatedAt !== undefined) return 1;
          return a.index - b.index;
        })
        .map(({ vault }) => vault);

      setVaults(ordered);
      setSelectedVaultAddress((current) => {
        if (
          deepLink.vault &&
          !appliedDeepLinkVaultRef.current &&
          ordered.some((vault) => vault.address.toBase58() === deepLink.vault)
        ) {
          appliedDeepLinkVaultRef.current = true;
          return deepLink.vault;
        }
        if (
          current &&
          ordered.some((vault) => vault.address.toBase58() === current)
        ) {
          return current;
        }
        return ordered[0]?.address.toBase58() ?? null;
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      refreshInFlightRef.current = false;
      setLoading(false);
    }
  }, [connection, deepLink.vault, program, signMessage, wallet]);

  useEffect(() => {
    if (program && wallet) refresh();
    else {
      setVaults(null);
      setSelectedVaultAddress(null);
      setShowCreateVault(false);
    }
  }, [program, wallet, refresh]);

  const onboardingStepIndex = stepIndexForId(
    onboardingProgress?.stepId ?? FIRST_ONBOARDING_STEP_ID
  );
  const onboardingStep = ONBOARDING_STEPS[onboardingStepIndex];
  const onboardingVisible =
    onboardingActive &&
    Boolean(onboardingProgress) &&
    !onboardingProgress?.completed &&
    !onboardingProgress?.skipped;
  const createVaultVisible =
    Boolean(walletAddress) &&
    ((vaults !== null && vaults.length === 0) || showCreateVault);
  const hasVaults = Boolean(vaults && vaults.length > 0);

  const setOnboardingStep = useCallback(
    (stepId: string, active = true) => {
      if (!walletAddress) return;
      const next = saveOnboardingProgress(walletAddress, {
        stepId,
        completed: false,
        skipped: false,
      });
      setOnboardingProgress(next);
      setOnboardingActive(active);
    },
    [walletAddress]
  );

  const restartOnboarding = useCallback(() => {
    setOnboardingStep(FIRST_ONBOARDING_STEP_ID, true);
  }, [setOnboardingStep]);

  const resumeOnboarding = useCallback(() => {
    if (!walletAddress) return;
    if (
      !onboardingProgress ||
      onboardingProgress.completed ||
      onboardingProgress.skipped
    ) {
      restartOnboarding();
      return;
    }
    setOnboardingActive(true);
  }, [onboardingProgress, restartOnboarding, walletAddress]);

  const skipOnboarding = useCallback(() => {
    if (!walletAddress) return;
    const next = saveOnboardingProgress(walletAddress, {
      stepId: onboardingStep.id,
      completed: false,
      skipped: true,
    });
    setOnboardingProgress(next);
    setOnboardingActive(false);
  }, [onboardingStep.id, walletAddress]);

  const finishOnboarding = useCallback(() => {
    if (!walletAddress) return;
    const next = saveOnboardingProgress(walletAddress, {
      stepId: FINAL_ONBOARDING_STEP_ID,
      completed: true,
      skipped: false,
    });
    setOnboardingProgress(next);
    setOnboardingActive(false);
  }, [walletAddress]);

  const nextOnboardingStep = useCallback(() => {
    const nextStep = ONBOARDING_STEPS[onboardingStepIndex + 1];
    if (!nextStep) {
      finishOnboarding();
      return;
    }
    setOnboardingStep(nextStep.id, true);
  }, [finishOnboarding, onboardingStepIndex, setOnboardingStep]);

  const previousOnboardingStep = useCallback(() => {
    const previousStep =
      ONBOARDING_STEPS[Math.max(0, onboardingStepIndex - 1)];
    setOnboardingStep(previousStep.id, true);
  }, [onboardingStepIndex, setOnboardingStep]);

  const handleAgentGenerated = useCallback(() => {
    if (!onboardingVisible || onboardingStep.id !== "agent-keypair") return;
    setOnboardingStep("download-keypair", true);
  }, [onboardingStep.id, onboardingVisible, setOnboardingStep]);

  const handleAgentModeChange = useCallback(
    (mode: "generate" | "paste") => {
      if (!onboardingVisible || mode !== "paste") return;
      if (
        onboardingStep.id !== "agent-keypair" &&
        onboardingStep.id !== "download-keypair"
      ) {
        return;
      }
      setOnboardingStep("create-vault", true);
    },
    [onboardingStep.id, onboardingVisible, setOnboardingStep]
  );

  useEffect(() => {
    if (!walletAddress || onboardingProgress) return;
    if (onboardingLoadedWallet !== walletAddress) return;
    if (!createVaultVisible) return;
    setOnboardingStep(FIRST_ONBOARDING_STEP_ID, true);
  }, [
    createVaultVisible,
    onboardingLoadedWallet,
    onboardingProgress,
    setOnboardingStep,
    walletAddress,
  ]);

  useEffect(() => {
    if (!onboardingVisible) return;
    if (onboardingStep.id !== "create-vault") return;
    if (!hasVaults || showCreateVault) return;
    setOnboardingStep("deposit-usdc", true);
  }, [
    hasVaults,
    onboardingStep.id,
    onboardingVisible,
    setOnboardingStep,
    showCreateVault,
  ]);

  const onboardingNextDisabled =
    onboardingStep.id === "create-vault" && !hasVaults;
  const onboardingNextLabel = onboardingNextDisabled
    ? "Create vault first"
    : "Next";

  const onboardingUi = walletAddress ? (
    <>
      <OnboardingOverlay
        active={onboardingVisible}
        step={onboardingStep}
        stepIndex={onboardingStepIndex}
        totalSteps={ONBOARDING_STEPS.length}
        nextDisabled={onboardingNextDisabled}
        nextLabel={onboardingNextLabel}
        onNext={nextOnboardingStep}
        onBack={previousOnboardingStep}
        onSkip={skipOnboarding}
        onFinish={finishOnboarding}
        onRestart={restartOnboarding}
      />
      <OnboardingControl
        visible={Boolean(walletAddress)}
        active={onboardingVisible}
        hasProgress={Boolean(onboardingProgress)}
        completed={Boolean(onboardingProgress?.completed)}
        skipped={Boolean(onboardingProgress?.skipped)}
        stepIndex={onboardingStepIndex}
        totalSteps={ONBOARDING_STEPS.length}
        onResume={resumeOnboarding}
        onRestart={restartOnboarding}
      />
    </>
  ) : null;

  if (!wallet) {
    return (
      <div className="brackets p-12 text-center">
        <p className="text-xs uppercase tracking-[0.18em] text-accent font-display mb-3">
          Step 01
        </p>
        <h1 className="font-display text-3xl md:text-4xl font-bold mb-3 text-text">
          Connect your wallet
        </h1>
        <p className="text-muted max-w-md mx-auto">
          Connect a Solana wallet to view, create, and govern your Tandem Wallet
          vault.
        </p>
        <div className="mt-6 flex justify-center">
          <div className="site-wallet-button">
            <WalletMultiButton />
          </div>
        </div>
      </div>
    );
  }

  if (loading && !vaults) {
    return (
      <div className="text-muted text-sm font-display tracking-wider uppercase">
        Loading vaults…
      </div>
    );
  }

  if (error) {
    return (
      <div className="brackets p-6">
        <p className="text-accent-2 text-sm">{error}</p>
        <button
          onClick={refresh}
          className="mt-3 text-sm font-semibold text-accent hover:text-accent-2 underline underline-offset-4"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!vaults || vaults.length === 0) {
    return (
      <>
        <CreateVaultForm
          onCreated={(vault, name) => {
            setVaultNames(saveVaultName(vault, name));
            saveVaultCreatedAt(vault);
            setSelectedVaultAddress(vault.toBase58());
            refresh();
          }}
          onAgentGenerated={handleAgentGenerated}
          onAgentModeChange={handleAgentModeChange}
        />
        {onboardingUi}
      </>
    );
  }

  const selectedVault =
    vaults.find((vault) => vault.address.toBase58() === selectedVaultAddress) ??
    vaults[0];

  return (
    <div className="space-y-6">
      {vaults.length > 0 && (
        <div className="brackets p-4">
          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display">
                Vaults
              </p>
              <button
                type="button"
                onClick={() => setShowCreateVault((visible) => !visible)}
                className={`px-3 py-2 text-xs font-display font-bold uppercase tracking-[0.14em] ${
                  showCreateVault
                    ? "border border-line text-text bg-[rgba(10,186,181,0.08)] transition-colors hover:bg-[rgba(10,186,181,0.12)]"
                    : "brackets-accent text-[#032b2a]"
                }`}
              >
                {showCreateVault ? "Cancel create" : "+ Create vault"}
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {vaults.map((vault) => {
                const address = vault.address.toBase58();
                const selected =
                  !showCreateVault &&
                  address === selectedVault.address.toBase58();
                return (
                  <button
                    key={address}
                    type="button"
                    onClick={() => {
                      setSelectedVaultAddress(address);
                      setShowCreateVault(false);
                    }}
                    className={`min-w-0 border px-3 py-2 text-left transition-colors ${
                      selected
                        ? "border-line bg-[rgba(10,186,181,0.08)] text-text"
                        : "border-line-soft text-muted hover:border-line hover:text-text"
                    }`}
                  >
                    <span className="block truncate font-display text-base font-bold text-text">
                      {vaultNames[address] ?? fallbackVaultName(vault.address)}
                    </span>
                    <span className="mt-1 block truncate text-xs font-display text-muted">
                      {vault.agent.toBase58()}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {showCreateVault ? (
        <>
          <CreateVaultForm
            onCreated={(vault, name) => {
              setVaultNames(saveVaultName(vault, name));
              saveVaultCreatedAt(vault);
              setSelectedVaultAddress(vault.toBase58());
              setShowCreateVault(false);
              refresh();
            }}
            onAgentGenerated={handleAgentGenerated}
            onAgentModeChange={handleAgentModeChange}
          />
          {onboardingUi}
        </>
      ) : (
        <VaultDetail
          vault={selectedVault}
          vaultName={
            vaultNames[selectedVault.address.toBase58()] ??
            fallbackVaultName(selectedVault.address)
          }
          onChange={refresh}
          initialTab={deepLink.tab ?? undefined}
          initialProposal={deepLink.proposal}
          onboardingStepId={
            onboardingVisible && onboardingStep.phase === "vault"
              ? onboardingStep.id
              : null
          }
        />
      )}
      {!showCreateVault && onboardingUi}
    </div>
  );
}
