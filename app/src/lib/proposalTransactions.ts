const STORAGE_KEY = "tandem:proposal-transactions:v1";

export type ProposalTransactionRecord = {
  action: "approved" | "cancelled";
  signature: string;
  setupSignature?: string;
  recordedAt: string;
};

export type ProposalTransactionRecords = Record<string, ProposalTransactionRecord>;

export function loadProposalTransactions(): ProposalTransactionRecords {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as ProposalTransactionRecords;
  } catch {
    return {};
  }
}

export function saveProposalTransaction(
  proposal: string,
  record: Omit<ProposalTransactionRecord, "recordedAt">
): ProposalTransactionRecords {
  const current = loadProposalTransactions();
  const next = {
    ...current,
    [proposal]: {
      ...record,
      recordedAt: new Date().toISOString(),
    },
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
