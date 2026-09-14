"use client";

import { useEffect, useState } from "react";
import { BUNGIE_ROOT } from "@/lib/destiny-constants";
import { loadDefs } from "@/lib/manifest-client";
import {
  allCurrencies,
  shortQuantity,
  type CurrencyRow,
} from "@/lib/currencies";
import type { ProfileResponse } from "@/lib/types";

/**
 * Les monnaies du compte, dans la barre du haut.
 *
 * Les quelques devises qu'épingle Bungie restent visibles en permanence ;
 * l'intégralité — matériaux d'échange du coffre et des sacs — se déroule au
 * clic, car il y en a bien trop pour une barre de navigation.
 *
 * La lecture demande le coffre entier : elle est donc différée après le
 * premier rendu, mise en cache le temps d'une poignée de minutes et partagée
 * par toutes les pages, la barre ne se démontant jamais.
 */

/** Devises tenues en tête de barre : au-delà, la barre mange les onglets. */
const INLINE_COUNT = 3;

const TTL_MS = 180_000;

let cache: { at: number; rows: CurrencyRow[] } | null = null;
let inflight: Promise<CurrencyRow[]> | null = null;

async function loadCurrencies(): Promise<CurrencyRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  if (inflight) return inflight;

  inflight = (async () => {
    const [defs, res] = await Promise.all([
      loadDefs(() => {}),
      fetch("/api/bungie/profile?scope=currencies", { cache: "no-store" }),
    ]);
    if (!res.ok) throw new Error(String(res.status));
    const profile = (await res.json()) as ProfileResponse;
    const rows = allCurrencies(defs, profile);
    cache = { at: Date.now(), rows };
    return rows;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

/** Vide le cache : à appeler après une dépense (achat chez un marchand). */
export function forgetCurrencies() {
  cache = null;
}

export default function CurrencyBar({ enabled }: { enabled: boolean }) {
  const [rows, setRows] = useState<CurrencyRow[] | null>(cache?.rows ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadCurrencies()
      .then((r) => !cancelled && setRows(r))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled || failed) return null;

  if (!rows) {
    return (
      <span
        className="loading loading-spinner loading-xs opacity-40"
        aria-label="Lecture des monnaies"
      />
    );
  }
  if (rows.length === 0) return null;

  const inline = rows.slice(0, INLINE_COUNT);

  return (
    <div className="dropdown dropdown-end">
      <div
        tabIndex={0}
        role="button"
        className="btn btn-sm btn-ghost px-2 gap-2 font-normal"
        title="Toutes les monnaies et matériaux"
      >
        {/* Sous la barre repliée, seul le total compte : les icônes passent. */}
        <span className="hidden lg:flex items-center gap-2">
          {inline.map((c) => (
            <span key={c.itemHash} className="flex items-center gap-1">
              {c.icon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`${BUNGIE_ROOT}${c.icon}`}
                  alt=""
                  className="w-4 h-4 rounded-sm"
                />
              )}
              <span className="font-mono text-xs tabular-nums">
                {shortQuantity(c.quantity)}
              </span>
            </span>
          ))}
        </span>
        <span className="text-xs opacity-50 lg:hidden">
          {rows.length} monnaies
        </span>
        <span className="text-[10px] opacity-40">▾</span>
      </div>

      <div
        tabIndex={0}
        className="dropdown-content bg-base-200 rounded-box z-30 mt-1 w-80 p-2 shadow-lg ring-1 ring-base-content/10"
      >
        <div className="text-[11px] uppercase tracking-wider opacity-50 px-2 pb-1">
          Monnaies et matériaux
        </div>
        <div className="max-h-[70vh] overflow-y-auto flex flex-col">
          {rows.map((c) => (
            <div
              key={c.itemHash}
              className={`flex items-center gap-2 px-2 py-1 rounded ${
                c.pinned ? "bg-base-300/50" : ""
              }`}
            >
              {c.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`${BUNGIE_ROOT}${c.icon}`}
                  alt=""
                  className="w-5 h-5 rounded-sm shrink-0"
                />
              ) : (
                <span className="w-5 h-5 shrink-0" />
              )}
              <span className="text-xs flex-1 truncate">{c.name}</span>
              <span className="font-mono text-xs tabular-nums opacity-80">
                {c.quantity.toLocaleString("fr-FR")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
