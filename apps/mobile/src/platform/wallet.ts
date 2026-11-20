import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import type { WalletResponse } from "@waypoint/contracts";
import { NetworkError } from "@waypoint/api-client";
import { api } from "./api.ts";

export type WalletState = { wallet: WalletResponse | null; error: "offline" | "failed" | null; reload: () => void };

// GET /v1/wallet each time the screen comes into view, and on reload().
export function useWallet(): WalletState {
  const [wallet, setWallet] = useState<WalletResponse | null>(null);
  const [error, setError] = useState<"offline" | "failed" | null>(null);
  const [version, setVersion] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      api.wallet().then(
        (w) => {
          if (!live) return;
          setWallet(w);
          setError(null);
        },
        (e: unknown) => {
          if (live) setError(e instanceof NetworkError ? "offline" : "failed");
        },
      );
      return () => {
        live = false;
      };
    }, [version]),
  );
  return { wallet, error, reload: () => setVersion((v) => v + 1) };
}
