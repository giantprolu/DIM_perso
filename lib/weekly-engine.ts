import { fillVariables, type StringVariables } from "./string-variables";
import type {
  CharacterProgressions,
  Defs,
  MilestoneState,
  ObjectiveProgress,
  ProfileResponse,
  PublicMilestone,
} from "./types";

/**
 * Moteur de la page « Cette semaine ».
 *
 * Bungie livre la progression sous une forme volontairement générique :
 * des jalons (`milestones`) qui contiennent, selon les cas, des quêtes, des
 * défis d'activité, des récompenses ou rien du tout. Ce module en tire trois
 * listes lisibles — ce qu'il reste à faire, où en sont les réputations, et ce
 * que vaut l'artefact — sans jamais coder en dur un hash d'activité, pour que
 * la page survive au changement de saison.
 */

/** DestinyMilestoneType */
const MILESTONE_WEEKLY = 3;
const MILESTONE_DAILY = 4;
const MILESTONE_SPECIAL = 5;

export interface ObjectiveView {
  hash: number;
  label: string;
  progress: number;
  total: number;
  complete: boolean;
}

export interface RewardView {
  name: string;
  earned: boolean;
  redeemed: boolean;
}

export interface ModifierView {
  hash: number;
  name: string;
  description: string;
  icon?: string;
}

export interface ActivityView {
  hash: number;
  name: string;
  modifiers: ModifierView[];
}

export interface MilestoneView {
  hash: number;
  name: string;
  description: string;
  icon?: string;
  image?: string;
  /** Libellé du rythme : « Hebdomadaire », « Quotidien »… */
  cadence: string;
  isWeekly: boolean;
  activities: ActivityView[];
  objectives: ObjectiveView[];
  rewards: RewardView[];
  endDate?: string;
  complete: boolean;
  order: number;
}

export interface RankView {
  hash: number;
  name: string;
  icon?: string;
  level: number;
  levelCap: number;
  /** Nom du palier courant (« Héroïque », « Légende »…) */
  stepName?: string;
  progress: number;
  nextAt: number;
  resets: number;
  weeklyProgress?: number;
  weeklyLimit?: number;
}

export interface ArtifactView {
  name: string;
  icon?: string;
  powerBonus: number;
  pointsAcquired: number;
  /** Progression vers le prochain point d'artefact */
  progress: number;
  nextAt: number;
  level: number;
}

// ---------------------------------------------------------------------------
// Jalons
// ---------------------------------------------------------------------------

function objectiveView(
  defs: Defs,
  vars: StringVariables | null,
  characterId: string,
  o: ObjectiveProgress
): ObjectiveView {
  const def = defs.objectives?.[o.objectiveHash];
  const total = o.completionValue || def?.completionValue || 0;
  return {
    hash: o.objectiveHash,
    label:
      fillVariables(def?.progressDescription, vars, characterId) || "Progression",
    progress: o.progress ?? 0,
    total,
    complete: o.complete || (total > 0 && (o.progress ?? 0) >= total),
  };
}

/** Les objectifs d'un jalon, quel que soit l'endroit où Bungie les a rangés. */
function collectObjectives(m: MilestoneState): ObjectiveProgress[] {
  const out: ObjectiveProgress[] = [];
  const seen = new Set<number>();

  const push = (o: ObjectiveProgress | undefined) => {
    if (!o || o.visible === false || seen.has(o.objectiveHash)) return;
    seen.add(o.objectiveHash);
    out.push(o);
  };

  for (const quest of m.availableQuests ?? []) {
    for (const o of quest.status?.stepObjectives ?? []) push(o);
    for (const c of quest.challenges ?? []) push(c.objective);
  }
  for (const activity of m.activities ?? []) {
    for (const c of activity.challenges ?? []) push(c.objective);
  }
  return out;
}

function collectModifiers(defs: Defs, hashes: number[]): ModifierView[] {
  const out: ModifierView[] = [];
  const seen = new Set<number>();
  for (const hash of hashes) {
    if (seen.has(hash)) continue;
    seen.add(hash);
    const def = defs.activityModifiers?.[hash];
    const name = def?.displayProperties?.name;
    // Bungie mélange les vrais modificateurs à des marqueurs internes sans nom.
    if (!name) continue;
    out.push({
      hash,
      name,
      description: def?.displayProperties?.description ?? "",
      icon: def?.displayProperties?.icon,
    });
  }
  return out;
}

function cadenceLabel(type: number | undefined): string {
  if (type === MILESTONE_WEEKLY) return "Hebdomadaire";
  if (type === MILESTONE_DAILY) return "Quotidien";
  if (type === MILESTONE_SPECIAL) return "Événement";
  return "En cours";
}

/**
 * Nom d'un jalon.
 *
 * Certains jalons n'ont pas de nom propre : ils empruntent celui de leur
 * quête ou, à défaut, de l'activité qu'ils désignent.
 */
function milestoneName(defs: Defs, m: MilestoneState): string {
  const def = defs.milestones?.[m.milestoneHash];
  const direct = def?.displayProperties?.name;
  if (direct) return direct;

  for (const quest of m.availableQuests ?? []) {
    const questName =
      def?.quests?.[quest.questItemHash]?.displayProperties?.name ??
      defs.items?.[quest.questItemHash]?.displayProperties?.name;
    if (questName) return questName;
  }
  for (const activity of m.activities ?? []) {
    const name = defs.activities?.[activity.activityHash]?.displayProperties?.name;
    if (name) return name;
  }
  return "";
}

export function buildMilestones(
  defs: Defs,
  progressions: CharacterProgressions | undefined,
  vars: StringVariables | null,
  characterId: string
): MilestoneView[] {
  const views: MilestoneView[] = [];

  for (const m of Object.values(progressions?.milestones ?? {})) {
    const def = defs.milestones?.[m.milestoneHash];
    if (def?.redacted) continue;

    const name = milestoneName(defs, m);
    if (!name) continue; // rien d'affichable : jalon interne

    const objectives = collectObjectives(m).map((o) =>
      objectiveView(defs, vars, characterId, o)
    );

    const rewards: RewardView[] = [];
    for (const category of m.rewards ?? []) {
      const catDef = def?.rewards?.[category.rewardCategoryHash];
      for (const entry of category.entries ?? []) {
        const entryDef = catDef?.rewardEntries?.[entry.rewardEntryHash];
        rewards.push({
          name:
            entryDef?.displayProperties?.name ??
            catDef?.displayProperties?.name ??
            "Récompense",
          earned: entry.earned,
          redeemed: entry.redeemed,
        });
      }
    }

    const activities: ActivityView[] = [];
    for (const activity of m.activities ?? []) {
      const actDef = defs.activities?.[activity.activityHash];
      const actName = actDef?.displayProperties?.name;
      if (!actName) continue;
      activities.push({
        hash: activity.activityHash,
        name: actName,
        modifiers: collectModifiers(defs, activity.modifierHashes ?? []),
      });
    }

    /*
     * « Terminé » se lit d'abord dans les récompenses : un raid dont le coffre
     * hebdomadaire est déjà pris est fini, même si ses défis restent à zéro.
     */
    const complete =
      rewards.length > 0
        ? rewards.every((r) => r.earned || r.redeemed)
        : objectives.length > 0 && objectives.every((o) => o.complete);

    views.push({
      hash: m.milestoneHash,
      name,
      description: fillVariables(
        def?.displayProperties?.description,
        vars,
        characterId
      ),
      icon: def?.displayProperties?.icon,
      image: def?.image,
      cadence: cadenceLabel(def?.milestoneType),
      isWeekly: def?.milestoneType === MILESTONE_WEEKLY,
      activities,
      objectives,
      rewards,
      endDate: m.endDate,
      complete,
      order: m.order ?? def?.hash ?? 0,
    });
  }

  // À faire d'abord, terminé ensuite ; l'ordre de Bungie départage le reste.
  views.sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? 1 : -1;
    if (a.isWeekly !== b.isWeekly) return a.isWeekly ? -1 : 1;
    return a.order - b.order || a.name.localeCompare(b.name, "fr");
  });
  return views;
}

/**
 * La rotation publique, pour ce que le personnage ne voit pas encore : les
 * activités de la semaine et leurs modificateurs, identiques pour tous.
 */
export function buildRotation(
  defs: Defs,
  publicMilestones: Record<string, PublicMilestone> | null
): MilestoneView[] {
  if (!publicMilestones) return [];
  const views: MilestoneView[] = [];

  for (const m of Object.values(publicMilestones)) {
    const def = defs.milestones?.[m.milestoneHash];
    if (def?.redacted) continue;

    const activities: ActivityView[] = [];
    for (const activity of m.activities ?? []) {
      const actDef = defs.activities?.[activity.activityHash];
      const actName = actDef?.displayProperties?.name;
      if (!actName) continue;
      activities.push({
        hash: activity.activityHash,
        name: actName,
        modifiers: collectModifiers(defs, activity.modifierHashes ?? []),
      });
    }

    const name = def?.displayProperties?.name ?? activities[0]?.name ?? "";
    // Sans nom ni activité, il ne reste rien à montrer.
    if (!name || activities.length === 0) continue;

    views.push({
      hash: m.milestoneHash,
      name,
      description: def?.displayProperties?.description ?? "",
      icon: def?.displayProperties?.icon,
      image: def?.image,
      cadence: cadenceLabel(def?.milestoneType),
      isWeekly: def?.milestoneType === MILESTONE_WEEKLY,
      activities,
      objectives: [],
      rewards: [],
      endDate: m.endDate,
      complete: false,
      order: m.order ?? 0,
    });
  }

  views.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "fr"));
  return views;
}

// ---------------------------------------------------------------------------
// Réputations
// ---------------------------------------------------------------------------

/**
 * Rangs à afficher.
 *
 * Le profil contient des centaines de progressions, dont beaucoup de
 * compteurs internes. Plutôt qu'une liste blanche de hashs (qui périme à
 * chaque saison), on garde ce qui ressemble à une réputation : un nom, une
 * icône de rang ou des paliers nommés, et une progression entamée.
 */
export function buildRanks(
  defs: Defs,
  progressions: CharacterProgressions | undefined
): RankView[] {
  const views: RankView[] = [];

  for (const p of Object.values(progressions?.progressions ?? {})) {
    const def = defs.progressions?.[p.progressionHash];
    if (!def || def.redacted || def.visible === false) continue;

    const name = def.displayProperties?.name;
    if (!name) continue;

    const looksLikeRank = Boolean(def.rankIcon) || (def.steps?.length ?? 0) >= 2;
    if (!looksLikeRank) continue;

    const started = (p.level ?? 0) > 0 || (p.currentProgress ?? 0) > 0;
    if (!started) continue;

    const step = p.stepIndex !== undefined ? def.steps?.[p.stepIndex] : undefined;

    views.push({
      hash: p.progressionHash,
      name,
      icon: def.rankIcon ?? def.displayProperties?.icon,
      level: p.level ?? 0,
      levelCap: p.levelCap ?? 0,
      stepName: step?.stepName,
      progress: p.progressToNextLevel ?? 0,
      nextAt: p.nextLevelAt ?? 0,
      resets: p.currentResetCount ?? 0,
      weeklyProgress: p.weeklyProgress,
      weeklyLimit: p.weeklyLimit,
    });
  }

  views.sort(
    (a, b) => b.level - a.level || a.name.localeCompare(b.name, "fr")
  );
  return views;
}

// ---------------------------------------------------------------------------
// Artefact
// ---------------------------------------------------------------------------

export function buildArtifact(
  defs: Defs,
  profile: ProfileResponse,
  characterId: string
): ArtifactView | null {
  // L'artefact est le même pour tout le compte ; le composant 202 le répète
  // par personnage, ce qui dépanne si le composant 104 manque.
  const artifact =
    profile.profileProgression?.data?.seasonalArtifact ??
    profile.characterProgressions?.data?.[characterId]?.seasonalArtifact;
  if (!artifact) return null;

  const def = defs.artifacts?.[artifact.artifactHash];
  const points = artifact.pointProgression;

  return {
    name: def?.displayProperties?.name ?? "Artefact saisonnier",
    icon: def?.displayProperties?.icon,
    powerBonus: artifact.powerBonus ?? 0,
    pointsAcquired: artifact.pointsAcquired ?? 0,
    progress: points?.progressToNextLevel ?? 0,
    nextAt: points?.nextLevelAt ?? 0,
    level: points?.level ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Divers
// ---------------------------------------------------------------------------

/** « dans 2 j 5 h », ou null si la date est passée ou absente. */
export function timeLeft(iso: string | undefined): string | null {
  if (!iso) return null;
  const end = new Date(iso).getTime();
  if (!Number.isFinite(end)) return null;
  const ms = end - Date.now();
  if (ms <= 0) return null;

  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} j ${hours % 24} h`;
  if (hours > 0) return `${hours} h ${Math.floor((ms % 3_600_000) / 60_000)} min`;
  return `${Math.max(1, Math.floor(ms / 60_000))} min`;
}
