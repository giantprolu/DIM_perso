import {
  ARMOR_MOD_CATEGORY_PREFIX,
  SOCKET_CATEGORY_ARMOR_MODS,
  SOCKET_CATEGORY_WEAPON_MODS,
} from "./destiny-constants";
import type { Defs, ProfileResponse, SocketState } from "./types";

/**
 * Moteur de mods.
 *
 * Deux responsabilités :
 *  1. lire ce qui est réellement posable, emplacement par emplacement
 *     (composant 310 « ItemReusablePlugs », puis les plug sets débloqués) ;
 *  2. choisir la MEILLEURE COMBINAISON de mods pour l'objet entier, et non
 *     le meilleur mod emplacement par emplacement. Les deux diffèrent dès
 *     qu'il y a une contrainte partagée : le budget d'énergie de l'armure et
 *     l'unicité d'un mod sur une même pièce (le jeu le déplace au lieu de le
 *     dupliquer). Un choix glouton emplacement par emplacement épuise
 *     l'énergie sur le premier et laisse les suivants vides.
 */

export interface StatEffect {
  statHash: number;
  value: number;
}

export interface PlugOption {
  hash: number;
  name: string;
  icon?: string;
  description?: string;
  /** Coût en énergie (armure uniquement, 0 pour les armes) */
  energyCost: number;
  /** Effets du mod sur les stats jugées pertinentes */
  effects: StatEffect[];
  canInsert: boolean;
}

export interface ModSocket {
  socketIndex: number;
  /** Mod actuellement posé */
  currentPlugHash?: number;
  currentName?: string;
  currentIcon?: string;
  currentCost: number;
  currentEffects: StatEffect[];
  /** Emplacement vide en jeu (aucun mod réel posé) */
  isEmpty: boolean;
  options: PlugOption[];
}

/** Tout ce qu'il faut pour raisonner sur les mods d'un objet précis. */
export interface ItemModContext {
  instanceId: string;
  itemHash: number;
  isWeapon: boolean;
  sockets: ModSocket[];
  /** Capacité d'énergie de la pièce (0 = pas de contrainte, cas des armes) */
  energyCapacity: number;
  /**
   * Énergie consommée par des emplacements de mods que l'on ne pilote pas
   * (illisibles ou sans alternative) : elle reste due, on la retire du budget.
   */
  reservedEnergy: number;
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

/**
 * L'API Bungie n'autorise l'insertion que d'un sous-ensemble de plugs.
 * Sont notamment REFUSÉS (« You cannot perform that change through
 * Bungie.net at this time ») :
 *  - les paliers de chef-d'œuvre (masterworks),
 *  - les perks issus du roll d'une arme : canons, chargeurs, traits,
 *    origines, intrinsèques… Ils se changent en jeu, pas ici.
 * Restent modifiables : les vrais mods d'arme (v400.weapon.mod_*) et les
 * mods d'armure (enhancements.*).
 */
function isInsertablePlug(
  defs: Defs,
  plugHash: number,
  isWeapon: boolean
): boolean {
  const category = defs.items[plugHash]?.plug?.plugCategoryIdentifier ?? "";
  if (!category) return false;
  if (category.includes("masterwork")) return false;
  if (isWeapon) return category.includes("weapon.mod");
  return category.startsWith(ARMOR_MOD_CATEGORY_PREFIX);
}

export function isEmptyPlug(defs: Defs, plugHash: number): boolean {
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

function plugEffects(
  defs: Defs,
  plugHash: number,
  relevantStats: number[]
): StatEffect[] {
  return (defs.items[plugHash]?.investmentStats ?? [])
    .filter(
      (s) => relevantStats.includes(s.statTypeHash) && !s.isConditionallyActive
    )
    .map((s) => ({ statHash: s.statTypeHash, value: s.value }));
}

/**
 * Plugs réellement disponibles pour un emplacement.
 *
 * Trois sources, par ordre de fiabilité :
 *  1. le composant 310, propre à l'instance (surtout les armes) ;
 *  2. les plug sets du personnage puis du compte — c'est là que vivent les
 *     mods d'ARMURE, débloqués une fois pour toutes et donc absents du 310 ;
 *  3. à défaut, le manifest (qui ignore ce que tu as débloqué).
 */
function availablePlugs(
  defs: Defs,
  data: ProfileResponse,
  instanceId: string,
  itemHash: number,
  socketIndex: number,
  characterId?: string
): { hash: number; canInsert: boolean }[] {
  const fromInstance =
    data.itemComponents?.reusablePlugs?.data?.[instanceId]?.plugs?.[
      String(socketIndex)
    ];
  if (fromInstance && fromInstance.length > 0) {
    return fromInstance.map((p) => ({
      hash: p.plugItemHash,
      canInsert: p.canInsert !== false && p.enabled !== false,
    }));
  }

  const entry = defs.items[itemHash]?.sockets?.socketEntries?.[socketIndex];
  const setHash = entry?.reusablePlugSetHash ?? entry?.randomizedPlugSetHash;
  if (!setHash) return [];

  const fromCharacter = characterId
    ? data.characterPlugSets?.data?.[characterId]?.plugs?.[String(setHash)]
    : undefined;
  const fromProfile = data.profilePlugSets?.data?.plugs?.[String(setHash)];
  const unlocked = fromCharacter ?? fromProfile;
  if (unlocked && unlocked.length > 0) {
    return unlocked.map((p) => ({
      hash: p.plugItemHash,
      canInsert: p.canInsert !== false && p.enabled !== false,
    }));
  }

  // Dernier recours : le catalogue du manifest
  return (defs.plugSets?.[setHash]?.reusablePlugItems ?? []).map((i) => ({
    hash: i.plugItemHash,
    canInsert: true,
  }));
}

/** Options réellement disponibles pour un emplacement donné. */
function optionsFor(
  defs: Defs,
  data: ProfileResponse,
  instanceId: string,
  itemHash: number,
  socketIndex: number,
  relevantStats: number[],
  isWeapon: boolean,
  characterId?: string
): PlugOption[] {
  const hashes = availablePlugs(
    defs,
    data,
    instanceId,
    itemHash,
    socketIndex,
    characterId
  );

  const seen = new Set<number>();
  const options: PlugOption[] = [];
  for (const { hash, canInsert } of hashes) {
    if (seen.has(hash)) continue;
    seen.add(hash);
    const def = defs.items[hash];
    if (!def || isEmptyPlug(defs, hash)) continue;
    // Inutile de proposer ce que Bungie refusera d'insérer
    if (!isInsertablePlug(defs, hash, isWeapon)) continue;
    options.push({
      hash,
      name: def.displayProperties?.name ?? `Mod ${hash}`,
      icon: def.displayProperties?.icon,
      description: def.displayProperties?.description,
      energyCost: plugEnergyCost(defs, hash),
      effects: plugEffects(defs, hash, relevantStats),
      canInsert,
    });
  }
  return options;
}

/** Construit le contexte de mods d'un objet équipé. */
export function buildItemModContext(opts: {
  defs: Defs;
  data: ProfileResponse;
  instanceId: string;
  itemHash: number;
  categoryHash: number;
  relevantStats: number[];
  characterId?: string;
  energyCapacity?: number;
  /** Énergie déclarée consommée par Bungie, tous emplacements confondus */
  energyUsed?: number;
}): ItemModContext {
  const {
    defs,
    data,
    instanceId,
    itemHash,
    categoryHash,
    relevantStats,
    characterId,
    energyCapacity = 0,
    energyUsed,
  } = opts;
  const isWeapon = defs.items[itemHash]?.itemType === 3;
  const states: SocketState[] =
    data.itemComponents?.sockets?.data?.[instanceId]?.sockets ?? [];

  const sockets: ModSocket[] = [];
  let reservedEnergy = 0;

  for (const socketIndex of modSocketIndexes(defs, itemHash, categoryHash)) {
    const state = states[socketIndex];
    const currentPlugHash = state?.plugHash;
    const currentCost = currentPlugHash
      ? plugEnergyCost(defs, currentPlugHash)
      : 0;

    // Emplacement caché en jeu : son coût reste dû, mais on n'y touche pas.
    if (state?.isVisible === false) {
      reservedEnergy += currentCost;
      continue;
    }

    const options = optionsFor(
      defs,
      data,
      instanceId,
      itemHash,
      socketIndex,
      relevantStats,
      isWeapon,
      characterId
    );
    // Un emplacement sans alternative n'est pas pilotable : coût figé.
    if (options.length === 0) {
      reservedEnergy += currentCost;
      continue;
    }

    const currentDef = currentPlugHash ? defs.items[currentPlugHash] : undefined;
    sockets.push({
      socketIndex,
      currentPlugHash,
      currentName: currentDef?.displayProperties?.name,
      currentIcon: currentDef?.displayProperties?.icon,
      currentCost,
      currentEffects: currentPlugHash
        ? plugEffects(defs, currentPlugHash, relevantStats)
        : [],
      isEmpty: !currentPlugHash || isEmptyPlug(defs, currentPlugHash),
      options,
    });
  }

  /*
   * Bungie fait autorité sur l'énergie consommée. Si son total dépasse ce que
   * l'on sait expliquer, la différence vient d'emplacements qu'on ne voit pas
   * — elle reste due. Sans ce recalage, le solveur croit disposer d'un budget
   * qu'il n'a pas et Bungie refuse la pose (ou l'accepte sans rien poser).
   */
  if (energyUsed !== undefined) {
    const drivenCost = sockets.reduce((a, s) => a + s.currentCost, 0);
    reservedEnergy = Math.max(reservedEnergy, energyUsed - drivenCost);
  }

  return {
    instanceId,
    itemHash,
    isWeapon,
    sockets,
    energyCapacity,
    reservedEnergy,
  };
}

// ---------------------------------------------------------------------------
// Recherche de la meilleure combinaison
// ---------------------------------------------------------------------------

/** Poids par stat : statHash → importance (0 = ignorée). */
export type StatWeights = Record<number, number>;

export interface ComboChoice {
  socketIndex: number;
  plugHash: number;
  name: string;
  icon?: string;
  energyCost: number;
  effects: StatEffect[];
  /** Nom du mod remplacé, si la combinaison change cet emplacement */
  replaces?: string;
  /** false quand la combinaison garde le mod déjà en place */
  isChange: boolean;
}

export interface ModCombo {
  /** Le choix retenu pour chaque emplacement pilotable */
  choices: ComboChoice[];
  /** Uniquement ceux à réellement poser */
  changes: ComboChoice[];
  /** Stats de l'objet une fois la combinaison posée */
  totals: Map<number, number>;
  /** Variation par rapport à l'état actuel */
  deltas: Map<number, number>;
  /** Score pondéré de la combinaison */
  score: number;
  /** Gain de score par rapport à l'état actuel */
  scoreGain: number;
  energyUsed: number;
  energyCapacity: number;
}

interface Candidate {
  hash: number;
  name: string;
  icon?: string;
  energyCost: number;
  effects: StatEffect[];
  score: number;
  /** true pour « on garde ce qui est déjà là » */
  keep: boolean;
  /** un plug vide peut occuper plusieurs emplacements, pas un vrai mod */
  unique: boolean;
}

function scoreOf(effects: StatEffect[], weights: StatWeights): number {
  let s = 0;
  for (const e of effects) s += (weights[e.statHash] ?? 0) * e.value;
  return s;
}

/**
 * Réduit les candidats d'un emplacement à sa frontière de Pareto
 * (meilleur score à coût d'énergie donné). Sans cela l'exploration
 * exhaustive serait inutilement large : un mod plus cher ET moins bon
 * qu'un autre ne peut jamais faire partie de l'optimum.
 *
 * `keepPerTier` conserve les ex æquo : deux mods de même valeur ne sont
 * interchangeables que tant qu'aucun n'est déjà pris par un autre
 * emplacement de la même pièce.
 */
function paretoFilter(list: Candidate[], keepPerTier: number): Candidate[] {
  const kept: Candidate[] = [];
  // L'état actuel reste toujours jouable : aucune régression n'est imposée.
  for (const c of list) if (c.keep) kept.push(c);

  const sorted = list
    .filter((c) => !c.keep)
    .sort((a, b) => a.energyCost - b.energyCost || b.score - a.score);

  let bestScore = -Infinity;
  let tierScore = NaN;
  let tierCost = NaN;
  let tierCount = 0;
  for (const c of sorted) {
    if (c.score > bestScore) {
      kept.push(c);
      bestScore = c.score;
      tierScore = c.score;
      tierCost = c.energyCost;
      tierCount = 1;
    } else if (
      c.score === tierScore &&
      c.energyCost === tierCost &&
      tierCount < keepPerTier
    ) {
      kept.push(c);
      tierCount++;
    }
  }
  return kept;
}

function buildCandidates(socket: ModSocket, weights: StatWeights): Candidate[] {
  const list: Candidate[] = [];

  // Garder ce qui est en place : toujours possible, coût déjà payé.
  list.push({
    hash: socket.currentPlugHash ?? 0,
    name: socket.currentName ?? "Emplacement vide",
    icon: socket.currentIcon,
    energyCost: socket.currentCost,
    effects: socket.currentEffects,
    score: scoreOf(socket.currentEffects, weights),
    keep: true,
    unique: !socket.isEmpty && socket.currentPlugHash !== undefined,
  });

  for (const o of socket.options) {
    if (!o.canInsert) continue;
    if (o.hash === socket.currentPlugHash) continue; // déjà couvert par « garder »
    const score = scoreOf(o.effects, weights);
    // Un mod qui pénalise les stats visées ne peut jamais aider ici : la
    // seconde passe se charge des emplacements restés vides.
    if (score < 0) continue;
    list.push({
      hash: o.hash,
      name: o.name,
      icon: o.icon,
      energyCost: o.energyCost,
      effects: o.effects,
      score,
      keep: false,
      unique: true,
    });
  }
  return list;
}

/**
 * Meilleure combinaison de mods pour un objet.
 *
 * Recherche exhaustive avec élagage : les emplacements sont peu nombreux
 * (≤ 6) et chacun est réduit à sa frontière de Pareto, ce qui rend le
 * parcours instantané tout en restant EXACT — contrairement à un choix
 * glouton, qui se trompe dès que le budget d'énergie serre.
 *
 * Contraintes respectées :
 *  - budget d'énergie de la pièce (armure) ;
 *  - un même mod ne peut occuper deux emplacements de la même pièce ;
 *  - aucun emplacement n'est dégradé : garder l'existant est toujours permis.
 */
export function bestModCombo(opts: {
  context: ItemModContext;
  weights: StatWeights;
  /**
   * Combler les emplacements sans intérêt pour les stats visées avec le
   * meilleur mod disponible plutôt que de les laisser vides.
   */
  fillEmpty?: boolean;
}): ModCombo {
  const { context, weights, fillEmpty = true } = opts;
  const { sockets, energyCapacity, reservedEnergy } = context;

  const budget =
    energyCapacity > 0 ? energyCapacity - reservedEnergy : Number.MAX_SAFE_INTEGER;

  const perSocket = sockets.map((s) =>
    paretoFilter(buildCandidates(s, weights), sockets.length)
  );

  // Borne supérieure du score encore atteignable à partir de l'emplacement i,
  // pour couper les branches sans avenir.
  const suffixMax = new Array<number>(perSocket.length + 1).fill(0);
  for (let i = perSocket.length - 1; i >= 0; i--) {
    const best = perSocket[i].reduce((a, c) => Math.max(a, c.score), 0);
    suffixMax[i] = suffixMax[i + 1] + best;
  }

  let bestScore = -Infinity;
  let bestCost = Number.MAX_SAFE_INTEGER;
  let bestPick: Candidate[] = [];
  let found = false;

  const pick: Candidate[] = new Array(perSocket.length);
  const used = new Set<number>();

  const dfs = (i: number, score: number, cost: number) => {
    if (found && score + suffixMax[i] < bestScore) return;
    if (i === perSocket.length) {
      // À score égal, la combinaison la moins gourmande en énergie gagne.
      if (!found || score > bestScore || (score === bestScore && cost < bestCost)) {
        bestScore = score;
        bestCost = cost;
        bestPick = [...pick];
        found = true;
      }
      return;
    }
    for (const c of perSocket[i]) {
      if (cost + c.energyCost > budget) continue;
      if (c.unique && used.has(c.hash)) continue;
      if (c.unique) used.add(c.hash);
      pick[i] = c;
      dfs(i + 1, score + c.score, cost + c.energyCost);
      if (c.unique) used.delete(c.hash);
    }
  };
  dfs(0, 0, 0);

  if (!found) {
    // Aucune combinaison légale (budget saturé) : on garde tout tel quel.
    bestPick = perSocket.map((list) => list.find((c) => c.keep) ?? list[0]);
    bestScore = bestPick.reduce((a, c) => a + (c?.score ?? 0), 0);
    bestCost = bestPick.reduce((a, c) => a + (c?.energyCost ?? 0), 0);
  }

  /*
   * Deuxième passe : les emplacements que l'optimum laisse tels quels alors
   * qu'ils sont VIDES ne coûtent rien à la combinaison. Autant y mettre le
   * meilleur mod encore libre — le jeu autorise un mod par emplacement, pas
   * seulement sur le premier.
   */
  if (fillEmpty) {
    const takenHashes = new Set<number>();
    for (const c of bestPick) if (c?.unique) takenHashes.add(c.hash);
    let cost = bestCost;

    for (let i = 0; i < sockets.length; i++) {
      const socket = sockets[i];
      const chosen = bestPick[i];
      if (!chosen?.keep || !socket.isEmpty) continue;

      let best: PlugOption | null = null;
      let bestFill = 0;
      for (const o of socket.options) {
        if (!o.canInsert || takenHashes.has(o.hash)) continue;
        if (cost - chosen.energyCost + o.energyCost > budget) continue;
        // À défaut de servir les stats visées, on privilégie le mod qui
        // apporte le plus de points de stats, tous domaines confondus.
        const value = o.effects.reduce((a, e) => a + Math.max(0, e.value), 0);
        if (value > bestFill) {
          best = o;
          bestFill = value;
        }
      }
      if (!best) continue;

      cost = cost - chosen.energyCost + best.energyCost;
      takenHashes.add(best.hash);
      bestPick[i] = {
        hash: best.hash,
        name: best.name,
        icon: best.icon,
        energyCost: best.energyCost,
        effects: best.effects,
        score: scoreOf(best.effects, weights),
        keep: false,
        unique: true,
      };
    }
    bestCost = cost;
  }

  const choices: ComboChoice[] = [];
  const totals = new Map<number, number>();
  const deltas = new Map<number, number>();
  let scoreGain = 0;

  for (let i = 0; i < sockets.length; i++) {
    const socket = sockets[i];
    const c = bestPick[i];
    if (!c) continue;

    const isChange = c.hash !== (socket.currentPlugHash ?? 0);
    choices.push({
      socketIndex: socket.socketIndex,
      plugHash: c.hash,
      name: c.name,
      icon: c.icon,
      energyCost: c.energyCost,
      effects: c.effects,
      replaces: isChange && !socket.isEmpty ? socket.currentName : undefined,
      isChange,
    });

    for (const e of c.effects) {
      totals.set(e.statHash, (totals.get(e.statHash) ?? 0) + e.value);
      deltas.set(e.statHash, (deltas.get(e.statHash) ?? 0) + e.value);
    }
    for (const e of socket.currentEffects) {
      deltas.set(e.statHash, (deltas.get(e.statHash) ?? 0) - e.value);
    }
    scoreGain += c.score - scoreOf(socket.currentEffects, weights);
  }

  return {
    choices,
    changes: choices.filter((c) => c.isChange && c.plugHash !== 0),
    totals,
    deltas,
    score: bestScore,
    scoreGain,
    energyUsed: bestCost + reservedEnergy,
    energyCapacity,
  };
}

export const WEAPON_MOD_CATEGORY = SOCKET_CATEGORY_WEAPON_MODS;
export const ARMOR_MOD_CATEGORY = SOCKET_CATEGORY_ARMOR_MODS;

/**
 * Vérifie, emplacements fraîchement relus à l'appui, que les mods attendus
 * sont réellement en place. Filet de sécurité : la confirmation de référence
 * reste l'objet renvoyé par Bungie au moment même de l'insertion.
 */
export function verifySockets(
  sockets: SocketState[],
  expected: { socketIndex: number; plugHash: number; name: string }[]
): { ok: number; missing: string[] } {
  let ok = 0;
  const missing: string[] = [];
  for (const e of expected) {
    if (sockets[e.socketIndex]?.plugHash === e.plugHash) ok++;
    else missing.push(e.name);
  }
  return { ok, missing };
}
