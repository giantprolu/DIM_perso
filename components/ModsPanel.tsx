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
  bestModCombo,
  buildItemModContext,
  verifyPlugs,
  type ItemModContext,
  type ModCombo,
  type StatWeights,
} from "@/lib/mod-engine";
import { applyModCombo } from "@/lib/mod-apply";
import { fetchProfileFresh, sleep } from "@/lib/d2-actions";
import type { Character, Defs, ProfileResponse } from "@/lib/types";

type Phase = "loading" | "ready" | "unauth" | "error";
type Tab = "weapons" | "armor";

const WEIGHT_STEPS = [
  { v: 0, label: "Ign" },
  { v: 1, label: "×1" },
  { v: 2, label: "×2" },
  { v: 3, label: "×3" },
];

interface GearItem {
  bucketHash: number;
  instanceId: string;
  itemHash: number;
  name: string;
  icon?: string;
  isExotic: boolean;
  energyCapacity: number;
  energyUsed: number;
}

interface Plan {
  item: GearItem;
  context: ItemModContext;
  combo: ModCombo;
}

/** Poids par défaut : tout compte pareil, on cherche le meilleur total. */
function defaultWeights(stats: number[]): StatWeights {
  return Object.fromEntries(stats.map((h) => [h, 1]));
}

export default function ModsPanel() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [statusMsg, setStatusMsg] = useState("Chargement…");
  const [error, setError] = useState("");
  const [defs, setDefs] = useState<Defs | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [selectedChar, setSelectedChar] = useState("");
  const [tab, setTab] = useState<Tab>("weapons");
  const [weaponWeights, setWeaponWeights] = useState<StatWeights>(() =>
    defaultWeights(WEAPON_STAT_HASHES)
  );
  const [armorWeights, setArmorWeights] = useState<StatWeights>(() =>
    defaultWeights(ARMOR_STAT_HASHES)
  );
  const [fillEmpty, setFillEmpty] = useState(true);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  function pushLog(m: string) {
    setLog((prev) => [...prev.slice(-40), m]);
  }

  const fetchProfile = useCallback(async (): Promise<ProfileResponse | null> => {
    try {
      const data = await fetchProfileFresh("mods");
      setProfile(data);
      return data;
    } catch (e) {
      if (e instanceof Error && /non connecté|401/.test(e.message)) {
        setPhase("unauth");
        return null;
      }
      throw e;
    }
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
  const relevantStats =
    tab === "weapons" ? WEAPON_STAT_HASHES : ARMOR_STAT_HASHES;
  const weights = tab === "weapons" ? weaponWeights : armorWeights;
  const setWeights = tab === "weapons" ? setWeaponWeights : setArmorWeights;
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
        energyUsed: instances[item.itemInstanceId]?.energy?.energyUsed ?? 0,
      });
    }
    return out;
  }, [defs, profile, selectedChar, buckets]);

  const plans: Plan[] = useMemo(() => {
    if (!defs || !profile) return [];
    return gear.map((item) => {
      const context = buildItemModContext({
        defs,
        data: profile,
        instanceId: item.instanceId,
        itemHash: item.itemHash,
        categoryHash,
        relevantStats,
        characterId: selectedChar,
        energyCapacity: tab === "armor" ? item.energyCapacity : 0,
        energyUsed: tab === "armor" ? item.energyUsed : undefined,
      });
      const combo = bestModCombo({ context, weights, fillEmpty });
      return { item, context, combo };
    });
  }, [
    defs,
    profile,
    gear,
    categoryHash,
    relevantStats,
    selectedChar,
    tab,
    weights,
    fillEmpty,
  ]);

  const totalChanges = plans.reduce((a, p) => a + p.combo.changes.length, 0);

  const statName = (hash: number) =>
    defs?.stats?.[hash]?.displayProperties?.name ?? `Stat ${hash}`;

  /** Somme des gains nets, stat par stat, sur tout l'équipement affiché. */
  const grandDeltas = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of plans) {
      for (const [h, v] of p.combo.deltas) m.set(h, (m.get(h) ?? 0) + v);
    }
    return [...m.entries()].filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]);
  }, [plans]);

  async function applyPlans(list: Plan[]) {
    if (busy || !defs) return;
    setBusy(true);
    setLog([]);
    pushLog(
      `▶️ Pose de la meilleure combinaison sur ${list.length} ${
        tab === "weapons" ? "arme(s)" : "pièce(s)"
      }…`
    );
    try {
      let applied = 0;
      let uncertain = 0;
      let failed = 0;
      const toVerify: {
        instanceId: string;
        name: string;
        expected: { socketIndex: number; plugHash: number; name: string }[];
      }[] = [];

      for (const plan of list) {
        if (plan.combo.changes.length === 0) continue;
        const report = await applyModCombo({
          defs,
          instanceId: plan.item.instanceId,
          characterId: selectedChar,
          itemName: plan.item.name,
          changes: plan.combo.changes,
          sockets: plan.context.sockets,
          log: pushLog,
        });
        applied += report.applied;
        uncertain += report.uncertain;
        failed += report.failed;

        const unconfirmed = report.outcomes
          .filter((o) => o.status === "incertain")
          .map((o) => ({
            socketIndex: o.choice.socketIndex,
            plugHash: o.choice.plugHash,
            name: o.choice.name,
          }));
        if (unconfirmed.length > 0) {
          toVerify.push({
            instanceId: plan.item.instanceId,
            name: plan.item.name,
            expected: unconfirmed,
          });
        }
      }

      // Filet de sécurité : uniquement pour ce que Bungie n'a pas confirmé.
      if (toVerify.length > 0) {
        await sleep(1200);
        const fresh = await fetchProfile();
        if (fresh) {
          for (const v of toVerify) {
            const { ok, missing } = verifyPlugs(fresh, v.instanceId, v.expected);
            applied += ok;
            uncertain -= v.expected.length;
            failed += missing.length;
            if (missing.length > 0) {
              pushLog(`⚠️ ${v.name} : ${missing.join(", ")} non posé(s) en jeu.`);
            }
          }
        }
      } else {
        await fetchProfile();
      }

      pushLog(
        failed === 0 && uncertain === 0
          ? `✅ Terminé — ${applied} mod${applied > 1 ? "s" : ""} confirmé${applied > 1 ? "s" : ""} en jeu.`
          : `⚠️ ${applied} posé(s), ${failed} refusé(s)${uncertain > 0 ? `, ${uncertain} non vérifiable(s)` : ""}.`
      );
    } catch (e) {
      pushLog(`❌ ${e instanceof Error ? e.message : "Erreur"}`);
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
        <div className="card-body p-4 gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium">
              Importance de chaque {tab === "weapons" ? "stat d'arme" : "stat d'armure"}
            </span>
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => setWeights(defaultWeights(relevantStats))}
            >
              Réinitialiser
            </button>
            <label className="label cursor-pointer gap-2 py-0">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={fillEmpty}
                onChange={(e) => setFillEmpty(e.target.checked)}
              />
              <span className="label-text text-xs">
                Combler les emplacements restés vides
              </span>
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {relevantStats.map((h) => (
              <div key={h} className="flex items-center gap-2">
                <span className="text-xs flex-1 truncate opacity-80">
                  {statName(h)}
                </span>
                <div className="join">
                  {WEIGHT_STEPS.map((w) => (
                    <button
                      key={w.v}
                      className={`btn btn-xs join-item${
                        (weights[h] ?? 0) === w.v ? " btn-primary" : " btn-ghost"
                      }`}
                      onClick={() => setWeights({ ...weights, [h]: w.v })}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 flex-wrap border-t border-base-300 pt-3">
            {grandDeltas.length === 0 ? (
              <span className="badge badge-ghost">
                déjà optimal pour ces priorités
              </span>
            ) : (
              grandDeltas.map(([h, v]) => (
                <span
                  key={h}
                  className={`badge badge-outline ${v > 0 ? "badge-primary" : "badge-warning"}`}
                >
                  {v > 0 ? "+" : ""}
                  {v} {statName(h)}
                </span>
              ))
            )}
            <button
              className="btn btn-primary btn-sm ml-auto"
              disabled={busy || totalChanges === 0}
              onClick={() => applyPlans(plans)}
            >
              {busy
                ? "Application…"
                : `Appliquer les ${totalChanges} mod${totalChanges > 1 ? "s" : ""}`}
            </button>
          </div>
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
        plans.map((plan) => {
          const deltas = [...plan.combo.deltas.entries()].filter(
            ([, v]) => v !== 0
          );
          return (
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
                        ? `${plan.context.sockets.length} emplacement(s) modifiable(s)`
                        : `Énergie ${plan.combo.energyUsed}/${plan.item.energyCapacity} · ${plan.context.sockets.length} emplacement(s)`}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {deltas.length === 0 ? (
                      <span className="badge badge-sm badge-ghost">
                        {plan.context.sockets.length === 0
                          ? "aucun mod modifiable"
                          : "déjà optimal"}
                      </span>
                    ) : (
                      deltas.map(([h, v]) => (
                        <span
                          key={h}
                          className={`badge badge-sm ${v > 0 ? "badge-primary" : "badge-warning"}`}
                        >
                          {v > 0 ? "+" : ""}
                          {v} {statName(h)}
                        </span>
                      ))
                    )}
                  </div>
                  {plan.combo.changes.length > 0 && (
                    <button
                      className="btn btn-xs btn-outline btn-primary ml-auto"
                      disabled={busy}
                      onClick={() => applyPlans([plan])}
                    >
                      Appliquer
                    </button>
                  )}
                </div>

                {plan.combo.choices.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {plan.combo.choices.map((c) => (
                      <div
                        key={c.socketIndex}
                        className={`flex items-center gap-2 rounded-box px-2 py-1.5 ${
                          c.isChange
                            ? "bg-base-300 ring-1 ring-primary/40"
                            : "bg-base-300/50 opacity-60"
                        }`}
                      >
                        {c.icon && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`${BUNGIE_ROOT}${c.icon}`}
                            alt=""
                            className="w-8 h-8 rounded"
                          />
                        )}
                        <div className="text-xs">
                          <div className="font-medium">{c.name}</div>
                          <div className="opacity-50">
                            {c.effects.length > 0
                              ? c.effects
                                  .map(
                                    (e) =>
                                      `${e.value > 0 ? "+" : ""}${e.value} ${statName(e.statHash)}`
                                  )
                                  .join(" · ")
                              : "sans effet de stat"}
                            {c.energyCost > 0 && ` · ${c.energyCost} én.`}
                            {c.replaces && ` · remplace ${c.replaces}`}
                            {!c.isChange && " · déjà en place"}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}

      <p className="text-xs opacity-50">
        Le plan ci-dessus est la <strong>meilleure combinaison</strong> de mods
        pour l&apos;objet entier, pas le meilleur mod emplacement par
        emplacement : le solveur teste les combinaisons sous les contraintes
        réelles du jeu — budget d&apos;énergie de la pièce, et un même mod qui
        ne peut occuper qu&apos;un emplacement (le jeu le déplace au lieu de le
        dupliquer). Aucun emplacement n&apos;est dégradé : garder le mod en
        place fait toujours partie des options. Sur les armes, seuls les{" "}
        <strong>mods</strong> sont modifiables depuis le web — les perks du roll
        (canon, chargeur, trait) et les paliers de chef-d&apos;œuvre sont
        réservés au jeu. Chaque pose est confirmée par l&apos;objet que Bungie
        renvoie dans la foulée, et le journal ne dit « posé » que sur cette
        confirmation.
      </p>
    </div>
  );
}
