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
        className="brackets mx-auto flex h-14 w-full max-w-5xl min-w-0 items-center justify-between gap-3 px-4"
        style={{ backdropFilter: "blur(12px)" }}
      >
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="truncate font-display font-semibold tracking-wide text-text">
            Tandem Wallet
          </span>
          <span className="text-[0.65rem] uppercase tracking-[0.18em] text-accent-2 font-display">
            {NETWORK}
          </span>
        </div>
        <div className="site-wallet-button max-w-[11rem] shrink-0 sm:max-w-[14rem]">
          <WalletMultiButton />
        </div>
      </div>
    </header>
  );
}
