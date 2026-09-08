import { insertPlug, sleep } from "./d2-actions";
import type { ComboChoice, ModSocket } from "./mod-engine";
import type { Defs } from "./types";

/**
 * Pose d'une combinaison de mods sur un objet.
 *
 * Deux pièges que ce module traite explicitement :
 *
 *  1. **La confirmation.** Bungie répond ErrorCode 1 à `InsertSocketPlugFree`
 *     puis renvoie l'objet mis à jour. C'est CETTE réponse qui fait foi.
 *     Relire le profil dans la foulée donnait des faux négatifs (réplication
 *     Bungie + cache HTTP) : on annonçait « non posé en jeu » des mods
 *     pourtant bien en place.
 *
 *  2. **L'ordre des poses.** Le budget d'énergie doit tenir à CHAQUE étape,
 *     pas seulement à l'arrivée : on libère donc l'énergie avant de la
 *     dépenser. Et comme le jeu DÉPLACE un mod au lieu de le dupliquer, un
 *     emplacement dont le mod part ailleurs doit être servi en premier.
 */

export interface ApplyOutcome {
  choice: ComboChoice;
  /** "posé" confirmé par Bungie, "incertain" faute de retour, "échec" sinon */
  status: "posé" | "incertain" | "échec";
  reason?: string;
}

export interface ApplyReport {
  outcomes: ApplyOutcome[];
  applied: number;
  uncertain: number;
  failed: number;
}

/**
 * Ordonne les poses pour qu'aucune étape intermédiaire ne dépasse le budget
 * d'énergie, et pour qu'un mod réutilisé ailleurs soit déplacé avant d'être
 * écrasé.
 */
export function orderChanges(
  changes: ComboChoice[],
  sockets: ModSocket[]
): ComboChoice[] {
  const currentBySocket = new Map<number, number | undefined>();
  const costBySocket = new Map<number, number>();
  for (const s of sockets) {
    currentBySocket.set(s.socketIndex, s.currentPlugHash);
    costBySocket.set(s.socketIndex, s.currentCost);
  }

  // Un mod que la combinaison veut ailleurs : sa destination passe en premier,
  // sinon le jeu le retire de l'emplacement d'origine juste après l'y avoir mis.
  const movedTo = new Set<number>();
  for (const c of changes) {
    const origin = sockets.find(
      (s) => s.currentPlugHash === c.plugHash && s.socketIndex !== c.socketIndex
    );
    if (origin) movedTo.add(c.socketIndex);
  }

  return [...changes].sort((a, b) => {
    const movedDiff = Number(movedTo.has(b.socketIndex)) - Number(movedTo.has(a.socketIndex));
    if (movedDiff !== 0) return movedDiff;
    const da = a.energyCost - (costBySocket.get(a.socketIndex) ?? 0);
    const db = b.energyCost - (costBySocket.get(b.socketIndex) ?? 0);
    return da - db; // les libérations d'énergie d'abord
  });
}

/** Message d'erreur Bungie signifiant « l'objet vient de bouger, réessaie ». */
function isStaleError(msg: string): boolean {
  return /refresh the item|try again|stale|out of date/i.test(msg);
}

/** Message Bungie signifiant « ce changement ne passe pas par le web ». */
function isForbiddenError(msg: string): boolean {
  return /cannot perform that change|not allowed|unsupported/i.test(msg);
}

export async function applyModCombo(opts: {
  defs: Defs;
  instanceId: string;
  characterId: string;
  itemName: string;
  changes: ComboChoice[];
  sockets: ModSocket[];
  log: (m: string) => void;
  /** Pause entre deux poses (limite de débit Bungie) */
  delayMs?: number;
}): Promise<ApplyReport> {
  const {
    defs,
    instanceId,
    characterId,
    itemName,
    changes,
    sockets,
    log,
    delayMs = 450,
  } = opts;

  const outcomes: ApplyOutcome[] = [];
  const ordered = orderChanges(changes, sockets);

  for (const choice of ordered) {
    let outcome: ApplyOutcome | null = null;

    for (let attempt = 0; attempt < 3 && !outcome; attempt++) {
      try {
        const res = await insertPlug({
          itemId: instanceId,
          characterId,
          socketIndex: choice.socketIndex,
          plugItemHash: choice.plugHash,
        });

        if (res.applied === true) {
          outcome = { choice, status: "posé" };
        } else if (res.applied === false) {
          // Bungie a accepté l'appel mais l'emplacement contient autre chose :
          // c'est le seul cas où « non posé » est une certitude.
          const actual = res.actualPlugHash
            ? (defs.items[res.actualPlugHash]?.displayProperties?.name ??
              `mod ${res.actualPlugHash}`)
            : "emplacement vide";
          outcome = {
            choice,
            status: "échec",
            reason: `Bungie a laissé « ${actual} » en place`,
          };
        } else {
          outcome = { choice, status: "incertain" };
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "refusé";
        if (isForbiddenError(msg)) {
          outcome = {
            choice,
            status: "échec",
            reason: "non modifiable depuis le web (à faire en jeu)",
          };
        } else if (isStaleError(msg) && attempt < 2) {
          // L'objet vient de changer d'état : on laisse Bungie se synchroniser.
          await sleep(900 * (attempt + 1));
        } else {
          outcome = { choice, status: "échec", reason: msg };
        }
      }
    }

    outcomes.push(outcome ?? { choice, status: "échec", reason: "délai dépassé" });
    await sleep(delayMs);
  }

  const applied = outcomes.filter((o) => o.status === "posé").length;
  const uncertain = outcomes.filter((o) => o.status === "incertain").length;
  const failed = outcomes.filter((o) => o.status === "échec").length;

  for (const o of outcomes) {
    if (o.status === "échec") {
      log(`⚠️ ${itemName} · ${o.choice.name} : ${o.reason ?? "non posé"}`);
    }
  }
  if (applied > 0) {
    log(`🔧 ${itemName} : ${applied} mod${applied > 1 ? "s" : ""} posé${applied > 1 ? "s" : ""}.`);
  }

  return { outcomes, applied, uncertain, failed };
}
