import {
  ARMOR_MOD_CATEGORY_PREFIX,
  ARMOR_STAT_HASHES,
  SOCKET_CATEGORY_ARMOR_MODS,
  SOCKET_CATEGORY_WEAPON_MODS,
} from "./destiny-constants";
import type { AvailablePlug, Defs, ProfileResponse } from "./types";

/**
 * Moteur de mods.
 *
 * Bungie renvoie, pour chaque objet instancié et chaque emplacement, la liste
 * des mods réellement posables (composant 310 « ItemReusablePlugs »). On
 * s'appuie dessus en priorité ; à défaut on retombe sur le plugSet du
 * manifest, moins fiable car il ignore ce que tu n'as pas débloqué.
 */

export interface PlugOption {
  hash: number;
  name: string;
  icon?: string;
  description?: string;
  /** Coût en énergie (armure uniquement, 0 pour les armes) */
  energyCost: number;
  /** Gain sur la stat ciblée, peut être négatif */
  gain: number;
  /** Tous les effets de stats du mod, pour l'affichage */
  effects: { statHash: number; value: number }[];
  canInsert: boolean;
}

export interface ModSocket {
  socketIndex: number;
  /** Mod actuellement posé */
  currentPlugHash?: number;
  currentName?: string;
  currentIcon?: string;
  currentCost: number;
  options: PlugOption[];
}

/** Emplacements de mods d'un objet, pour la catégorie demandée. */
export function modSocketIndexes(
  defs: Defs,
  itemHash: number,
  categoryHash: number
): number[] {
  const def = defs.items[itemHash];
  return (
    def?.sockets?.socketCategories?.find(
      (c) => c.socketCategoryHash === categoryHash
    )?.socketIndexes ?? []
  );
}

function isEmptyPlug(defs: Defs, plugHash: number): boolean {
  const name = defs.items[plugHash]?.displayProperties?.name ?? "";
  const category = defs.items[plugHash]?.plug?.plugCategoryIdentifier ?? "";
  return (
    name === "" ||
    /emplacement vide|empty (mod )?socket/i.test(name) ||
    category.endsWith("empty") ||
    category.endsWith("_empty")
  );
}

export function plugEnergyCost(defs: Defs, plugHash: number): number {
  return defs.items[plugHash]?.plug?.energyCost?.energyCost ?? 0;
}

function statGain(defs: Defs, plugHash: number, statHash: number): number {
  const stats = defs.items[plugHash]?.investmentStats ?? [];
  return (
    stats.find((s) => s.statTypeHash === statHash && !s.isConditionallyActive)
      ?.value ?? 0
  );
}

/** Options réellement disponibles pour un emplacement donné. */
function optionsFor(
  defs: Defs,
  data: ProfileResponse,
  instanceId: string,
  itemHash: number,
  socketIndex: number,
  targetStat: number,
  relevantStats: number[]
): PlugOption[] {
  const fromApi: AvailablePlug[] | undefined =
    data.itemComponents?.reusablePlugs?.data?.[instanceId]?.plugs?.[
      String(socketIndex)
    ];

  let hashes: { hash: number; canInsert: boolean }[];
  if (fromApi && fromApi.length > 0) {
    hashes = fromApi.map((p) => ({
      hash: p.plugItemHash,
      canInsert: p.canInsert !== false && p.enabled !== false,
    }));
  } else {
    // Repli manifest : plugSet de l'emplacement
    const entry = defs.items[itemHash]?.sockets?.socketEntries?.[socketIndex];
    const setHash = entry?.reusablePlugSetHash ?? entry?.randomizedPlugSetHash;
    const items = setHash ? defs.plugSets?.[setHash]?.reusablePlugItems ?? [] : [];
    hashes = items.map((i) => ({ hash: i.plugItemHash, canInsert: true }));
  }

  const seen = new Set<number>();
  const options: PlugOption[] = [];
  for (const { hash, canInsert } of hashes) {
    if (seen.has(hash)) continue;
    seen.add(hash);
    const def = defs.items[hash];
    if (!def || isEmptyPlug(defs, hash)) continue;
    const effects = (def.investmentStats ?? [])
      .filter(
        (s) => relevantStats.includes(s.statTypeHash) && !s.isConditionallyActive
      )
      .map((s) => ({ statHash: s.statTypeHash, value: s.value }));
    options.push({
      hash,
      name: def.displayProperties?.name ?? `Mod ${hash}`,
      icon: def.displayProperties?.icon,
      description: def.displayProperties?.description,
      energyCost: plugEnergyCost(defs, hash),
      gain: statGain(defs, hash, targetStat),
      effects,
      canInsert,
    });
  }
  options.sort((a, b) => b.gain - a.gain || a.energyCost - b.energyCost);
  return options;
}

/** Construit les emplacements de mods d'un objet équipé. */
export function buildModSockets(opts: {
  defs: Defs;
  data: ProfileResponse;
  instanceId: string;
  itemHash: number;
  categoryHash: number;
  targetStat: number;
  relevantStats: number[];
}): ModSocket[] {
  const { defs, data, instanceId, itemHash, categoryHash, targetStat, relevantStats } =
    opts;
  const states = data.itemComponents?.sockets?.data?.[instanceId]?.sockets ?? [];
  const result: ModSocket[] = [];

  for (const socketIndex of modSocketIndexes(defs, itemHash, categoryHash)) {
    const state = states[socketIndex];
    if (state?.isVisible === false) continue;
    const options = optionsFor(
      defs,
      data,
      instanceId,
      itemHash,
      socketIndex,
      targetStat,
      relevantStats
    );
    // Un emplacement sans alternative n'a pas d'intérêt ici
    if (options.length === 0) continue;
    const currentPlugHash = state?.plugHash;
    const currentDef = currentPlugHash ? defs.items[currentPlugHash] : undefined;
    result.push({
      socketIndex,
      currentPlugHash,
      currentName: currentDef?.displayProperties?.name,
      currentIcon: currentDef?.displayProperties?.icon,
      currentCost: currentPlugHash ? plugEnergyCost(defs, currentPlugHash) : 0,
      options,
    });
  }
  return result;
}

export interface ModSuggestion {
  socketIndex: number;
  plugHash: number;
  name: string;
  icon?: string;
  gain: number;
  energyCost: number;
  replaces?: string;
}

/**
 * Meilleur mod par emplacement pour la stat visée, sous contrainte
 * d'énergie (armure). Les emplacements déjà optimaux sont ignorés.
 */
export function suggestMods(opts: {
  sockets: ModSocket[];
  /** Capacité d'énergie de la pièce (armure). 0 = pas de contrainte. */
  energyCapacity: number;
}): ModSuggestion[] {
  const { sockets, energyCapacity } = opts;
  const suggestions: ModSuggestion[] = [];

  /*
   * Un même mod ne peut pas occuper deux emplacements de la même pièce :
   * le jeu le DÉPLACE au lieu de le dupliquer. Proposer le meilleur mod
   * partout donnait donc des appels tous acceptés par Bungie, mais un seul
   * mod réellement posé au final. On retient un plug au plus une fois par
   * pièce et on descend dans le classement pour les emplacements suivants.
   */
  const used = new Set<number>();
  for (const s of sockets) {
    if (s.currentPlugHash) used.add(s.currentPlugHash);
  }

  // Énergie réellement consommée aujourd'hui par les mods en place
  let energyUsed = sockets.reduce((a, s) => a + s.currentCost, 0);

  // Priorité aux emplacements où le gain potentiel est le plus fort
  const ordered = [...sockets].sort((a, b) => {
    const ga = a.options[0]?.gain ?? 0;
    const gb = b.options[0]?.gain ?? 0;
    return gb - ga;
  });

  for (const socket of ordered) {
    const pick = socket.options.find((o) => {
      if (!o.canInsert || o.gain <= 0) return false;
      // Déjà posé ici : rien à faire, mais le plug reste « pris »
      if (o.hash === socket.currentPlugHash) return true;
      if (used.has(o.hash)) return false;
      if (energyCapacity > 0) {
        const next = energyUsed - socket.currentCost + o.energyCost;
        if (next > energyCapacity) return false;
      }
      return true;
    });
    if (!pick) continue;

    if (pick.hash === socket.currentPlugHash) continue; // déjà optimal

    used.add(pick.hash);
    energyUsed = energyUsed - socket.currentCost + pick.energyCost;
    suggestions.push({
      socketIndex: socket.socketIndex,
      plugHash: pick.hash,
      name: pick.name,
      icon: pick.icon,
      gain: pick.gain,
      energyCost: pick.energyCost,
      replaces: socket.currentName,
    });
  }

  return suggestions.sort((a, b) => a.socketIndex - b.socketIndex);
}

export const WEAPON_MOD_CATEGORY = SOCKET_CATEGORY_WEAPON_MODS;
export const ARMOR_MOD_CATEGORY = SOCKET_CATEGORY_ARMOR_MODS;

/** Un plug est-il un mod de stat d'armure (amovible) ? */
export function isArmorStatMod(defs: Defs, plugHash: number): boolean {
  const category = defs.items[plugHash]?.plug?.plugCategoryIdentifier ?? "";
  if (!category.startsWith(ARMOR_MOD_CATEGORY_PREFIX)) return false;
  return (defs.items[plugHash]?.investmentStats ?? []).some(
    (s) => ARMOR_STAT_HASHES.includes(s.statTypeHash) && !s.isConditionallyActive
  );
}


/**
 * Vérifie, profil fraîchement relu à l'appui, que les mods attendus sont
 * réellement en place. Bungie peut accepter un appel (ErrorCode 1) sans que
 * le mod tienne : seule la relecture fait foi.
 */
export function verifyPlugs(
  data: ProfileResponse,
  instanceId: string,
  expected: { socketIndex: number; plugHash: number; name: string }[]
): { ok: number; missing: string[] } {
  const sockets =
    data.itemComponents?.sockets?.data?.[instanceId]?.sockets ?? [];
  let ok = 0;
  const missing: string[] = [];
  for (const e of expected) {
    if (sockets[e.socketIndex]?.plugHash === e.plugHash) ok++;
    else missing.push(e.name);
  }
  return { ok, missing };
}
