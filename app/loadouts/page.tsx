"use client";

import { useEffect, useMemo, useState } from "react";
import { loadDefs } from "@/lib/manifest-client";
import { BUNGIE_ROOT, CLASS_NAMES } from "@/lib/destiny-constants";
import {
  buildLocationMap,
  equipItems,
  insertPlug,
  loadoutAction,
  moveToCharacter,
  sleep,
} from "@/lib/d2-actions";
import {
  captureEquippedLoadout,
  loadLoadouts,
  persistLoadouts,
  type Loadout,
} from "@/lib/loadouts";
import type {
  Character,
  Defs,
  InGameLoadout,
  ProfileResponse,
} from "@/lib/types";

type Phase = "loading" | "ready" | "unauth" | "error";

function slotIsUsed(l: InGameLoadout | undefined): boolean {
  return Boolean(
    l?.items?.some((i) => i.itemInstanceId && i.itemInstanceId !== "0")
  );
}

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
  const [slotIndex, setSlotIndex] = useState(0);
  const [nameHash, setNameHash] = useState<number>(0);
  const [iconHash, setIconHash] = useState<number>(0);
  const [colorHash, setColorHash] = useState<number>(0);

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

  // ---------- Loadouts en jeu ----------
  const inGame: InGameLoadout[] = useMemo(
    () => profile?.characterLoadouts?.data?.[selectedChar]?.loadouts ?? [],
    [profile, selectedChar]
  );

  const nameOptions = useMemo(
    () =>
      Object.values(defs?.loadoutNames ?? {}).sort(
        (a, b) => (a.index ?? 0) - (b.index ?? 0)
      ),
    [defs]
  );
  const iconOptions = useMemo(
    () =>
      Object.values(defs?.loadoutIcons ?? {}).sort(
        (a, b) => (a.index ?? 0) - (b.index ?? 0)
      ),
    [defs]
  );
  const colorOptions = useMemo(
    () =>
      Object.values(defs?.loadoutColors ?? {}).sort(
        (a, b) => (a.index ?? 0) - (b.index ?? 0)
      ),
    [defs]
  );

  // Identité par défaut : premières entrées du manifest
  useEffect(() => {
    if (nameHash === 0 && nameOptions.length > 0) setNameHash(nameOptions[0].hash);
    if (iconHash === 0 && iconOptions.length > 0) setIconHash(iconOptions[0].hash);
    if (colorHash === 0 && colorOptions.length > 0)
      setColorHash(colorOptions[0].hash);
  }, [nameOptions, iconOptions, colorOptions, nameHash, iconHash, colorHash]);

  // Slot par défaut : premier libre du personnage sélectionné
  useEffect(() => {
    if (inGame.length === 0) return;
    const firstFree = inGame.findIndex((l) => !slotIsUsed(l));
    setSlotIndex(firstFree >= 0 ? firstFree : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChar, inGame.length]);

  // ---------- Loadouts du site ----------
  async function saveCurrent() {
    if (!defs || !currentChar) return;
    setBusy(true);
    try {
      const data = await fetchProfile();
      if (!data) return;
      const loadout = captureEquippedLoadout(
        defs,
        data,
        selectedChar,
        currentChar.classType,
        name.trim() ||
          `${CLASS_NAMES[currentChar.classType]} — ${new Date().toLocaleDateString("fr-FR")}`
      );
      const next = [loadout, ...loadouts];
      setLoadouts(next);
      persistLoadouts(next);
      setName("");
      pushLog(
        `💾 Loadout « ${loadout.name} » enregistré (${loadout.items.length} objets, mods et sous-classe compris).`
      );
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

  /** Cœur de l'application d'un loadout (sans gestion de busy/log). */
  async function applyLoadoutCore(loadout: Loadout): Promise<number> {
    if (!defs) return 0;
    const data = await fetchProfile();
    if (!data) return 0;
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
          pushLog(`⚠️ ${plugName} : ${e instanceof Error ? e.message : "échec"}`);
        }
      }
    }
    pushLog(
      `✅ ${toEquip.length} objets équipés, ${plugCount} plugs restaurés.`
    );
    return toEquip.length;
  }

  async function applyLoadout(loadout: Loadout) {
    if (!defs || !currentChar) return;
    if (loadout.classType !== currentChar.classType) {
      pushLog("⚠️ Ce loadout est pour une autre classe.");
      return;
    }
    setBusy(true);
    setLog([]);
    pushLog(
      `▶️ Application de « ${loadout.name} » sur ${CLASS_NAMES[currentChar.classType]}…`
    );
    try {
      await applyLoadoutCore(loadout);
      await fetchProfile();
    } catch (e) {
      pushLog(`❌ ${e instanceof Error ? e.message : "Erreur"}`);
    } finally {
      setBusy(false);
    }
  }

  // ---------- Actions loadouts en jeu ----------
  async function snapshotCurrent() {
    if (!currentChar || busy) return;
    setBusy(true);
    try {
      pushLog(
        `📸 Snapshot de l'équipement actuel dans le slot ${slotIndex + 1}…`
      );
      await loadoutAction({
        action: "snapshot",
        loadoutIndex: slotIndex,
        characterId: selectedChar,
        nameHash,
        iconHash,
        colorHash,
      });
      pushLog(
        `✅ Slot ${slotIndex + 1} enregistré — visible dans ton menu de personnage en jeu.`
      );
      await fetchProfile();
    } catch (e) {
      pushLog(`❌ Snapshot : ${e instanceof Error ? e.message : "erreur"}`);
    } finally {
      setBusy(false);
    }
  }

  async function pushLoadoutInGame(loadout: Loadout) {
    if (!defs || !currentChar || busy) return;
    if (loadout.classType !== currentChar.classType) {
      pushLog("⚠️ Ce loadout est pour une autre classe.");
      return;
    }
    setBusy(true);
    setLog([]);
    pushLog(
      `▶️ « ${loadout.name} » → équipement puis snapshot dans le slot ${slotIndex + 1}…`
    );
    try {
      await applyLoadoutCore(loadout);
      await sleep(400);
      await loadoutAction({
        action: "snapshot",
        loadoutIndex: slotIndex,
        characterId: selectedChar,
        nameHash,
        iconHash,
        colorHash,
      });
      pushLog(
        `📸 Snapshot fait — le loadout est dans le slot ${slotIndex + 1} de ton menu en jeu.`
      );
      await fetchProfile();
    } catch (e) {
      pushLog(`❌ ${e instanceof Error ? e.message : "Erreur"}`);
    } finally {
      setBusy(false);
    }
  }

  async function equipInGame(idx: number) {
    if (busy) return;
    setBusy(true);
    try {
      pushLog(`🎽 Équipement du loadout en jeu n°${idx + 1}…`);
      await loadoutAction({
        action: "equip",
        loadoutIndex: idx,
        characterId: selectedChar,
      });
      pushLog(`✅ Loadout n°${idx + 1} équipé.`);
      await fetchProfile();
    } catch (e) {
      pushLog(`❌ ${e instanceof Error ? e.message : "erreur"}`);
    } finally {
      setBusy(false);
    }
  }

  async function clearInGame(idx: number) {
    if (busy) return;
    setBusy(true);
    try {
      await loadoutAction({
        action: "clear",
        loadoutIndex: idx,
        characterId: selectedChar,
      });
      pushLog(`🗑️ Slot ${idx + 1} vidé.`);
      await fetchProfile();
    } catch (e) {
      pushLog(`❌ ${e instanceof Error ? e.message : "erreur"}`);
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
        <p className="opacity-70">Connecte-toi pour gérer tes loadouts.</p>
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
      <h1 className="text-2xl font-semibold">Loadouts</h1>
      <p className="text-sm opacity-70 max-w-2xl">
        Enregistre un personnage complet — armes, armures, mods, sous-classe —
        réapplique-le en un clic, et pousse-le dans les{" "}
        <strong>loadouts en jeu</strong> pour le retrouver directement dans ton
        menu de personnage.
      </p>

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

      {log.length > 0 && (
        <div className="action-log">
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      {/* ── Loadouts en jeu ── */}
      <div className="card bg-base-200 shadow">
        <div className="card-body p-5 gap-4">
          <h2 className="card-title text-base">
            Loadouts en jeu — {CLASS_NAMES[currentChar?.classType ?? 0]}
          </h2>

          {inGame.length === 0 ? (
            <div className="text-sm opacity-60">
              Aucun slot de loadout renvoyé par Bungie pour ce personnage.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {inGame.map((l, idx) => {
                const used = slotIsUsed(l);
                const icon = defs?.loadoutIcons?.[l.iconHash]?.iconImagePath;
                const color = defs?.loadoutColors?.[l.colorHash]?.colorImagePath;
                const slotName = defs?.loadoutNames?.[l.nameHash]?.name;
                return (
                  <div
                    key={idx}
                    className={`rounded-box border p-2 flex flex-col items-center gap-1.5 cursor-pointer transition-colors ${
                      slotIndex === idx
                        ? "border-primary ring-1 ring-primary"
                        : "border-base-300"
                    } ${used ? "bg-base-300" : "border-dashed opacity-70"}`}
                    onClick={() => setSlotIndex(idx)}
                    title={`Slot ${idx + 1}${used ? "" : " (vide)"} — cliquer pour le cibler`}
                  >
                    <div className="relative w-12 h-12">
                      {used && color ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          className="absolute inset-0 w-12 h-12 rounded"
                          src={`${BUNGIE_ROOT}${color}`}
                          alt=""
                        />
                      ) : (
                        <div className="absolute inset-0 rounded bg-base-100" />
                      )}
                      {used && icon && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          className="absolute inset-0 m-auto w-8 h-8"
                          src={`${BUNGIE_ROOT}${icon}`}
                          alt=""
                        />
                      )}
                    </div>
                    <div className="text-xs text-center leading-tight">
                      <span className="opacity-50">#{idx + 1}</span>{" "}
                      {used ? (slotName ?? "Loadout") : "Vide"}
                    </div>
                    {used && (
                      <div className="flex gap-1">
                        <button
                          className="btn btn-xs btn-primary"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            equipInGame(idx);
                          }}
                        >
                          Équiper
                        </button>
                        <button
                          className="btn btn-xs btn-ghost"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            clearInGame(idx);
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="divider my-0" />

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm opacity-70">
                Cible : <strong>slot {slotIndex + 1}</strong>
                {slotIsUsed(inGame[slotIndex]) && (
                  <span className="badge badge-warning badge-xs ml-2">
                    sera écrasé
                  </span>
                )}
              </span>
              <select
                className="select select-bordered select-sm"
                value={nameHash}
                onChange={(e) => setNameHash(Number(e.target.value))}
              >
                {nameOptions.map((n) => (
                  <option key={n.hash} value={n.hash}>
                    {n.name ?? `Nom ${n.hash}`}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-sm btn-primary"
                disabled={busy || !currentChar}
                onClick={snapshotCurrent}
              >
                📸 Snapshot de l&apos;équipement actuel
              </button>
            </div>

            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
              {iconOptions.map((ic) =>
                ic.iconImagePath ? (
                  <button
                    key={ic.hash}
                    className={`p-0.5 rounded ${
                      iconHash === ic.hash
                        ? "ring-2 ring-primary"
                        : "opacity-70 hover:opacity-100"
                    }`}
                    onClick={() => setIconHash(ic.hash)}
                    title="Icône du loadout"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="w-7 h-7"
                      src={`${BUNGIE_ROOT}${ic.iconImagePath}`}
                      alt=""
                    />
                  </button>
                ) : null
              )}
            </div>

            <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
              {colorOptions.map((co) =>
                co.colorImagePath ? (
                  <button
                    key={co.hash}
                    className={`p-0.5 rounded ${
                      colorHash === co.hash
                        ? "ring-2 ring-primary"
                        : "opacity-70 hover:opacity-100"
                    }`}
                    onClick={() => setColorHash(co.hash)}
                    title="Couleur du loadout"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="w-7 h-7 rounded"
                      src={`${BUNGIE_ROOT}${co.colorImagePath}`}
                      alt=""
                    />
                  </button>
                ) : null
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Enregistrer un loadout du site ── */}
      <div className="card bg-base-200 shadow">
        <div className="card-body p-4 flex-row flex-wrap items-center gap-3">
          <input
            className="input input-bordered input-sm flex-1 min-w-64"
            placeholder="Nom du loadout (ex. Raid — Grenade Solaire)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={saveCurrent}
            disabled={busy}
          >
            💾 Enregistrer l&apos;équipement actuel
          </button>
        </div>
      </div>

      {loadouts.length === 0 ? (
        <div className="opacity-60 py-8 text-center">
          Aucun loadout enregistré pour l&apos;instant. Équipe ton personnage
          en jeu, puis clique « Enregistrer ».
        </div>
      ) : (
        loadouts.map((l) => {
          const sameClass = l.classType === currentChar?.classType;
          return (
            <div className="card bg-base-200 shadow" key={l.id}>
              <div className="card-body p-5">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <span className="card-title text-base">
                    {l.name}
                    <span className="badge badge-sm badge-outline badge-primary">
                      {CLASS_NAMES[l.classType]}
                    </span>
                  </span>
                  <span className="text-xs opacity-50">
                    {new Date(l.createdAt).toLocaleDateString("fr-FR")}
                  </span>
                </div>
                <div className="loadout-icons flex gap-1.5 flex-wrap my-2">
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
                <div className="card-actions justify-end">
                  <button
                    className="btn btn-sm btn-outline"
                    disabled={busy || !sameClass}
                    title={
                      sameClass
                        ? `Applique le loadout puis l'enregistre dans le slot en jeu n°${slotIndex + 1} (identité choisie ci-dessus)`
                        : "Sélectionne un personnage de la bonne classe"
                    }
                    onClick={() => pushLoadoutInGame(l)}
                  >
                    🎮 → Slot en jeu n°{slotIndex + 1}
                  </button>
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
                    className="btn btn-sm btn-ghost"
                    disabled={busy}
                    onClick={() => removeLoadout(l.id)}
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            </div>
          );
        })
      )}

      <p className="text-xs opacity-50">
        L&apos;équipement échoue dans certaines activités : mets-toi en orbite
        ou dans un espace social. Le snapshot photographie l&apos;équipement
        porté à l&apos;instant T ; les noms de loadouts en jeu viennent de la
        liste fixe du jeu.
      </p>
    </div>
  );
}
