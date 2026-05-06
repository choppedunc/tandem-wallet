"use client";

import dynamic from "next/dynamic";
import { NETWORK } from "@/lib/network";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

export function Header() {
  return (
    <header className="relative z-20 sticky top-3.5 mt-4">
      <div
        className="brackets mx-auto w-full max-w-5xl px-4 h-14 flex items-center justify-between"
        style={{ backdropFilter: "blur(12px)" }}
      >
        <div className="flex items-baseline gap-3">
          <span className="font-display font-semibold tracking-wide text-text">
            Tandem Wallet
          </span>
          <span className="text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display">
            {NETWORK}
          </span>
        </div>
        <WalletMultiButton />
      </div>
    </header>
  );
}
