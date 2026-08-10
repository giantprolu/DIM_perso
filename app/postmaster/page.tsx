"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadDefs } from "@/lib/manifest-client";
import {
  BUCKET_POSTMASTER,
  BUNGIE_ROOT,
  CLASS_NAMES,
  TIER_EXOTIC,
} from "@/lib/destiny-constants";
import { pullFromPostmaster, sleep } from "@/lib/d2-actions";
import type { Character, Defs, ProfileResponse } from "@/lib/types";

type Phase = "loading" | "ready" | "unauth" | "error";

/** Capacité du maître des postes en jeu : au-delà, les objets les plus anciens sautent. */
const POSTMASTER_CAPACITY = 21;
const AUTO_KEY = "dim-perso-auto-postmaster";

interface PostItem {
  key: string;
  itemHash: number;
  itemInstanceId?: string;
  quantity: number;
  name: string;
  icon?: string;
  typeName: string;
  isExotic: boolean;
  power: number;
}

export default function PostmasterPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [statusMsg, setStatusMsg] = useState("Chargement…");
  const [error, setError] = useState("");
  const [defs, setDefs] = useState<Defs | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [selectedChar, setSelectedChar] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [autoPull, setAutoPull] = useState(false);
  const autoDone = useRef(false);

  function pushLog(m: string) {
    setLog((prev) => [...prev.slice(-40), m]);
  }

  const fetchProfile = useCallback(async (): Promise<ProfileResponse | null> => {
    const res = await fetch("/api/bungie/profile?scope=postmaster");
    if (res.status === 401) {
      setPhase("unauth");
      return null;
    }
    const data = (await res.json()) as ProfileResponse & { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Erreur profil");
    setProfile(data);
    return data;
  }, []);

  useEffect(() => {
    setAutoPull(localStorage.getItem(AUTO_KEY) === "1");
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await loadDefs((msg) => !cancelled && setStatusMsg(msg));
        if (cancelled) return;
        setDefs(d);
        setStatusMsg("Lecture du maître des postes…");
        const data = await fetchProfile();
        if (!data || cancelled) return;
        const chars = Object.values(data.characters?.data ?? {});
        chars.sort(
          (a, b) =>
            new Date(b.dateLastPlayed).getTime() -
            new Date(a.dateLastPlayed).getTime()
        );
        if (chars.length > 0) setSelectedChar(chars[0].characterId);
        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Erreur inconnue");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchProfile]);

  const characters: Character[] = useMemo(() => {
    const chars = Object.values(profile?.characters?.data ?? {});
    return chars.sort(
      (a, b) =>
        new Date(b.dateLastPlayed).getTime() -
        new Date(a.dateLastPlayed).getTime()
    );
  }, [profile]);

  /** Objets au maître des postes, par personnage. */
  const itemsByChar = useMemo(() => {
    const map = new Map<string, PostItem[]>();
    if (!defs || !profile) return map;
    const instances = profile.itemComponents?.instances?.data ?? {};
    for (const [charId, inv] of Object.entries(
      profile.characterInventories?.data ?? {}
    )) {
      const list: PostItem[] = [];
      for (const item of inv.items) {
        if (item.bucketHash !== BUCKET_POSTMASTER) continue;
        const def = defs.items[item.itemHash];
        list.push({
          key: item.itemInstanceId ?? `${item.itemHash}-${list.length}`,
          itemHash: item.itemHash,
          itemInstanceId: item.itemInstanceId,
          quantity: item.quantity ?? 1,
          name: def?.displayProperties?.name ?? `Objet ${item.itemHash}`,
          icon: def?.displayProperties?.icon,
          typeName: def?.itemTypeDisplayName ?? "",
          isExotic: def?.inventory?.tierType === TIER_EXOTIC,
          power: item.itemInstanceId
            ? (instances[item.itemInstanceId]?.primaryStat?.value ?? 0)
            : 0,
        });
      }
      map.set(charId, list);
    }
    return map;
  }, [defs, profile]);

  const items = itemsByChar.get(selectedChar) ?? [];

  const pullOne = useCallback(
    async (charId: string, item: PostItem): Promise<boolean> => {
      try {
        await pullFromPostmaster({
          itemReferenceHash: item.itemHash,
          itemId: item.itemInstanceId,
          characterId: charId,
          stackSize: item.quantity,
        });
        pushLog(
          `📥 ${item.name}${item.quantity > 1 ? ` ×${item.quantity}` : ""} récupéré.`
        );
        return true;
      } catch (e) {
        pushLog(
          `⚠️ ${item.name} : ${
            e instanceof Error ? e.message : "impossible (inventaire plein ?)"
          }`
        );
        return false;
      }
    },
    []
  );

  const pullAllFor = useCallback(
    async (charId: string, list: PostItem[]) => {
      let ok = 0;
      for (const item of list) {
        if (await pullOne(charId, item)) ok++;
        await sleep(250);
      }
      return ok;
    },
    [pullOne]
  );

  async function handlePullAll() {
    if (busy || items.length === 0) return;
    setBusy(true);
    setLog([]);
    pushLog(`▶️ Récupération de ${items.length} objets…`);
    try {
      const ok = await pullAllFor(selectedChar, items);
      pushLog(`✅ ${ok}/${items.length} objets récupérés.`);
      await fetchProfile();
    } finally {
      setBusy(false);
    }
  }

  async function handlePullAllCharacters() {
    if (busy) return;
    setBusy(true);
    setLog([]);
    pushLog("▶️ Récupération sur tous les personnages…");
    try {
      for (const c of characters) {
        const list = itemsByChar.get(c.characterId) ?? [];
        if (list.length === 0) continue;
        pushLog(`— ${CLASS_NAMES[c.classType]} (${list.length} objets)`);
        await pullAllFor(c.characterId, list);
      }
      pushLog("✅ Terminé.");
      await fetchProfile();
    } finally {
      setBusy(false);
    }
  }

  async function handlePullOne(item: PostItem) {
    if (busy) return;
    setBusy(true);
    try {
      await pullOne(selectedChar, item);
      await fetchProfile();
    } finally {
      setBusy(false);
    }
  }

  // Récupération automatique à l'ouverture, si l'option est active
  useEffect(() => {
    if (phase !== "ready" || !autoPull || autoDone.current || busy) return;
    if (!selectedChar) return;
    const list = itemsByChar.get(selectedChar) ?? [];
    if (list.length === 0) return;
    autoDone.current = true;
    (async () => {
      setBusy(true);
      pushLog(`🤖 Récupération automatique de ${list.length} objets…`);
      try {
        const ok = await pullAllFor(selectedChar, list);
        pushLog(`✅ ${ok}/${list.length} objets récupérés.`);
        await fetchProfile();
      } finally {
        setBusy(false);
      }
    })();
  }, [
    phase,
    autoPull,
    selectedChar,
    itemsByChar,
    busy,
    pullAllFor,
    fetchProfile,
  ]);

  function toggleAuto(value: boolean) {
    setAutoPull(value);
    localStorage.setItem(AUTO_KEY, value ? "1" : "0");
  }

  if (phase === "loading") {
    return (
      <div className="flex flex-col items-center gap-4 py-16 opacity-70">
        <span className="loading loading-spinner loading-lg text-primary" />
        <div className="text-sm">{statusMsg}</div>
      </div>
    );
  }
  if (phase === "unauth") {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <p className="opacity-70">
          Connecte-toi pour accéder au maître des postes.
        </p>
        <a className="btn btn-primary" href="/api/auth/login">
          Se connecter avec Bungie.net
        </a>
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div role="alert" className="alert alert-error">
        <span>{error}</span>
      </div>
    );
  }

  const totalAll = characters.reduce(
    (a, c) => a + (itemsByChar.get(c.characterId)?.length ?? 0),
    0
  );
  const nearlyFull = items.length >= POSTMASTER_CAPACITY - 3;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold">Maître des postes</h1>
        <span
          className={`badge ${nearlyFull ? "badge-warning" : "badge-ghost"}`}
        >
          {items.length}/{POSTMASTER_CAPACITY} sur ce personnage
        </span>
      </div>

      <div className="flex gap-2.5 flex-wrap">
        {characters.map((c) => {
          const count = itemsByChar.get(c.characterId)?.length ?? 0;
          return (
            <button
              key={c.characterId}
              className={`char-btn${selectedChar === c.characterId ? " active" : ""}`}
              style={
                c.emblemBackgroundPath
                  ? {
                      backgroundImage: `url(${BUNGIE_ROOT}${c.emblemBackgroundPath})`,
                    }
                  : undefined
              }
              onClick={() => setSelectedChar(c.characterId)}
            >
              <div className="char-class">
                {CLASS_NAMES[c.classType] ?? "Gardien"}
                {count > 0 && (
                  <span className="badge badge-primary badge-xs ml-2 align-middle">
                    {count}
                  </span>
                )}
              </div>
              <div className="char-light">✦ {c.light}</div>
            </button>
          );
        })}
      </div>

      {nearlyFull && (
        <div role="alert" className="alert alert-warning text-sm">
          <span>
            Le maître des postes est presque plein : au-delà de{" "}
            {POSTMASTER_CAPACITY} objets, les plus anciens sont définitivement
            perdus. Récupère-les maintenant.
          </span>
        </div>
      )}

      <div className="card bg-base-200 shadow">
        <div className="card-body p-4 flex-row flex-wrap items-center gap-3">
          <button
            className="btn btn-primary btn-sm"
            disabled={busy || items.length === 0}
            onClick={handlePullAll}
          >
            {busy ? "Récupération…" : "📥 Tout récupérer"}
          </button>
          <button
            className="btn btn-outline btn-sm"
            disabled={busy || totalAll === 0}
            onClick={handlePullAllCharacters}
          >
            Tous les personnages ({totalAll})
          </button>
          <label className="label cursor-pointer justify-start gap-3 py-0 ml-auto">
            <input
              type="checkbox"
              checked={autoPull}
              onChange={(e) => toggleAuto(e.target.checked)}
              className="toggle toggle-primary toggle-sm"
            />
            <span className="label-text text-sm">
              🤖 Récupérer automatiquement à l&apos;ouverture
            </span>
          </label>
        </div>
      </div>

      {log.length > 0 && (
        <div className="action-log">
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <div className="opacity-60 py-10 text-center">
          Rien au maître des postes pour ce personnage. 🎉
        </div>
      ) : (
        <div className="card bg-base-200 shadow">
          <div className="card-body p-2">
            <div className="overflow-x-auto">
              <table className="table table-zebra table-sm">
                <thead>
                  <tr>
                    <th>Objet</th>
                    <th>Type</th>
                    <th className="text-right">Qté</th>
                    <th className="text-right">✦</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.key}>
                      <td>
                        <div className="flex items-center gap-3">
                          {item.icon ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className={`item-icon !w-10 !h-10${
                                item.isExotic ? " exotic" : ""
                              }`}
                              src={`${BUNGIE_ROOT}${item.icon}`}
                              alt=""
                            />
                          ) : (
                            <div className="item-icon !w-10 !h-10" />
                          )}
                          <span className="font-medium">{item.name}</span>
                        </div>
                      </td>
                      <td className="text-xs opacity-60 uppercase">
                        {item.typeName}
                      </td>
                      <td className="text-right font-mono">
                        {item.quantity > 1 ? `×${item.quantity}` : "—"}
                      </td>
                      <td className="text-right font-mono">
                        {item.power > 0 ? item.power : "—"}
                      </td>
                      <td className="text-right">
                        <button
                          className="btn btn-xs btn-outline btn-primary"
                          disabled={busy}
                          onClick={() => handlePullOne(item)}
                        >
                          Récupérer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <p className="text-xs opacity-50">
        La récupération échoue si l&apos;emplacement d&apos;arrivée est plein
        (armes, armures, matériaux ont chacun leur limite) : l&apos;objet reste
        alors au maître des postes et c&apos;est signalé dans le journal. Fais
        de la place puis relance.
      </p>
    </div>
  );
}
