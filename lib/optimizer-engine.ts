import { ARMOR_SLOT_ORDER, STAT_CAP } from "./destiny-constants";

/**
 * Moteur d'optimisation d'équipement.
 *
 * Principe : on énumère les combinaisons casque × gants × torse × jambes ×
 * objet de classe, on filtre sur les minimums de stats demandés, et on
 * maximise un score = somme pondérée des 6 stats.
 *
 * Option "simulation de mods" : le moteur suppose que tu peux poser un mod
 * de stat (+10) sur chacune des 5 pièces. Il les assigne d'abord pour
 * atteindre les minimums, puis met le reste dans la stat la plus pondérée.
 *
 * Pour rester instantané, chaque emplacement est pré-trié par score et
 * tronqué (les pièces verrouillées sont toujours conservées).
 */

export interface EnginePiece {
  /** itemInstanceId */
  id: string;
  itemHash: number;
  /** bucketTypeHash de l'emplacement */
  slot: number;
  isExotic: boolean;
  /** 6 valeurs alignées sur ARMOR_STAT_HASHES */
  stats: number[];
}

export interface EngineParams {
  /** Pièces déjà filtrées sur la classe choisie */
  pieces: EnginePiece[];
  /** Poids par stat (longueur 6) */
  weights: number[];
  /** Minimums par stat (longueur 6, 0 = aucun) */
  minimums: number[];
  /** Hash de l'exotique à verrouiller, ou null pour un build 100 % légendaire */
  exoticHash: number | null;
  /** Simuler 5 mods de stats (+10 chacun) */
  simulateMods?: boolean;
}

export interface Build {
  pieceIds: string[];
  totals: number[];
  /** Mods simulés par stat (nombre de +10), longueur 6 */
  mods: number[];
  score: number;
}

const TRIM_MAIN = 22; // casque / gants / torse / jambes
const TRIM_CLASS = 10; // objet de classe
const MOD_COUNT = 5;
const MOD_VALUE = 10;

function weightedScore(stats: number[], weights: number[]): number {
  let s = 0;
  for (let i = 0; i < 6; i++) s += stats[i] * weights[i];
  return s;
}

export function computeBestBuilds(params: EngineParams, topN = 10): Build[] {
  const { pieces, weights, minimums, exoticHash, simulateMods } = params;

  const exoticSlot =
    exoticHash !== null
      ? pieces.find((p) => p.itemHash === exoticHash)?.slot ?? null
      : null;

  // Candidats par emplacement
  const perSlot: EnginePiece[][] = ARMOR_SLOT_ORDER.map((slotHash) => {
    let candidates: EnginePiece[];
    if (exoticHash !== null && slotHash === exoticSlot) {
      // Uniquement les exemplaires de l'exotique verrouillé
      candidates = pieces.filter((p) => p.itemHash === exoticHash);
    } else {
      // Pas d'autre exotique dans le build
      candidates = pieces.filter((p) => p.slot === slotHash && !p.isExotic);
    }
    candidates = [...candidates].sort(
      (a, b) => weightedScore(b.stats, weights) - weightedScore(a.stats, weights)
    );
    const trim = slotHash === 1585787867 ? TRIM_CLASS : TRIM_MAIN;
    return candidates.slice(0, trim);
  });

  if (perSlot.some((list) => list.length === 0)) return [];

  const hasMinimums = minimums.some((m) => m > 0);
  const results: Build[] = [];
  let worstKept = -Infinity;
  const seen = new Set<string>();

  const [helmets, gauntlets, chests, legs, classItems] = perSlot;

  // Stat cible des mods restants : la plus pondérée (première en cas d'égalité)
  let favoriteStat = 0;
  for (let i = 1; i < 6; i++) {
    if (weights[i] > weights[favoriteStat]) favoriteStat = i;
  }

  const totals = new Array<number>(6);
  const mods = new Array<number>(6);

  for (const h of helmets) {
    for (const g of gauntlets) {
      for (const c of chests) {
        for (const l of legs) {
          for (const ci of classItems) {
            for (let i = 0; i < 6; i++) {
              totals[i] =
                h.stats[i] + g.stats[i] + c.stats[i] + l.stats[i] + ci.stats[i];
              mods[i] = 0;
            }

            if (simulateMods) {
              let modsLeft = MOD_COUNT;
              // 1) combler les minimums
              if (hasMinimums) {
                let feasible = true;
                for (let i = 0; i < 6; i++) {
                  if (totals[i] < minimums[i]) {
                    const need = Math.ceil((minimums[i] - totals[i]) / MOD_VALUE);
                    if (need > modsLeft) {
                      feasible = false;
                      break;
                    }
                    modsLeft -= need;
                    mods[i] += need;
                    totals[i] = Math.min(STAT_CAP, totals[i] + need * MOD_VALUE);
                  }
                }
                if (!feasible) continue;
              }
              // 2) le reste dans la stat favorite
              if (modsLeft > 0 && weights[favoriteStat] > 0) {
                mods[favoriteStat] += modsLeft;
                totals[favoriteStat] = Math.min(
                  STAT_CAP,
                  totals[favoriteStat] + modsLeft * MOD_VALUE
                );
              }
            } else if (hasMinimums) {
              let ok = true;
              for (let i = 0; i < 6; i++) {
                if (totals[i] < minimums[i]) {
                  ok = false;
                  break;
                }
              }
              if (!ok) continue;
            }

            const score = weightedScore(totals, weights);
            if (results.length >= topN && score <= worstKept) continue;

            // Déduplication : plusieurs exemplaires identiques donnent le même build
            const key = `${h.itemHash}.${g.itemHash}.${c.itemHash}.${l.itemHash}.${ci.itemHash}.${totals.join(",")}`;
            if (seen.has(key)) continue;
            seen.add(key);

            results.push({
              pieceIds: [h.id, g.id, c.id, l.id, ci.id],
              totals: [...totals],
              mods: [...mods],
              score,
            });
            results.sort((a, b) => b.score - a.score);
            if (results.length > topN) results.pop();
            worstKept = results[results.length - 1].score;
          }
        }
      }
    }
  }

  return results;
}

/**
 * Optimisation « Puissance ».
 *
 * La Puissance affichée en jeu est floor(moyenne des 8 emplacements
 * équipés) + un bonus (artefact saisonnier) constant. On ne touche pas aux
 * armes (choix du joueur) : seule l'armure (5 emplacements, 1 exotique max)
 * est réoptimisée pour maximiser la somme, ce qui maximise mécaniquement la
 * moyenne des 8 — donc jamais moins que l'assemblage actuel, puisque les
 * pièces actuellement équipées font partie des candidats.
 */

export interface PowerPiece {
  id: string;
  itemHash: number;
  slot: number;
  isExotic: boolean;
  power: number;
}

export interface PowerBuild {
  pieceIds: string[];
  armorPower: number;
  totalPower: number;
}

export interface PowerParams {
  /** Pièces d'armure déjà filtrées sur la classe choisie */
  armorPieces: PowerPiece[];
  /** Somme des Puissances des 3 armes actuellement équipées (non modifiées) */
  fixedWeaponPower: number;
  /** currentLight − floor((fixedWeaponPower + puissance armure actuelle) / 8) */
  offset: number;
}

export function computeBestPowerBuilds(params: PowerParams, topN = 5): PowerBuild[] {
  const { armorPieces, fixedWeaponPower, offset } = params;

  const perSlot = ARMOR_SLOT_ORDER.map((slotHash) =>
    armorPieces.filter((p) => p.slot === slotHash).sort((a, b) => b.power - a.power)
  );
  if (perSlot.some((list) => list.length === 0)) return [];

  const bestNonExotic = perSlot.map((list) => list.find((p) => !p.isExotic) ?? null);
  const bestExotic = perSlot.map((list) => list.find((p) => p.isExotic) ?? null);

  // Emplacement(s) sans aucune pièce légendaire : l'exotique y est obligatoire.
  const forcedExoticSlots = bestNonExotic
    .map((p, i) => (p === null ? i : -1))
    .filter((i) => i >= 0);
  if (forcedExoticSlots.length > 1) return []; // aucun assemblage légal possible

  const forcedSlot = forcedExoticSlots[0] ?? -1;
  if (forcedSlot >= 0 && bestExotic[forcedSlot] === null) return [];

  const exoticChoices: number[] =
    forcedSlot >= 0
      ? [forcedSlot]
      : [-1, ...bestExotic.map((p, i) => (p ? i : -1)).filter((i) => i >= 0)];

  const seen = new Set<string>();
  const results: PowerBuild[] = [];

  for (const exoticSlot of exoticChoices) {
    const pieces: PowerPiece[] = [];
    let feasible = true;
    for (let i = 0; i < 5; i++) {
      const piece = i === exoticSlot ? bestExotic[i] : bestNonExotic[i];
      if (!piece) {
        feasible = false;
        break;
      }
      pieces.push(piece);
    }
    if (!feasible) continue;

    const key = pieces.map((p) => p.itemHash).join(".");
    if (seen.has(key)) continue;
    seen.add(key);

    const armorPower = pieces.reduce((a, p) => a + p.power, 0);
    const totalPower = Math.floor((fixedWeaponPower + armorPower) / 8) + offset;

    results.push({
      pieceIds: pieces.map((p) => p.id),
      armorPower,
      totalPower,
    });
  }

  results.sort((a, b) => b.totalPower - a.totalPower);
  return results.slice(0, topN);
}
