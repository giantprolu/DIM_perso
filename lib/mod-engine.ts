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

/**
 * Poids par stat : statHash → coefficient d'importance (0 = stat ignorée).
 *
 * Les coefficients sont RELATIFS : seul leur rapport compte. `{mobilité: 2,
 * résilience: 1}` et `{mobilité: 4, résilience: 2}` demandent la même chose,
 * deux fois plus de mobilité que de résilience.
 */
export type StatWeights = Record<number, number>;

/**
 * Part de priorité de chaque stat : son coefficient ramené à une fraction du
 * total (la somme fait 1). C'est la lecture utile d'un jeu de coefficients —
 * « ×3 face à trois stats à ×1 » veut dire « la moitié de la priorité » — et
 * c'est aussi ce que le solveur consomme.
 */
export function statShares(weights: StatWeights): Map<number, number> {
  const entries = Object.entries(weights)
    .map(([h, w]) => [Number(h), Math.max(0, w)] as const)
    .filter(([, w]) => w > 0);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  const shares = new Map<number, number>();
  if (total === 0) return shares;
  for (const [h, w] of entries) shares.set(h, w / total);
  return shares;
}

/**
 * Échelle des rendements décroissants, en points de stat.
 *
 * Un score purement linéaire (Σ coefficient × points) rend le coefficient le
 * plus fort ABSORBANT : tant qu'un point de la stat à ×3 vaut plus qu'un point
 * de celle à ×1, le solveur verse tout dans la première et les autres restent
 * à zéro. Le coefficient agit alors en interrupteur, pas en priorité.
 *
 * D'où une utilité CONCAVE : la valeur du n-ième point d'une stat décroît à
 * mesure qu'elle se remplit. La répartition VISE alors le rapport des
 * coefficients au lieu du tout-ou-rien. Elle ne l'atteint pas toujours : les
 * mods réels sont grossiers (+10 ou +5, un seul exemplaire par pièce) et un
 * emplacement rempli vaut mieux qu'un emplacement vide, si bien qu'un ×3
 * contre ×1 penche nettement vers la première stat sans forcément lui donner
 * le triple. Pour exclure une stat, il reste le coefficient 0.
 *
 * L'échelle n'est qu'une unité de mesure : le nombre de points qui « remplit »
 * une stat à qui l'on accorde 100 % de la priorité. Elle est calée sur la
 * valeur d'un mod. L'arbitrage entre stats, lui, ne dépend que du rapport
 * points / part — le changer d'échelle ne le déplace pas.
 */
const DIMINISHING_SCALE = 10;

/** Tolérance de comparaison entre utilités (calculs en virgule flottante). */
const EPS = 1e-9;

/**
 * Exploration bornée par sécurité. En pratique la recherche va jusqu'au bout
 * (le budget d'énergie et la symétrie des emplacements jumeaux coupent
 * l'essentiel des branches) ; ce plafond évite de figer l'interface sur une
 * pièce aux emplacements anormalement nombreux.
 */
const MAX_NODES = 500_000;

/**
 * Utilité d'un jeu de totaux, stat par stat, dans l'ordre des parts.
 * Concave au-dessus de zéro (rendements décroissants), linéaire en dessous :
 * une pénalité se paie plein tarif.
 *
 * Chaque stat est mesurée à l'échelle de SA part : sans cela, une stat peu
 * prioritaire profiterait quand même de rendements pleins sur ses premiers
 * points et se servirait avant l'heure. Ramenée à sa part, la stat qui a déjà
 * reçu son dû devient exactement aussi attirante que les autres — l'optimum
 * se cale alors sur le rapport des coefficients, et il s'y tient à chaque
 * étape (utile : les pièces sont planifiées l'une après l'autre).
 */
function utility(totals: number[], shares: number[]): number {
  let u = 0;
  for (let i = 0; i < shares.length; i++) {
    const t = totals[i] / (shares[i] * DIMINISHING_SCALE);
    u += shares[i] * (t > 0 ? Math.log1p(t) : t);
  }
  return u;
}

/** Apport d'un mod sur chaque stat prioritaire, dans l'ordre des parts. */
function gainsOf(effects: StatEffect[], statHashes: number[]): number[] {
  const gains = new Array<number>(statHashes.length).fill(0);
  for (const e of effects) {
    const i = statHashes.indexOf(e.statHash);
    if (i >= 0) gains[i] += e.value;
  }
  return gains;
}

/**
 * Majorant de l'utilité qu'un mod peut apporter, où qu'il soit posé.
 * La pente de l'utilité ne dépasse jamais `1 / DIMINISHING_SCALE`, quelle que
 * soit la part de la stat et ce qu'elle a déjà reçu : ce majorant reste donc
 * valide partout. Il sert à explorer les mods prometteurs en premier.
 */
function boundOf(gains: number[]): number {
  let b = 0;
  for (const g of gains) if (g > 0) b += g / DIMINISHING_SCALE;
  return b;
}

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
  /** Utilité de la combinaison au regard des coefficients (échelle interne) */
  score: number;
  /** Gain d'utilité par rapport à l'état actuel */
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
  /** Apport sur chaque stat prioritaire, dans l'ordre des parts */
  gains: number[];
  /** Majorant de l'utilité apportée par ce mod */
  bound: number;
  /** true pour « on garde ce qui est déjà là » */
  keep: boolean;
  /** un plug vide peut occuper plusieurs emplacements, pas un vrai mod */
  unique: boolean;
}

/** a vaut b partout, et le dépasse quelque part : b ne sert plus à rien. */
function dominates(a: Candidate, b: Candidate): boolean {
  if (a.energyCost > b.energyCost) return false;
  let strict = a.energyCost < b.energyCost;
  for (let i = 0; i < a.gains.length; i++) {
    if (a.gains[i] < b.gains[i]) return false;
    if (a.gains[i] > b.gains[i]) strict = true;
  }
  return strict;
}

/**
 * Réduit les candidats d'un emplacement à sa frontière de Pareto : un mod plus
 * cher et moins généreux sur CHAQUE stat prioritaire qu'un autre ne peut
 * jamais faire partie de l'optimum. La comparaison porte sur le vecteur de
 * stats, pas sur un score agrégé : avec des rendements décroissants, un mod au
 * total plus faible peut très bien gagner parce qu'il alimente la stat encore
 * en retard.
 *
 * `keepPerTier` conserve les ex æquo : deux mods identiques ne sont
 * interchangeables que tant qu'aucun n'est déjà pris par un autre emplacement
 * de la même pièce.
 */
function paretoFilter(list: Candidate[], keepPerTier: number): Candidate[] {
  const kept: Candidate[] = [];
  // L'état actuel reste toujours jouable : aucune régression n'est imposée.
  for (const c of list) if (c.keep) kept.push(c);

  const sorted = list
    .filter((c) => !c.keep)
    .sort((a, b) => a.energyCost - b.energyCost);

  const tiers = new Map<string, number>();
  for (const c of sorted) {
    if (kept.some((k) => dominates(k, c))) continue;
    const tier = `${c.energyCost}|${c.gains.join(",")}`;
    const seen = tiers.get(tier) ?? 0;
    if (seen >= keepPerTier) continue;
    tiers.set(tier, seen + 1);
    kept.push(c);
  }
  return kept;
}

function buildCandidates(socket: ModSocket, statHashes: number[]): Candidate[] {
  const list: Candidate[] = [];

  // Garder ce qui est en place : toujours possible, coût déjà payé.
  const currentGains = gainsOf(socket.currentEffects, statHashes);
  list.push({
    hash: socket.currentPlugHash ?? 0,
    name: socket.currentName ?? "Emplacement vide",
    icon: socket.currentIcon,
    energyCost: socket.currentCost,
    effects: socket.currentEffects,
    gains: currentGains,
    bound: boundOf(currentGains),
    keep: true,
    unique: !socket.isEmpty && socket.currentPlugHash !== undefined,
  });

  for (const o of socket.options) {
    if (!o.canInsert) continue;
    if (o.hash === socket.currentPlugHash) continue; // déjà couvert par « garder »
    const gains = gainsOf(o.effects, statHashes);
    // Un mod qui n'apporte rien aux stats priorisées ne peut pas aider ici :
    // la seconde passe se charge des emplacements restés vides.
    if (!gains.some((v) => v > 0)) continue;
    list.push({
      hash: o.hash,
      name: o.name,
      icon: o.icon,
      energyCost: o.energyCost,
      effects: o.effects,
      gains,
      bound: boundOf(gains),
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
 * parcours quasi instantané tout en restant EXACT — contrairement à un choix
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
  /**
   * Points déjà acquis sur les pièces DÉJÀ planifiées.
   *
   * Indispensable pour que les coefficients s'expriment : un même mod ne
   * pouvant être posé deux fois sur une pièce, une pièce prise isolément n'a
   * qu'un ou deux emplacements utiles et verse forcément dans la stat la
   * mieux notée. La répartition se joue donc ENTRE les pièces. En repartant
   * du cumul, chaque pièce voit les rendements déjà entamés par les
   * précédentes et sert la stat encore en retard sur son coefficient.
   */
  acquiredStats?: Map<number, number>;
}): ModCombo {
  const { context, weights, fillEmpty = true, acquiredStats } = opts;
  const { sockets, energyCapacity, reservedEnergy } = context;

  const shareMap = statShares(weights);
  const statHashes = [...shareMap.keys()];
  const shares = statHashes.map((h) => shareMap.get(h) ?? 0);
  const acquired = statHashes.map((h) => acquiredStats?.get(h) ?? 0);

  const budget =
    energyCapacity > 0
      ? energyCapacity - reservedEnergy
      : Number.MAX_SAFE_INTEGER;

  const perSocket = sockets.map((s) =>
    paretoFilter(buildCandidates(s, statHashes), sockets.length)
      // Les mods les plus prometteurs d'abord : une bonne solution trouvée
      // tôt donne une borne haute, qui élague tout le reste du parcours.
      .sort((a, b) => b.bound - a.bound)
  );

  /*
   * Gain maximal encore atteignable sur CHAQUE stat à partir de l'emplacement
   * i. Combiné à la pente de l'utilité au point courant, cela majore ce que
   * la fin du parcours peut encore rapporter — et comme cette pente s'écrase
   * à mesure qu'une stat se remplit, la borne se resserre au fil de la
   * descente, là où un simple « meilleur cas absolu » resterait aveugle.
   */
  const suffixGain: number[][] = Array.from(
    { length: perSocket.length + 1 },
    () => new Array<number>(statHashes.length).fill(0)
  );
  for (let i = perSocket.length - 1; i >= 0; i--) {
    for (let j = 0; j < statHashes.length; j++) {
      let best = 0;
      for (const c of perSocket[i]) if (c.gains[j] > best) best = c.gains[j];
      suffixGain[i][j] = suffixGain[i + 1][j] + best;
    }
  }

  /** Majorant de l'utilité encore gagnable depuis l'emplacement i. */
  const remainingBound = (i: number, totals: number[]): number => {
    const row = suffixGain[i];
    let b = 0;
    for (let j = 0; j < row.length; j++) {
      if (row[j] <= 0) continue;
      const t = totals[j] > 0 ? totals[j] : 0;
      // Pente de l'utilité de cette stat à son niveau actuel.
      b += row[j] / (DIMINISHING_SCALE + t / shares[j]);
    }
    return b;
  };

  let bestScore = -Infinity;
  let bestCost = Number.MAX_SAFE_INTEGER;
  let bestPick: Candidate[] = [];
  let found = false;
  let nodes = 0;

  const pick: Candidate[] = new Array(perSocket.length);
  const used = new Set<number>();
  // L'exploration raisonne sur le cumul : les rendements déjà entamés par
  // les pièces précédentes pèsent sur les choix de celle-ci.
  const totals = [...acquired];

  /*
   * Deux emplacements qui offrent exactement les mêmes choix sont
   * interchangeables : poser X sur le premier et Y sur le second revient à
   * l'inverse. On n'explore donc qu'un seul ordre, en n'autorisant le second
   * qu'à partir du choix du premier. Sur une pièce à cinq emplacements
   * jumeaux, cela retire un facteur 120 au parcours — ce qui fait la
   * différence entre une recherche exacte et une recherche tronquée.
   */
  const twinOfPrev = perSocket.map((list, i) => {
    if (i === 0) return false;
    const prev = perSocket[i - 1];
    if (prev.length !== list.length) return false;
    return list.every(
      (c, k) => c.hash === prev[k].hash && c.energyCost === prev[k].energyCost
    );
  });

  const dfs = (i: number, cost: number, minIndex: number) => {
    if (nodes++ > MAX_NODES) return;
    const u = utility(totals, shares);
    if (found && u + remainingBound(i, totals) < bestScore) return;
    if (i === perSocket.length) {
      // À utilité égale, la combinaison la moins gourmande en énergie gagne.
      if (
        !found ||
        u > bestScore + EPS ||
        (Math.abs(u - bestScore) <= EPS && cost < bestCost)
      ) {
        bestScore = u;
        bestCost = cost;
        bestPick = [...pick];
        found = true;
      }
      return;
    }
    const list = perSocket[i];
    for (let k = twinOfPrev[i] ? minIndex : 0; k < list.length; k++) {
      const c = list[k];
      if (cost + c.energyCost > budget) continue;
      if (c.unique && used.has(c.hash)) continue;
      if (c.unique) used.add(c.hash);
      for (let j = 0; j < totals.length; j++) totals[j] += c.gains[j];
      pick[i] = c;
      dfs(i + 1, cost + c.energyCost, k);
      for (let j = 0; j < totals.length; j++) totals[j] -= c.gains[j];
      if (c.unique) used.delete(c.hash);
    }
  };
  dfs(0, 0, 0);

  if (!found) {
    // Aucune combinaison légale (budget saturé) : on garde tout tel quel.
    bestPick = perSocket.map((list) => list.find((c) => c.keep) ?? list[0]);
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
    const running = [...acquired];
    for (const c of bestPick) {
      if (!c) continue;
      if (c.unique) takenHashes.add(c.hash);
      for (let j = 0; j < running.length; j++) running[j] += c.gains[j];
    }
    let cost = bestCost;

    for (let i = 0; i < sockets.length; i++) {
      const socket = sockets[i];
      const chosen = bestPick[i];
      if (!chosen?.keep || !socket.isEmpty) continue;

      const base = utility(running, shares);
      let best: PlugOption | null = null;
      let bestGains: number[] | null = null;
      let bestMargin = 0;
      let bestRaw = 0;

      for (const o of socket.options) {
        if (!o.canInsert || takenHashes.has(o.hash)) continue;
        if (cost - chosen.energyCost + o.energyCost > budget) continue;
        const gains = gainsOf(o.effects, statHashes);
        for (let j = 0; j < running.length; j++) running[j] += gains[j];
        const margin = utility(running, shares) - base;
        for (let j = 0; j < running.length; j++) running[j] -= gains[j];
        // À défaut de servir les priorités, on privilégie le mod qui apporte
        // le plus de points de stats, tous domaines confondus.
        const raw = o.effects.reduce((a, e) => a + Math.max(0, e.value), 0);
        if (
          margin > bestMargin + EPS ||
          (Math.abs(margin - bestMargin) <= EPS && raw > bestRaw)
        ) {
          best = o;
          bestGains = gains;
          bestMargin = margin;
          bestRaw = raw;
        }
      }
      if (!best || !bestGains) continue;

      cost = cost - chosen.energyCost + best.energyCost;
      takenHashes.add(best.hash);
      for (let j = 0; j < running.length; j++) running[j] += bestGains[j];
      bestPick[i] = {
        hash: best.hash,
        name: best.name,
        icon: best.icon,
        energyCost: best.energyCost,
        effects: best.effects,
        gains: bestGains,
        bound: boundOf(bestGains),
        keep: false,
        unique: true,
      };
    }
    bestCost = cost;
  }

  const choices: ComboChoice[] = [];
  const totalsByStat = new Map<number, number>();
  const deltas = new Map<number, number>();
  const finalGains = [...acquired];
  const currentGains = [...acquired];

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
      totalsByStat.set(
        e.statHash,
        (totalsByStat.get(e.statHash) ?? 0) + e.value
      );
      deltas.set(e.statHash, (deltas.get(e.statHash) ?? 0) + e.value);
    }
    for (const e of socket.currentEffects) {
      deltas.set(e.statHash, (deltas.get(e.statHash) ?? 0) - e.value);
    }
    const before = gainsOf(socket.currentEffects, statHashes);
    for (let j = 0; j < statHashes.length; j++) {
      finalGains[j] += c.gains[j];
      currentGains[j] += before[j];
    }
  }

  const score = utility(finalGains, shares);

  return {
    choices,
    changes: choices.filter((c) => c.isChange && c.plugHash !== 0),
    totals: totalsByStat,
    deltas,
    score,
    scoreGain: score - utility(currentGains, shares),
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
