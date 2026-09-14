import {
  ARMOR_BUCKETS,
  ARMOR_STAT_HASHES,
  ITEM_STATE_CRAFTED,
  ITEM_STATE_LOCKED,
  ITEM_STATE_MASTERWORK,
  ITEM_TYPE_ARMOR,
  ITEM_TYPE_SUBCLASS,
  ITEM_TYPE_WEAPON,
  SOCKET_CATEGORY_ARMOR_MODS,
  SOCKET_CATEGORY_WEAPON_MODS,
  SOCKET_CATEGORY_WEAPON_PERKS,
  STAT_CAP,
  TIER_EXOTIC,
  WEAPON_BUCKETS,
  WEAPON_STAT_HASHES,
} from "./destiny-constants";
import type { Defs, ProfileResponse, SocketState } from "./types";

/**
 * Fiche d'un objet, lisible partout dans le site, avec ou sans instance.
 *
 * Deux niveaux de connaissance coexistent :
 *  — le manifest seul (un objet en vente, une récompense, un mod) : nom,
 *    catégorie, description, statistiques de base et perks par défaut ;
 *  — une instance possédée : la puissance réelle, les stats roulées, les
 *    perks et mods effectivement posés, l'état (chef-d'œuvre, verrouillé).
 *
 * `buildItemInfo` accepte les deux et dit lequel il a produit (`hasInstance`),
 * pour que l'affichage ne fasse jamais passer une valeur théorique pour une
 * valeur mesurée.
 */

/** Ce qu'une page sait déjà d'une instance, quelle qu'en soit la source. */
export interface ItemInstanceData {
  primaryStat?: number;
  damageTypeHash?: number;
  energyCapacity?: number;
  energyUsed?: number;
  stats?: Record<string, { statHash: number; value: number }>;
  sockets?: SocketState[];
  /** Drapeaux DestinyItemState (verrouillé, chef-d'œuvre, façonné) */
  state?: number;
  quantity?: number;
}

export interface InfoPlug {
  hash: number;
  name: string;
  icon?: string;
  description?: string;
}

export interface InfoStat {
  hash: number;
  name: string;
  value: number;
  max: number;
}

export interface ItemInfo {
  itemHash: number;
  name: string;
  icon?: string;
  watermark?: string;
  screenshot?: string;
  flavorText?: string;
  description?: string;
  /** « Fusil à impulsion légendaire », tel que le jeu l'écrit */
  subtitle: string;
  typeName: string;
  tierName: string;
  isExotic: boolean;
  slotName?: string;
  classLabel?: string;
  ammoLabel?: string;
  power: number;
  damageName?: string;
  damageIcon?: string;
  energyCapacity: number;
  energyUsed: number;
  isMasterwork: boolean;
  isCrafted: boolean;
  isLocked: boolean;
  isWeapon: boolean;
  isArmor: boolean;
  stats: InfoStat[];
  perks: InfoPlug[];
  mods: InfoPlug[];
  quantity?: number;
  /** true quand les chiffres viennent d'un exemplaire réel, pas du manifest */
  hasInstance: boolean;
}

const POWER_STAT = 1935470627;

const AMMO_NAMES: Record<number, string> = {
  1: "Munitions primaires",
  2: "Munitions spéciales",
  3: "Munitions lourdes",
};

const CLASS_LABELS: Record<number, string> = {
  0: "Titan",
  1: "Chasseur",
  2: "Arcaniste",
};

/**
 * Les emplacements vides existent dans les données mais ne disent rien :
 * les montrer remplirait la fiche de cases « Emplacement vide ».
 */
function isEmptyPlug(defs: Defs, hash: number): boolean {
  const def = defs.items[hash];
  if (!def) return true;
  const category = def.plug?.plugCategoryIdentifier ?? "";
  if (category.includes("empty") || category.endsWith(".none")) return true;
  const name = def.displayProperties?.name ?? "";
  if (!name) return true;
  return /emplacement.*vide|empty (mod )?socket/i.test(name);
}

function plugOf(defs: Defs, hash: number): InfoPlug | null {
  if (isEmptyPlug(defs, hash)) return null;
  const def = defs.items[hash];
  const name = def?.displayProperties?.name;
  if (!name) return null;
  return {
    hash,
    name,
    icon: def?.displayProperties?.icon,
    description: def?.displayProperties?.description || undefined,
  };
}

function socketIndexesOf(
  defs: Defs,
  itemHash: number,
  categoryHash: number
): number[] {
  return (
    defs.items[itemHash]?.sockets?.socketCategories?.find(
      (c) => c.socketCategoryHash === categoryHash
    )?.socketIndexes ?? []
  );
}

/**
 * Les plugs posés d'une catégorie. Sans instance, le manifest donne le plug
 * initial de chaque emplacement : c'est la version « de base » de l'objet,
 * exacte pour un exotique, indicative pour une légendaire à perks aléatoires.
 */
function plugsOfCategory(
  defs: Defs,
  itemHash: number,
  categoryHash: number,
  sockets?: SocketState[]
): InfoPlug[] {
  const entries = defs.items[itemHash]?.sockets?.socketEntries ?? [];
  const out: InfoPlug[] = [];
  const seen = new Set<number>();

  for (const index of socketIndexesOf(defs, itemHash, categoryHash)) {
    const state = sockets?.[index];
    if (sockets && state?.isVisible === false) continue;
    const hash = sockets
      ? state?.plugHash
      : entries[index]?.singleInitialItemHash;
    if (!hash || seen.has(hash)) continue;
    const plug = plugOf(defs, hash);
    if (!plug) continue;
    seen.add(hash);
    out.push(plug);
  }
  return out;
}

/** L'ordre d'affichage des stats, pour lire un objet comme en jeu. */
function statOrder(hash: number, isArmor: boolean): number {
  const list = isArmor ? ARMOR_STAT_HASHES : WEAPON_STAT_HASHES;
  const index = list.indexOf(hash);
  return index === -1 ? list.length : index;
}

function statsOf(
  defs: Defs,
  itemHash: number,
  isArmor: boolean,
  instance?: ItemInstanceData
): InfoStat[] {
  const raw: { hash: number; value: number }[] = [];

  if (instance?.stats) {
    for (const s of Object.values(instance.stats)) {
      raw.push({ hash: s.statHash, value: s.value });
    }
  } else {
    for (const s of defs.items[itemHash]?.investmentStats ?? []) {
      /*
       * Les stats conditionnelles ne s'appliquent que dans certains cas
       * (activité, sous-classe) : les afficher donnerait une fiche fausse.
       */
      if (s.isConditionallyActive) continue;
      raw.push({ hash: s.statTypeHash, value: s.value });
    }
  }

  return raw
    .filter((s) => s.hash !== POWER_STAT && s.value !== 0)
    .map((s) => ({
      hash: s.hash,
      name: defs.stats?.[s.hash]?.displayProperties?.name ?? "",
      value: s.value,
      max: ARMOR_STAT_HASHES.includes(s.hash) ? STAT_CAP : 100,
    }))
    .filter((s) => s.name)
    .sort((a, b) => statOrder(a.hash, isArmor) - statOrder(b.hash, isArmor));
}

export function buildItemInfo(
  defs: Defs,
  itemHash: number,
  instance?: ItemInstanceData
): ItemInfo | null {
  const def = defs.items[itemHash];
  if (!def) return null;

  const isWeapon = def.itemType === ITEM_TYPE_WEAPON;
  const isArmor = def.itemType === ITEM_TYPE_ARMOR;
  const state = instance?.state ?? 0;

  const damageHash = instance?.damageTypeHash ?? def.defaultDamageTypeHash;
  const damage = damageHash ? defs.damageTypes?.[damageHash] : undefined;

  const bucket = def.inventory?.bucketTypeHash;
  const slotName = bucket
    ? (WEAPON_BUCKETS[bucket] ??
      ARMOR_BUCKETS[bucket] ??
      defs.buckets?.[bucket]?.displayProperties?.name)
    : undefined;

  /*
   * L'énergie consommée se recompose en additionnant les mods posés : selon
   * les composants demandés, Bungie renvoie `energyUsed` ou ne le renvoie pas.
   */
  let energyUsed = instance?.energyUsed ?? 0;
  if (!energyUsed && instance?.sockets) {
    for (const s of instance.sockets) {
      if (!s.plugHash) continue;
      energyUsed += defs.items[s.plugHash]?.plug?.energyCost?.energyCost ?? 0;
    }
  }

  const perks = isWeapon
    ? plugsOfCategory(
        defs,
        itemHash,
        SOCKET_CATEGORY_WEAPON_PERKS,
        instance?.sockets
      )
    : [];
  const mods = plugsOfCategory(
    defs,
    itemHash,
    isWeapon ? SOCKET_CATEGORY_WEAPON_MODS : SOCKET_CATEGORY_ARMOR_MODS,
    instance?.sockets
  );

  const ammo = def.equippingBlock?.ammoType;
  const classBound =
    (isArmor || def.itemType === ITEM_TYPE_SUBCLASS) && def.classType !== 3;

  return {
    itemHash,
    name: def.displayProperties?.name ?? "Objet",
    icon: def.displayProperties?.icon,
    watermark: def.iconWatermark,
    screenshot: def.screenshot,
    flavorText: def.flavorText || undefined,
    description: def.displayProperties?.description || undefined,
    subtitle:
      def.itemTypeAndTierDisplayName ||
      [def.inventory?.tierTypeName, def.itemTypeDisplayName]
        .filter(Boolean)
        .join(" "),
    typeName: def.itemTypeDisplayName ?? "",
    tierName: def.inventory?.tierTypeName ?? "",
    isExotic: def.inventory?.tierType === TIER_EXOTIC,
    slotName,
    classLabel: classBound ? CLASS_LABELS[def.classType] : undefined,
    ammoLabel: ammo ? AMMO_NAMES[ammo] : undefined,
    power: instance?.primaryStat ?? 0,
    damageName: damage?.displayProperties?.name,
    damageIcon: damage?.displayProperties?.icon,
    energyCapacity: instance?.energyCapacity ?? 0,
    energyUsed,
    isMasterwork: (state & ITEM_STATE_MASTERWORK) !== 0,
    isCrafted: (state & ITEM_STATE_CRAFTED) !== 0,
    isLocked: (state & ITEM_STATE_LOCKED) !== 0,
    isWeapon,
    isArmor,
    stats: statsOf(defs, itemHash, isArmor, instance),
    perks,
    mods,
    quantity: instance?.quantity,
    hasInstance: Boolean(
      instance?.stats || instance?.sockets || instance?.primaryStat
    ),
  };
}

/**
 * L'instance telle que le profil déjà chargé la décrit.
 *
 * Une page qui tient le profil en mémoire n'a aucune raison de redemander un
 * objet à Bungie pour l'inspecter : tout est là, selon les composants qu'elle
 * a demandés (300 puissance, 304 stats, 305 emplacements).
 */
export function instanceFromProfile(
  profile: ProfileResponse | null | undefined,
  instanceId: string | undefined,
  state?: number
): ItemInstanceData | undefined {
  if (!profile || !instanceId) return undefined;
  const components = profile.itemComponents;
  const inst = components?.instances?.data?.[instanceId];
  return {
    primaryStat: inst?.primaryStat?.value,
    damageTypeHash: inst?.damageTypeHash,
    energyCapacity: inst?.energy?.energyCapacity,
    energyUsed: inst?.energy?.energyUsed,
    stats: components?.stats?.data?.[instanceId]?.stats,
    sockets: components?.sockets?.data?.[instanceId]?.sockets,
    state,
  };
}

/** Somme des stats d'armure : le chiffre que l'on compare d'une pièce à l'autre. */
export function armorTotal(info: ItemInfo): number {
  return info.stats
    .filter((s) => ARMOR_STAT_HASHES.includes(s.hash))
    .reduce((a, s) => a + s.value, 0);
}
