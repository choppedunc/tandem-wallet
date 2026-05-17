"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { useWallet, type Wallet } from "@solana/wallet-adapter-react";
import {
  WalletIcon,
  WalletModalContext,
} from "@solana/wallet-adapter-react-ui";
import { getWallets } from "@wallet-standard/app";

const stateRank: Record<WalletReadyState, number> = {
  [WalletReadyState.Installed]: 0,
  [WalletReadyState.Loadable]: 1,
  [WalletReadyState.NotDetected]: 2,
  [WalletReadyState.Unsupported]: 3,
};

const preferredOrder = [
  "Jupiter Wallet",
  "Jupiter",
  "Jupiter Mobile",
  "Phantom",
  "Solflare",
  "Backpack",
  "Magic Eden",
  "Coinbase Wallet",
  "MetaMask",
  "OKX Wallet",
];

function getPreferredRank(name: string) {
  const index = preferredOrder.indexOf(name);
  return index === -1 ? preferredOrder.length : index;
}

function announceWalletStandardReady() {
  if (typeof window === "undefined") return;

  const { register } = getWallets();
  window.dispatchEvent(
    new CustomEvent("wallet-standard:app-ready", {
      detail: Object.freeze({ register }),
    })
  );
}

function getWalletStatus(wallet: Wallet) {
  switch (wallet.readyState) {
    case WalletReadyState.Installed:
      return { label: "Detected", className: "is-detected" };
    case WalletReadyState.Loadable:
      return { label: "Open", className: "is-loadable" };
    case WalletReadyState.Unsupported:
      return { label: "Unsupported", className: "is-muted" };
    case WalletReadyState.NotDetected:
    default:
      return { label: "Install", className: "is-install" };
  }
}

function sortWallets(wallets: Wallet[]) {
  return [...wallets].sort((a, b) => {
    const readyDelta = stateRank[a.readyState] - stateRank[b.readyState];
    if (readyDelta !== 0) return readyDelta;

    const preferredDelta =
      getPreferredRank(a.adapter.name) - getPreferredRank(b.adapter.name);
    if (preferredDelta !== 0) return preferredDelta;

    return a.adapter.name.localeCompare(b.adapter.name);
  });
}

function dedupeWallets(wallets: Wallet[]) {
  const seen = new Set<string>();

  return wallets.filter((wallet) => {
    const key = wallet.adapter.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function TandemWalletModal({
  setVisible,
}: {
  setVisible: (open: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { wallets, select } = useWallet();
  const [portal, setPortal] = useState<Element | null>(null);
  const [fadeIn, setFadeIn] = useState(false);

  const listedWallets = useMemo(
    () => sortWallets(dedupeWallets(wallets)),
    [wallets]
  );

  const hideModal = useCallback(() => {
    setFadeIn(false);
    window.setTimeout(() => setVisible(false), 150);
  }, [setVisible]);

  const handleWalletClick = useCallback(
    (event: MouseEvent, wallet: Wallet) => {
      event.preventDefault();

      if (
        wallet.readyState === WalletReadyState.NotDetected ||
        wallet.readyState === WalletReadyState.Unsupported
      ) {
        if (wallet.adapter.url) {
          window.open(wallet.adapter.url, "_blank", "noopener,noreferrer");
          hideModal();
        }
        return;
      }

      select(wallet.adapter.name as WalletName);
      hideModal();
    },
    [hideModal, select]
  );

  const handleRefresh = useCallback((event: MouseEvent) => {
    event.preventDefault();
    announceWalletStandardReady();
  }, []);

  useEffect(() => {
    const timers = [
      window.setTimeout(announceWalletStandardReady, 0),
      window.setTimeout(announceWalletStandardReady, 250),
      window.setTimeout(announceWalletStandardReady, 1000),
    ];

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useLayoutEffect(() => {
    setPortal(document.querySelector("body"));
  }, []);

  useLayoutEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        hideModal();
        return;
      }

      if (event.key !== "Tab") return;

      const node = ref.current;
      if (!node) return;

      const focusableElements = node.querySelectorAll("button");
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (!firstElement || !lastElement) return;

      if (event.shiftKey && document.activeElement === firstElement) {
        lastElement.focus();
        event.preventDefault();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        firstElement.focus();
        event.preventDefault();
      }
    };

    const { overflow } = window.getComputedStyle(document.body);
    window.setTimeout(() => setFadeIn(true), 0);
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown, false);

    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", handleKeyDown, false);
    };
  }, [hideModal]);

  if (!portal) return null;

  return createPortal(
    <div
      aria-labelledby="tandem-wallet-modal-title"
      aria-modal="true"
      className={`wallet-adapter-modal tandem-wallet-modal ${
        fadeIn ? "wallet-adapter-modal-fade-in" : ""
      }`}
      ref={ref}
      role="dialog"
    >
      <div className="wallet-adapter-modal-container">
        <div className="wallet-adapter-modal-wrapper tandem-wallet-modal-wrapper">
          <button
            className="wallet-adapter-modal-button-close"
            onClick={(event) => {
              event.preventDefault();
              hideModal();
            }}
            type="button"
          >
            <svg width="14" height="14">
              <path d="M14 12.461 8.3 6.772l5.234-5.233L12.006 0 6.772 5.234 1.54 0 0 1.539l5.234 5.233L0 12.006l1.539 1.528L6.772 8.3l5.69 5.7L14 12.461z" />
            </svg>
          </button>

          <div className="tandem-wallet-modal-head">
            <p className="eyebrow">Wallet Connection</p>
            <h1
              className="wallet-adapter-modal-title"
              id="tandem-wallet-modal-title"
            >
              Connect a Solana wallet
            </h1>
          </div>

          <div className="tandem-wallet-modal-actions">
            <button
              className="brackets-accent px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-[#032b2a]"
              onClick={handleRefresh}
              type="button"
            >
              Refresh Wallets
            </button>
          </div>

          <ul className="tandem-wallet-list">
            {listedWallets.map((wallet) => {
              const status = getWalletStatus(wallet);

              return (
                <li key={wallet.adapter.name}>
                  <button
                    className="tandem-wallet-option"
                    onClick={(event) => handleWalletClick(event, wallet)}
                    type="button"
                  >
                    <span className="tandem-wallet-icon">
                      <WalletIcon wallet={wallet} />
                    </span>
                    <span className="tandem-wallet-name">
                      {wallet.adapter.name}
                    </span>
                    <span
                      className={`tandem-wallet-state ${status.className}`}
                    >
                      {status.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className="wallet-adapter-modal-overlay" onMouseDown={hideModal} />
    </div>,
    portal
  );
}

export function TandemWalletModalProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <WalletModalContext.Provider value={{ visible, setVisible }}>
      {children}
      {visible ? <TandemWalletModal setVisible={setVisible} /> : null}
    </WalletModalContext.Provider>
  );
}
