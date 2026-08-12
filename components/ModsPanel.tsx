"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadDefs } from "@/lib/manifest-client";
import {
  ARMOR_SLOT_ORDER,
  ARMOR_STAT_HASHES,
  BUNGIE_ROOT,
  CLASS_NAMES,
  SOCKET_CATEGORY_ARMOR_MODS,
  SOCKET_CATEGORY_WEAPON_MODS,
  TIER_EXOTIC,
  WEAPON_SLOT_ORDER,
  WEAPON_STAT_HASHES,
} from "@/lib/destiny-constants";
import {
  buildModSockets,
  suggestMods,
  verifyPlugs,
  type ModSuggestion,
} from "@/lib/mod-engine";
import { insertPlug, sleep } from "@/lib/d2-actions";
import type { Character, Defs, ProfileResponse } from "@/lib/types";

type Phase = "loading" | "ready" | "unauth" | "error";
type Tab = "weapons" | "armor";

interface GearItem {
  bucketHash: number;
  instanceId: string;
  itemHash: number;
  name: string;
  icon?: string;
  isExotic: boolean;
  energyCapacity: number;
}

interface Plan {
  item: GearItem;
  suggestions: ModSuggestion[];
  totalGain: number;
}

export default function ModsPanel() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [statusMsg, setStatusMsg] = useState("Chargement…");
  const [error, setError] = useState("");
  const [defs, setDefs] = useState<Defs | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [selectedChar, setSelectedChar] = useState("");
  const [tab, setTab] = useState<Tab>("weapons");
  const [weaponStat, setWeaponStat] = useState<number>(WEAPON_STAT_HASHES[3]);
  const [armorStat, setArmorStat] = useState<number>(ARMOR_STAT_HASHES[1]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  function pushLog(m: string) {
    setLog((prev) => [...prev.slice(-30), m]);
  }

  const fetchProfile = useCallback(async (): Promise<ProfileResponse | null> => {
    const res = await fetch("/api/bungie/profile?scope=mods");
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
    let cancelled = false;
    (async () => {
      try {
        const d = await loadDefs((msg) => !cancelled && setStatusMsg(msg));
        if (cancelled) return;
        setDefs(d);
        setStatusMsg("Lecture des mods disponibles…");
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

  const buckets = tab === "weapons" ? WEAPON_SLOT_ORDER : ARMOR_SLOT_ORDER;
  const targetStat = tab === "weapons" ? weaponStat : armorStat;
  const relevantStats =
    tab === "weapons" ? WEAPON_STAT_HASHES : ARMOR_STAT_HASHES;
  const categoryHash =
    tab === "weapons" ? SOCKET_CATEGORY_WEAPON_MODS : SOCKET_CATEGORY_ARMOR_MODS;

  const gear: GearItem[] = useMemo(() => {
    if (!defs || !profile || !selectedChar) return [];
    const items = profile.characterEquipment?.data?.[selectedChar]?.items ?? [];
    const instances = profile.itemComponents?.instances?.data ?? {};
    const out: GearItem[] = [];
    for (const b of buckets) {
      const item = items.find((i) => i.bucketHash === b);
      if (!item?.itemInstanceId) continue;
      const def = defs.items[item.itemHash];
      if (!def) continue;
      out.push({
        bucketHash: b,
        instanceId: item.itemInstanceId,
        itemHash: item.itemHash,
        name: def.displayProperties?.name ?? "Objet",
        icon: def.displayProperties?.icon,
        isExotic: def.inventory?.tierType === TIER_EXOTIC,
        energyCapacity:
          instances[item.itemInstanceId]?.energy?.energyCapacity ?? 0,
      });
    }
    return out;
  }, [defs, profile, selectedChar, buckets]);

  const plans: Plan[] = useMemo(() => {
    if (!defs || !profile) return [];
    return gear.map((item) => {
      const sockets = buildModSockets({
        defs,
        data: profile,
        instanceId: item.instanceId,
        itemHash: item.itemHash,
        categoryHash,
        targetStat,
        relevantStats,
      });
      const suggestions = suggestMods({
        sockets,
        energyCapacity: tab === "armor" ? item.energyCapacity : 0,
      });
      return {
        item,
        suggestions,
        totalGain: suggestions.reduce((a, s) => a + s.gain, 0),
      };
    });
  }, [defs, profile, gear, categoryHash, targetStat, relevantStats, tab]);

  const grandTotal = plans.reduce((a, p) => a + p.totalGain, 0);

  const statName = (hash: number) =>
    defs?.stats?.[hash]?.displayProperties?.name ?? `Stat ${hash}`;

  /** Pose les mods d'une pièce, puis vérifie qu'ils ont réellement tenu. */
  async function applyPlanCore(plan: Plan) {
    const posed: ModSuggestion[] = [];
    for (const s of plan.suggestions) {
      let done = false;
      for (let attempt = 0; attempt < 2 && !done; attempt++) {
        try {
          await insertPlug({
            itemId: plan.item.instanceId,
            characterId: selectedChar,
            socketIndex: s.socketIndex,
            plugItemHash: s.plugHash,
          });
          done = true;
        } catch (e) {
          const msg = e instanceof Error ? e.message : "refusé";
          // « Refresh the item and try again » : l'objet vient de bouger,
          // on laisse Bungie se synchroniser avant de réessayer.
          if (attempt === 0) await sleep(900);
          else pushLog(`⚠️ ${plan.item.name} · ${s.name} : ${msg}`);
        }
      }
      if (done) {
        posed.push(s);
        await sleep(500);
      }
    }
    return posed;
  }

  async function applyPlan(plan: Plan) {
    if (busy || plan.suggestions.length === 0) return;
    setBusy(true);
    try {
      const posed = await applyPlanCore(plan);
      await sleep(1200);
      const fresh = await fetchProfile();
      if (fresh && posed.length > 0) {
        const { ok, missing } = verifyPlugs(
          fresh,
          plan.item.instanceId,
          posed
        );
        pushLog(
          `${missing.length === 0 ? "✅" : "⚠️"} ${plan.item.name} : ${ok}/${posed.length} mods confirmés en jeu` +
            (missing.length > 0 ? ` — non posés : ${missing.join(", ")}` : "")
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function applyAll() {
    if (busy) return;
    setBusy(true);
    setLog([]);
    pushLog(
      `▶️ Application des mods ${tab === "weapons" ? "d'armes" : "d'armure"} — objectif ${statName(targetStat)}…`
    );
    try {
      const posedByItem: { plan: Plan; posed: ModSuggestion[] }[] = [];
      for (const plan of plans) {
        if (plan.suggestions.length === 0) continue;
        const posed = await applyPlanCore(plan);
        posedByItem.push({ plan, posed });
      }

      // Vérification : seul le profil relu fait foi
      await sleep(1200);
      const fresh = await fetchProfile();
      let totalOk = 0;
      let totalExpected = 0;
      if (fresh) {
        for (const { plan, posed } of posedByItem) {
          const { ok, missing } = verifyPlugs(
            fresh,
            plan.item.instanceId,
            posed
          );
          totalOk += ok;
          totalExpected += posed.length;
          if (missing.length > 0) {
            pushLog(
              `⚠️ ${plan.item.name} : ${missing.join(", ")} non posé(s) en jeu.`
            );
          }
        }
      }
      pushLog(
        totalOk === totalExpected
          ? `✅ Terminé — ${totalOk} mods confirmés en jeu.`
          : `⚠️ ${totalOk}/${totalExpected} mods confirmés en jeu.`
      );
    } finally {
      setBusy(false);
    }
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
        <p className="opacity-70">Connecte-toi pour optimiser tes mods.</p>
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2.5 flex-wrap">
        {characters.map((c) => (
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
            </div>
            <div className="char-light">✦ {c.light}</div>
          </button>
        ))}
      </div>

      <div role="tablist" className="tabs tabs-boxed w-fit">
        <a
          role="tab"
          className={`tab${tab === "weapons" ? " tab-active" : ""}`}
          onClick={() => setTab("weapons")}
        >
          🔫 Mods d&apos;armes
        </a>
        <a
          role="tab"
          className={`tab${tab === "armor" ? " tab-active" : ""}`}
          onClick={() => setTab("armor")}
        >
          🛡️ Mods d&apos;armure
        </a>
      </div>

      <div className="card bg-base-200 shadow">
        <div className="card-body p-4 flex-row flex-wrap items-center gap-3">
          <span className="text-sm opacity-70">Stat à maximiser :</span>
          <select
            className="select select-bordered select-sm"
            value={targetStat}
            onChange={(e) =>
              tab === "weapons"
                ? setWeaponStat(Number(e.target.value))
                : setArmorStat(Number(e.target.value))
            }
          >
            {relevantStats.map((h) => (
              <option key={h} value={h}>
                {statName(h)}
              </option>
            ))}
          </select>
          <span className="badge badge-primary badge-outline">
            gain total +{grandTotal}
          </span>
          <button
            className="btn btn-primary btn-sm ml-auto"
            disabled={busy || grandTotal === 0}
            onClick={applyAll}
          >
            {busy ? "Application…" : "Tout appliquer"}
          </button>
        </div>
      </div>

      {log.length > 0 && (
        <div className="action-log">
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      {plans.length === 0 ? (
        <div className="opacity-60 py-8 text-center">
          Rien d&apos;équipé dans ces emplacements.
        </div>
      ) : (
        plans.map((plan) => (
          <div className="card bg-base-200 shadow" key={plan.item.instanceId}>
            <div className="card-body p-4 gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                {plan.item.icon && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className={`item-icon${plan.item.isExotic ? " exotic" : ""}`}
                    src={`${BUNGIE_ROOT}${plan.item.icon}`}
                    alt=""
                  />
                )}
                <div className="min-w-0">
                  <div className="font-medium">{plan.item.name}</div>
                  <div className="text-xs opacity-50">
                    {tab === "weapons"
                      ? "Arme"
                      : `Énergie ${plan.item.energyCapacity}`}
                  </div>
                </div>
                <span
                  className={`badge badge-sm ${
                    plan.totalGain > 0 ? "badge-primary" : "badge-ghost"
                  }`}
                >
                  {plan.totalGain > 0
                    ? `+${plan.totalGain} ${statName(targetStat)}`
                    : "déjà optimal"}
                </span>
                {plan.suggestions.length > 0 && (
                  <button
                    className="btn btn-xs btn-outline btn-primary ml-auto"
                    disabled={busy}
                    onClick={() => applyPlan(plan)}
                  >
                    Appliquer
                  </button>
                )}
              </div>

              {plan.suggestions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {plan.suggestions.map((s) => (
                    <div
                      key={s.socketIndex}
                      className="flex items-center gap-2 bg-base-300 rounded-box px-2 py-1.5"
                    >
                      {s.icon && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`${BUNGIE_ROOT}${s.icon}`}
                          alt=""
                          className="w-8 h-8 rounded"
                        />
                      )}
                      <div className="text-xs">
                        <div className="font-medium">{s.name}</div>
                        <div className="opacity-50">
                          +{s.gain}
                          {s.energyCost > 0 && ` · ${s.energyCost} énergie`}
                          {s.replaces && ` · remplace ${s.replaces}`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))
      )}

      <p className="text-xs opacity-50">
        Un même mod ne peut occuper qu&apos;un emplacement par pièce (le jeu le
        déplace au lieu de le dupliquer) : les emplacements suivants reçoivent
        donc le meilleur mod <em>différent</em>. Chaque pose est vérifiée après
        coup sur ton profil, et le journal ne dit « confirmé » que si le mod y
        est vraiment. Seuls les mods que tu as débloqués et réellement posables sont proposés
        (Bungie les renvoie emplacement par emplacement). Pour l&apos;armure, le
        budget d&apos;énergie de chaque pièce est respecté ; un mod refusé est
        signalé dans le journal.
      </p>
    </div>
  );
}
