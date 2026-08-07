import { ARMOR_SLOT_ORDER } from "./destiny-constants";

/**
 * Moteur d'optimisation d'équipement.
 *
 * Principe : on énumère les combinaisons casque × gants × torse × jambes ×
 * objet de classe, on filtre sur les minimums de stats demandés, et on
 * maximise un score = somme pondérée des 6 stats.
 *
 * Pour rester instantané, chaque emplacement est pré-trié par score et
 * tronqué (les pièces verrouillées sont toujours conservées). Avec des
 * poids purs (sans minimums), le meilleur build est de toute façon dans
 * ce sous-ensemble.
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
}

export interface Build {
  pieceIds: string[];
  totals: number[];
  score: number;
}

const TRIM_MAIN = 22; // casque / gants / torse / jambes
const TRIM_CLASS = 10; // objet de classe

function weightedScore(stats: number[], weights: number[]): number {
  let s = 0;
  for (let i = 0; i < 6; i++) s += stats[i] * weights[i];
  return s;
}

export function computeBestBuilds(params: EngineParams, topN = 10): Build[] {
  const { pieces, weights, minimums, exoticHash } = params;

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

  const totals = new Array<number>(6);

  for (const h of helmets) {
    for (const g of gauntlets) {
      for (const c of chests) {
        for (const l of legs) {
          for (const ci of classItems) {
            for (let i = 0; i < 6; i++) {
              totals[i] =
                h.stats[i] + g.stats[i] + c.stats[i] + l.stats[i] + ci.stats[i];
            }

            if (hasMinimums) {
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
