"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { getProgram } from "@/lib/program";
import { whitelistPda } from "@/lib/pdas";
import { shortAddress } from "@/lib/format";
import type { VaultData } from "./VaultDetail";

type Entry = {
  pda: PublicKey;
  address: PublicKey;
  addedAt: number;
};

export function WhitelistPanel({ vault }: { vault: VaultData }) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [newAddress, setNewAddress] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const program = useMemo(
    () => (wallet ? getProgram(connection, wallet) : null),
    [connection, wallet]
  );

  const refresh = useCallback(async () => {
    if (!program) return;
    setError(null);
    try {
      const accts = await (program.account as any).whitelistEntry.all([
        { memcmp: { offset: 8, bytes: vault.address.toBase58() } },
      ]);
      const list: Entry[] = accts.map((a: any) => ({
        pda: a.publicKey as PublicKey,
        address: a.account.address as PublicKey,
        addedAt: Number(a.account.addedAt.toString()),
      }));
      list.sort((a, b) => b.addedAt - a.addedAt);
      setEntries(list);
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }, [program, vault.address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!program || !wallet) return;
    setError(null);
    setBusy("add");
    try {
      const address = new PublicKey(newAddress.trim());
      const pda = whitelistPda(vault.address, address);
      await (program.methods as any)
        .addWhitelist(address)
        .accounts({
          human: wallet.publicKey,
          vault: vault.address,
          whitelistEntry: pda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      setNewAddress("");
      await refresh();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(entry: Entry) {
    if (!program || !wallet) return;
    setError(null);
    setBusy(entry.pda.toBase58());
    try {
      await (program.methods as any)
        .removeWhitelist()
        .accounts({
          human: wallet.publicKey,
          vault: vault.address,
          whitelistEntry: entry.pda,
        })
        .rpc();
      await refresh();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <section className="brackets p-6">
        <p className="text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display mb-3">
          Add to whitelist
        </p>
        <p className="text-sm text-muted mb-5 max-w-xl">
          Whitelisted recipients have no spending limit — your agent can send
          any amount to them without your approval.
        </p>
        <form onSubmit={add} className="flex gap-2">
          <input
            type="text"
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            placeholder="Recipient public key (base58)"
            className="flex-1 px-3 py-2.5 border border-line-soft bg-[rgba(2,10,12,0.7)] text-text font-display text-sm focus:outline-none focus:border-line"
          />
          <button
            type="submit"
            disabled={busy === "add" || !newAddress.trim()}
            className="brackets-accent px-4 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-[#032b2a] disabled:opacity-50"
          >
            {busy === "add" ? "Adding…" : "Add"}
          </button>
        </form>
      </section>

      {error && (
        <div className="border border-line p-3 text-sm text-accent-2 bg-[rgba(10,186,181,0.06)]">
          {error}
        </div>
      )}

      <section>
        <p className="text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display mb-3">
          Current whitelist
        </p>
        {entries === null ? (
          <div className="text-muted text-sm font-display uppercase tracking-wider">
            Loading…
          </div>
        ) : entries.length === 0 ? (
          <div className="border border-dashed border-line-soft p-10 text-center text-sm text-muted">
            No whitelisted addresses.
          </div>
        ) : (
          <ul className="space-y-2">
            {entries.map((e) => (
              <li
                key={e.pda.toBase58()}
                className="border border-line-soft p-3 bg-[rgba(3,17,19,0.7)] flex items-center justify-between"
              >
                <div>
                  <div className="font-display text-sm text-text">
                    {shortAddress(e.address.toBase58(), 8)}
                  </div>
                  <div className="text-xs text-muted">
                    added {new Date(e.addedAt * 1000).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => remove(e)}
                  disabled={busy === e.pda.toBase58()}
                  className="px-3 py-1.5 text-xs font-display uppercase tracking-wider border border-line-soft text-text hover:border-line disabled:opacity-50"
                >
                  {busy === e.pda.toBase58() ? "…" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
