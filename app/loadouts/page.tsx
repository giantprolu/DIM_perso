"use client";

import { useEffect, useMemo, useState } from "react";
import { loadDefs } from "@/lib/manifest-client";
import {
  ARMOR_SLOT_ORDER,
  BUCKET_SUBCLASS,
  BUNGIE_ROOT,
  CLASS_NAMES,
  ITEM_TYPE_ARMOR,
  ITEM_TYPE_WEAPON,
  SOCKET_CATEGORY_WEAPON_MODS,
  WEAPON_SLOT_ORDER,
} from "@/lib/destiny-constants";
import {
  buildLocationMap,
  equipItems,
  insertPlug,
  moveToCharacter,
  sleep,
} from "@/lib/d2-actions";
import {
  loadLoadouts,
  persistLoadouts,
  type Loadout,
  type SavedItem,
} from "@/lib/loadouts";
import type { Character, Defs, ProfileResponse } from "@/lib/types";

type Phase = "loading" | "ready" | "unauth" | "error";

const LOADOUT_BUCKETS = new Set<number>([
  ...WEAPON_SLOT_ORDER,
  ...ARMOR_SLOT_ORDER,
  BUCKET_SUBCLASS,
]);

export default function LoadoutsPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [statusMsg, setStatusMsg] = useState("Chargement…");
  const [error, setError] = useState("");
  const [defs, setDefs] = useState<Defs | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [selectedChar, setSelectedChar] = useState("");
  const [loadouts, setLoadouts] = useState<Loadout[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  function pushLog(m: string) {
    setLog((prev) => [...prev.slice(-40), m]);
  }

  async function fetchProfile(): Promise<ProfileResponse | null> {
    const res = await fetch("/api/bungie/profile?scope=gear");
    if (res.status === 401) {
      setPhase("unauth");
      return null;
    }
    const data = (await res.json()) as ProfileResponse & { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Erreur profil");
    setProfile(data);
    return data;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await loadDefs((msg) => !cancelled && setStatusMsg(msg));
        if (cancelled) return;
        setDefs(d);
        setLoadouts(loadLoadouts());
        setStatusMsg("Récupération de ton équipement…");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const characters: Character[] = useMemo(() => {
    const chars = Object.values(profile?.characters?.data ?? {});
    return chars.sort(
      (a, b) =>
        new Date(b.dateLastPlayed).getTime() -
        new Date(a.dateLastPlayed).getTime()
    );
  }, [profile]);

  const currentChar = characters.find((c) => c.characterId === selectedChar);

  /** Plugs à sauvegarder pour un item équipé donné. */
  function capturePlugs(
    d: Defs,
    data: ProfileResponse,
    instanceId: string,
    itemHash: number
  ) {
    const def = d.items[itemHash];
    const states =
      data.itemComponents?.sockets?.data?.[instanceId]?.sockets ?? [];
    const plugs: { socketIndex: number; plugHash: number }[] = [];

    const weaponModIndexes = new Set(
      def?.sockets?.socketCategories?.find(
        (c) => c.socketCategoryHash === SOCKET_CATEGORY_WEAPON_MODS
      )?.socketIndexes ?? []
    );

    for (let i = 0; i < states.length; i++) {
      const plugHash = states[i]?.plugHash;
      if (!plugHash) continue;
      const plugDef = d.items[plugHash];
      const category = plugDef?.plug?.plugCategoryIdentifier ?? "";

      let keep = false;
      if (def?.itemType === ITEM_TYPE_ARMOR) {
        keep = category.startsWith("enhancements.");
      } else if (def?.itemType === ITEM_TYPE_WEAPON) {
        keep = weaponModIndexes.has(i);
      } else if (def?.inventory?.bucketTypeHash === BUCKET_SUBCLASS) {
        keep = true; // aspects, fragments, capacités
      }
      if (keep) plugs.push({ socketIndex: i, plugHash });
    }
    return plugs;
  }

  async function saveCurrent() {
    if (!defs || !currentChar) return;
    setBusy(true);
    try {
      const data = await fetchProfile();
      if (!data) return;
      const equipped =
        data.characterEquipment?.data?.[selectedChar]?.items ?? [];
      const items: SavedItem[] = [];
      for (const item of equipped) {
        if (!item.itemInstanceId) continue;
        if (!LOADOUT_BUCKETS.has(item.bucketHash)) continue;
        items.push({
          itemInstanceId: item.itemInstanceId,
          itemHash: item.itemHash,
          bucketHash: item.bucketHash,
          plugs: capturePlugs(defs, data, item.itemInstanceId, item.itemHash),
        });
      }
      const loadout: Loadout = {
        id: crypto.randomUUID(),
        name:
          name.trim() ||
          `${CLASS_NAMES[currentChar.classType]} — ${new Date().toLocaleDateString("fr-FR")}`,
        classType: currentChar.classType,
        createdAt: new Date().toISOString(),
        items,
      };
      const next = [loadout, ...loadouts];
      setLoadouts(next);
      persistLoadouts(next);
      setName("");
      pushLog(`💾 Loadout « ${loadout.name} » enregistré (${items.length} objets, mods et sous-classe compris).`);
    } catch (e) {
      pushLog(`❌ ${e instanceof Error ? e.message : "Erreur"}`);
    } finally {
      setBusy(false);
    }
  }

  function removeLoadout(id: string) {
    const next = loadouts.filter((l) => l.id !== id);
    setLoadouts(next);
    persistLoadouts(next);
  }

  async function applyLoadout(loadout: Loadout) {
    if (!defs || !currentChar) return;
    if (loadout.classType !== currentChar.classType) {
      pushLog("⚠️ Ce loadout est pour une autre classe.");
      return;
    }
    setBusy(true);
    setLog([]);
    pushLog(`▶️ Application de « ${loadout.name} » sur ${CLASS_NAMES[currentChar.classType]}…`);
    try {
      const data = await fetchProfile();
      if (!data) return;
      const locations = buildLocationMap(data);

      // 1) Rapatrier les objets sur le personnage
      const toEquip: string[] = [];
      for (const item of loadout.items) {
        const def = defs.items[item.itemHash];
        const itemName = def?.displayProperties?.name ?? "Objet";
        const ok = await moveToCharacter({
          instanceId: item.itemInstanceId,
          itemHash: item.itemHash,
          name: itemName,
          targetCharId: selectedChar,
          location: locations.get(item.itemInstanceId),
          log: pushLog,
        });
        if (ok) toEquip.push(item.itemInstanceId);
      }

      // 2) Équiper en une seule fois
      if (toEquip.length > 0) {
        pushLog(`🎽 Équipement de ${toEquip.length} objets…`);
        const res = await equipItems({
          itemIds: toEquip,
          characterId: selectedChar,
        });
        for (const r of res.results) {
          if (r.equipStatus !== 1) {
            const def = defs.items[
              loadout.items.find((i) => i.itemInstanceId === r.itemInstanceId)
                ?.itemHash ?? 0
            ];
            pushLog(
              `⚠️ ${def?.displayProperties?.name ?? r.itemInstanceId} : non équipé (code ${r.equipStatus} — es-tu en orbite ?)`
            );
          }
        }
        await sleep(300);
      }

      // 3) Restaurer les mods / aspects / fragments
      const fresh = await fetchProfile();
      const freshSockets = fresh?.itemComponents?.sockets?.data ?? {};
      let plugCount = 0;
      for (const item of loadout.items) {
        const current = freshSockets[item.itemInstanceId]?.sockets ?? [];
        for (const plug of item.plugs) {
          if (current[plug.socketIndex]?.plugHash === plug.plugHash) continue;
          const plugName =
            defs.items[plug.plugHash]?.displayProperties?.name ?? "mod";
          try {
            await insertPlug({
              itemId: item.itemInstanceId,
              characterId: selectedChar,
              socketIndex: plug.socketIndex,
              plugItemHash: plug.plugHash,
            });
            plugCount++;
            pushLog(`🔧 ${plugName} posé.`);
            await sleep(200);
          } catch (e) {
            pushLog(
              `⚠️ ${plugName} : ${e instanceof Error ? e.message : "échec"}`
            );
          }
        }
      }
      pushLog(`✅ Terminé — ${toEquip.length} objets équipés, ${plugCount} plugs restaurés.`);
      await fetchProfile();
    } catch (e) {
      pushLog(`❌ ${e instanceof Error ? e.message : "Erreur"}`);
    } finally {
      setBusy(false);
    }
  }

  if (phase === "loading") {
    return (
      <div className="status">
        <div className="spinner" />
        <div>{statusMsg}</div>
      </div>
    );
  }

  if (phase === "unauth") {
    return (
      <div className="status">
        <p>Connecte-toi pour gérer tes loadouts.</p>
        <a className="btn btn-primary" href="/api/auth/login">
          Se connecter avec Bungie.net
        </a>
      </div>
    );
  }

  if (phase === "error") {
    return <div className="error-box">{error}</div>;
  }

  return (
    <div>
      <h1>Loadouts</h1>
      <p style={{ color: "var(--text-dim)" }}>
        Enregistre un personnage complet — armes, armures, mods, sous-classe
        (aspects et fragments) — puis réapplique-le en un clic. Les objets
        sont rapatriés depuis le coffre ou les autres personnages
        automatiquement.
      </p>

      <div className="char-row">
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

      <div className="card save-row">
        <input
          className="search-input"
          placeholder="Nom du loadout (ex. Raid — Grenade Solaire)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <button className="btn btn-primary" onClick={saveCurrent} disabled={busy}>
          💾 Enregistrer l&apos;équipement actuel
        </button>
      </div>

      {log.length > 0 && (
        <div className="action-log">
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      {loadouts.length === 0 ? (
        <div className="status">
          Aucun loadout enregistré pour l&apos;instant. Équipe ton personnage
          en jeu, puis clique « Enregistrer ».
        </div>
      ) : (
        loadouts.map((l) => {
          const sameClass = l.classType === currentChar?.classType;
          return (
            <div className="build-card" key={l.id}>
              <div className="build-header">
                <span className="build-rank">
                  {l.name}{" "}
                  <span className="group-count">
                    · {CLASS_NAMES[l.classType]}
                  </span>
                </span>
                <span className="build-total">
                  {new Date(l.createdAt).toLocaleDateString("fr-FR")}
                </span>
              </div>
              <div className="loadout-icons">
                {l.items.map((it) => {
                  const def = defs?.items[it.itemHash];
                  const icon = def?.displayProperties?.icon;
                  return icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={it.itemInstanceId}
                      src={`${BUNGIE_ROOT}${icon}`}
                      alt=""
                      title={def?.displayProperties?.name}
                    />
                  ) : null;
                })}
              </div>
              <div className="item-actions">
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy || !sameClass}
                  title={
                    sameClass
                      ? "Rapatrier, équiper et restaurer les mods"
                      : "Sélectionne un personnage de la bonne classe"
                  }
                  onClick={() => applyLoadout(l)}
                >
                  Appliquer sur {CLASS_NAMES[currentChar?.classType ?? 0]}
                </button>
                <button
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() => removeLoadout(l.id)}
                >
                  Supprimer
                </button>
              </div>
            </div>
          );
        })
      )}

      <p className="note">
        L&apos;équipement échoue dans certaines activités : mets-toi en orbite
        ou dans un espace social. Les objets au maître des postes ou équipés
        sur un autre personnage sont signalés et ignorés.
      </p>
    </div>
  );
}
