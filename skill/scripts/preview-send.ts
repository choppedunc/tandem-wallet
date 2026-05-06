import { getProgram, getVaultAddress } from "./lib/client";
import { usdcToRaw, formatUsdc } from "./lib/format";

async function main() {
  const amountStr = process.argv[2];
  if (!amountStr) {
    console.error(JSON.stringify({ error: "Usage: preview-send.ts <amount>" }));
    process.exit(1);
  }

  const amount = parseFloat(amountStr);
  const rawAmount = usdcToRaw(amount);
  const program = getProgram();
  const vaultAddress = getVaultAddress();
  const vault = await (program.account as any).vault.fetch(vaultAddress);

  const spendingLimit = Number(vault.spendingLimit);
  const rawAmountNum = Number(rawAmount);

  const requiresApproval = rawAmountNum > spendingLimit;

  console.log(JSON.stringify({
    amount: formatUsdc(rawAmount),
    action: requiresApproval
      ? "Creates proposal (needs human approval)"
      : "Execute immediately (autonomous)",
    requiresApproval,
    spendingLimit: formatUsdc(spendingLimit),
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
