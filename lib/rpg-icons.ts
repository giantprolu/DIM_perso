/**
 * Icônes RPG Awesome (https://nagoshiashumari.github.io/Rpg-Awesome/).
 *
 * Bungie ne fournit pas d'icône pour un mode de jeu : `DestinyActivityModeDefinition`
 * n'expose qu'un nom et un `modeType` numérique. On associe donc chaque mode à
 * un pictogramme de la police, et on regroupe au passage les vingt variantes
 * de Creuset ou de Bannière de Fer sous une seule famille lisible.
 *
 * La police est servie depuis `public/fonts` et déclarée dans `app/rpg-awesome.css` :
 * une classe suffit, `<i className="ra ra-dragon" />`.
 */

/** Famille d'activité : ce qui décide de l'icône, de la couleur et du filtre. */
export type ActivityFamily =
  | "raid"
  | "dungeon"
  | "nightfall"
  | "strike"
  | "lostSector"
  | "exotic"
  | "gambit"
  | "trials"
  | "ironBanner"
  | "crucible"
  | "patrol"
  | "story"
  | "social"
  | "seasonal"
  | "other";

export interface FamilyStyle {
  key: ActivityFamily;
  label: string;
  icon: string;
  /** Classe de couleur DaisyUI/Tailwind appliquée à l'icône. */
  color: string;
}

/**
 * Ordre volontaire : c'est celui des filtres de la page Activité, du contenu
 * le plus « endgame » au plus quotidien.
 */
export const FAMILIES: FamilyStyle[] = [
  { key: "raid", label: "Raids", icon: "ra-dragon", color: "text-purple-300" },
  {
    key: "dungeon",
    label: "Donjons",
    icon: "ra-locked-fortress",
    color: "text-amber-300",
  },
  {
    key: "nightfall",
    label: "Nuits noires",
    icon: "ra-burning-eye",
    color: "text-orange-300",
  },
  {
    key: "strike",
    label: "Assauts",
    icon: "ra-crossed-swords",
    color: "text-sky-300",
  },
  {
    key: "lostSector",
    label: "Secteurs perdus",
    icon: "ra-hole-ladder",
    color: "text-teal-300",
  },
  {
    key: "exotic",
    label: "Missions exotiques",
    icon: "ra-alien-fire",
    color: "text-yellow-300",
  },
  { key: "gambit", label: "Gambit", icon: "ra-gold-bar", color: "text-lime-300" },
  {
    key: "trials",
    label: "Épreuves",
    icon: "ra-lighthouse",
    color: "text-rose-300",
  },
  {
    key: "ironBanner",
    label: "Bannière de Fer",
    icon: "ra-castle-flag",
    color: "text-red-300",
  },
  {
    key: "crucible",
    label: "Creuset",
    icon: "ra-crossed-sabres",
    color: "text-red-200",
  },
  {
    key: "patrol",
    label: "Patrouille",
    icon: "ra-compass",
    color: "text-emerald-300",
  },
  { key: "story", label: "Histoire", icon: "ra-book", color: "text-indigo-300" },
  {
    key: "social",
    label: "Zones sociales",
    icon: "ra-campfire",
    color: "text-orange-200",
  },
  {
    key: "seasonal",
    label: "Saisonnier",
    icon: "ra-dice-six",
    color: "text-fuchsia-300",
  },
  { key: "other", label: "Autre", icon: "ra-help", color: "text-base-content" },
];

const BY_KEY = new Map(FAMILIES.map((f) => [f.key, f]));

/** DestinyActivityModeType → famille. Les modes absents retombent sur « autre ». */
const MODE_FAMILY: Record<number, ActivityFamily> = {
  2: "story",
  3: "strike",
  4: "raid",
  5: "crucible",
  6: "patrol",
  10: "crucible",
  12: "crucible",
  15: "crucible",
  16: "nightfall",
  17: "nightfall",
  18: "strike",
  19: "ironBanner",
  25: "crucible",
  31: "crucible",
  37: "crucible",
  38: "crucible",
  39: "trials",
  40: "social",
  41: "trials",
  42: "trials",
  43: "ironBanner",
  44: "ironBanner",
  45: "ironBanner",
  46: "nightfall",
  47: "nightfall",
  48: "crucible",
  49: "crucible",
  50: "crucible",
  58: "story",
  59: "crucible",
  60: "crucible",
  61: "crucible",
  62: "crucible",
  63: "gambit",
  65: "crucible",
  66: "seasonal",
  67: "seasonal",
  68: "ironBanner",
  69: "crucible",
  70: "crucible",
  71: "crucible",
  72: "crucible",
  73: "crucible",
  74: "crucible",
  75: "gambit",
  76: "seasonal",
  77: "seasonal",
  78: "seasonal",
  79: "seasonal",
  80: "crucible",
  81: "crucible",
  82: "dungeon",
  83: "seasonal",
  84: "trials",
  85: "seasonal",
  86: "seasonal",
  87: "lostSector",
  88: "crucible",
  89: "crucible",
  90: "ironBanner",
  91: "ironBanner",
  92: "seasonal",
};

/**
 * Famille d'une activité.
 *
 * L'historique donne parfois un mode générique (7 « PvE », 64 « PvE
 * compétitif ») alors que la liste `modes` contient le mode précis : on prend
 * donc le plus spécifique disponible, en repassant par le nom de l'activité
 * pour les contenus que Bungie ne classe nulle part (missions exotiques).
 */
export function activityFamily(opts: {
  mode?: number;
  modes?: number[];
  name?: string;
}): ActivityFamily {
  const candidates = [
    ...(opts.modes ?? []),
    ...(opts.mode !== undefined ? [opts.mode] : []),
  ];
  for (const m of candidates) {
    const family = MODE_FAMILY[m];
    // 7 et 64 sont des fourre-tout : on continue à chercher plus précis.
    if (family && m !== 7 && m !== 64) return family;
  }
  const name = (opts.name ?? "").toLowerCase();
  if (name.includes("secteur perdu") || name.includes("lost sector")) {
    return "lostSector";
  }
  if (name.includes("exotique") || name.includes("exotic")) return "exotic";
  if (candidates.includes(64)) return "gambit";
  if (candidates.includes(7)) return "patrol";
  return "other";
}

export function familyStyle(key: ActivityFamily): FamilyStyle {
  return BY_KEY.get(key) ?? BY_KEY.get("other")!;
}

/**
 * Icônes des concepts récurrents du site (statistiques, sections, jalons).
 * Centralisées ici pour que deux pages ne montrent jamais deux pictogrammes
 * différents pour la même idée.
 */
export const ICONS = {
  power: "ra-lightning-bolt",
  artifact: "ra-crystal-cluster",
  seasonPass: "ra-crown",
  quest: "ra-scroll-unfurled",
  bounty: "ra-target-arrows",
  challenge: "ra-trophy",
  rank: "ra-podium",
  reputation: "ra-shield",
  postmaster: "ra-key",
  currency: "ra-gem",
  vendor: "ra-gold-bar",
  clan: "ra-castle-emblem",
  character: "ra-player",
  weapon: "ra-revolver",
  armor: "ra-vest",
  loadout: "ra-knight-helmet",
  optimizer: "ra-anvil",
  time: "ra-hourglass",
  reset: "ra-cycle",
  kills: "ra-crossed-swords",
  deaths: "ra-tombstone",
  precision: "ra-targeted",
  victory: "ra-trophy",
  activity: "ra-arena",
  online: "ra-sun",
  history: "ra-scroll-unfurled",
  warning: "ra-radioactive",
} as const;
