import {
  ARMOR_BUCKETS,
  ARMOR_STAT_HASHES,
  ITEM_TYPE_ARMOR,
  ITEM_TYPE_WEAPON,
  TIER_EXOTIC,
  TIER_LEGENDARY,
} from "./destiny-constants";
import type {
  Defs,
  ProfileItem,
  ProfileResponse,
  VendorSaleItem,
  VendorsResponse,
} from "./types";

/**
 * Moteur des marchands.
 *
 * Objectif : ne pas déverser un catalogue, mais répondre à « qu'est-ce qui
 * vaut le détour aujourd'hui, et pourquoi ». Chaque objet en vente reçoit un
 * score et surtout des raisons lisibles ; l'affichage se contente de les
 * restituer.
 */

/** État d'une vente : 0 = disponible à l'achat. */
const SALE_AVAILABLE = 0;
/** DestinyCollectibleState : bit 1 = non acquis. */
const COLLECTIBLE_NOT_ACQUIRED = 1;

export interface Reason {
  /** Étiquette courte affichée en badge */
  label: string;
  /** Couleur daisyUI du badge */
  tone: "primary" | "warning" | "info" | "success";
  /** Poids dans le score */
  weight: number;
}

export interface VendorOffer {
  key: string;
  vendorHash: number;
  vendorName: string;
  vendorIcon?: string;
  /** Lieu où trouver le marchand aujourd'hui */
  location: string;
  itemHash: number;
  name: string;
  icon?: string;
  typeName: string;
  tierType: number;
  isExotic: boolean;
  /** Total des 6 stats d'armure, si c'en est une */
  statTotal: number;
  stats: number[];
  slotName?: string;
  costs: {
    itemHash: number;
    name: string;
    icon?: string;
    quantity: number;
    owned: number;
    affordable: boolean;
  }[];
  affordable: boolean;
  reasons: Reason[];
  score: number;
  /** Date de rotation du stock */
  refreshDate?: string;
}

export interface VendorSummary {
  hash: number;
  name: string;
  icon?: string;
  location: string;
  refreshDate?: string;
  offerCount: number;
  bestScore: number;
}

/** Combien tu possèdes de chaque devise/matériau. */
function buildOwnedCurrencies(profile: ProfileResponse): Map<number, number> {
  const owned = new Map<number, number>();
  const add = (items: ProfileItem[] | undefined) => {
    for (const i of items ?? []) {
      owned.set(i.itemHash, (owned.get(i.itemHash) ?? 0) + (i.quantity ?? 1));
    }
  };
  add(profile.profileCurrencies?.data?.items);
  add(profile.profileInventory?.data?.items);
  for (const inv of Object.values(profile.characterInventories?.data ?? {})) {
    add(inv.items);
  }
  return owned;
}

/** Meilleur total de stats déjà possédé, par emplacement d'armure et classe. */
function buildBestOwnedArmor(
  defs: Defs,
  profile: ProfileResponse,
  classType: number
): Map<number, number> {
  const best = new Map<number, number>();
  const stats = profile.itemComponents?.stats?.data ?? {};
  const all: ProfileItem[] = [
    ...(profile.profileInventory?.data?.items ?? []),
    ...Object.values(profile.characterInventories?.data ?? {}).flatMap(
      (i) => i.items
    ),
    ...Object.values(profile.characterEquipment?.data ?? {}).flatMap(
      (i) => i.items
    ),
  ];
  for (const item of all) {
    if (!item.itemInstanceId) continue;
    const def = defs.items[item.itemHash];
    if (!def || def.itemType !== ITEM_TYPE_ARMOR) continue;
    if (def.classType !== classType) continue;
    const slot = def.inventory?.bucketTypeHash ?? 0;
    if (!(slot in ARMOR_BUCKETS)) continue;
    const s = stats[item.itemInstanceId]?.stats;
    if (!s) continue;
    const total = ARMOR_STAT_HASHES.reduce(
      (a, h) => a + (s[String(h)]?.value ?? 0),
      0
    );
    best.set(slot, Math.max(best.get(slot) ?? 0, total));
  }
  return best;
}

/** Objets déjà débloqués dans les collections. */
function isAlreadyOwned(
  defs: Defs,
  profile: ProfileResponse,
  itemHash: number
): boolean | null {
  const collectibleHash = defs.items[itemHash]?.collectibleHash;
  if (!collectibleHash) return null; // pas suivi par les collections
  const state =
    profile.profileCollectibles?.data?.collectibles?.[String(collectibleHash)]
      ?.state;
  if (state === undefined) return null;
  return (state & COLLECTIBLE_NOT_ACQUIRED) === 0;
}

/** Lieu où se trouve le marchand aujourd'hui. */
export function vendorLocation(
  defs: Defs,
  vendorHash: number,
  locationIndex: number | undefined
): string {
  const vendorDef = defs.vendors?.[vendorHash];
  const locations = vendorDef?.locations ?? [];
  if (locations.length === 0) return "Lieu inconnu";
  const loc = locations[locationIndex ?? 0] ?? locations[0];
  const dest = defs.destinations?.[loc.destinationHash];
  const destName = dest?.displayProperties?.name;
  const placeName = dest?.placeHash
    ? defs.places?.[dest.placeHash]?.displayProperties?.name
    : undefined;
  if (destName && placeName && destName !== placeName) {
    return `${destName}, ${placeName}`;
  }
  return destName || placeName || "Lieu inconnu";
}

export interface AnalyzeResult {
  offers: VendorOffer[];
  vendors: VendorSummary[];
}

export function analyzeVendors(opts: {
  defs: Defs;
  profile: ProfileResponse;
  vendorsData: VendorsResponse;
  classType: number;
  /** Puissance d'équipement actuelle, pour juger un objet « au-dessus » */
  currentPower: number;
}): AnalyzeResult {
  const { defs, profile, vendorsData, classType, currentPower } = opts;

  const owned = buildOwnedCurrencies(profile);
  const bestArmor = buildBestOwnedArmor(defs, profile, classType);

  const offers: VendorOffer[] = [];
  const vendorMap = new Map<number, VendorSummary>();

  const vendorComponents = vendorsData.vendors?.data ?? {};
  const salesData = vendorsData.sales?.data ?? {};

  for (const [vendorHashStr, sales] of Object.entries(salesData)) {
    const vendorHash = Number(vendorHashStr);
    const vendorDef = defs.vendors?.[vendorHash];
    if (!vendorDef || vendorDef.visible === false) continue;
    const vendorName = vendorDef.displayProperties?.name;
    if (!vendorName) continue;

    const component = vendorComponents[vendorHashStr];
    if (component?.enabled === false) continue;

    const location = vendorLocation(
      defs,
      vendorHash,
      component?.vendorLocationIndex
    );

    for (const sale of Object.values(sales.saleItems ?? {})) {
      const offer = buildOffer({
        defs,
        profile,
        vendorsData,
        sale,
        vendorHash,
        vendorName,
        vendorIcon: vendorDef.displayProperties?.icon,
        location,
        refreshDate: component?.nextRefreshDate,
        owned,
        bestArmor,
        classType,
        currentPower,
      });
      if (offer) offers.push(offer);
    }

    const summary = vendorMap.get(vendorHash);
    if (!summary) {
      vendorMap.set(vendorHash, {
        hash: vendorHash,
        name: vendorName,
        icon: vendorDef.displayProperties?.icon,
        location,
        refreshDate: component?.nextRefreshDate,
        offerCount: 0,
        bestScore: 0,
      });
    }
  }

  for (const offer of offers) {
    const summary = vendorMap.get(offer.vendorHash);
    if (summary) {
      summary.offerCount++;
      summary.bestScore = Math.max(summary.bestScore, offer.score);
    }
  }

  offers.sort((a, b) => b.score - a.score);
  const vendors = [...vendorMap.values()]
    .filter((v) => v.offerCount > 0)
    .sort((a, b) => b.bestScore - a.bestScore);

  return { offers, vendors };
}

function buildOffer(ctx: {
  defs: Defs;
  profile: ProfileResponse;
  vendorsData: VendorsResponse;
  sale: VendorSaleItem;
  vendorHash: number;
  vendorName: string;
  vendorIcon?: string;
  location: string;
  refreshDate?: string;
  owned: Map<number, number>;
  bestArmor: Map<number, number>;
  classType: number;
  currentPower: number;
}): VendorOffer | null {
  const {
    defs,
    profile,
    vendorsData,
    sale,
    vendorHash,
    vendorName,
    vendorIcon,
    location,
    refreshDate,
    owned,
    bestArmor,
    classType,
    currentPower,
  } = ctx;

  if (sale.saleStatus !== SALE_AVAILABLE) return null;
  const def = defs.items[sale.itemHash];
  if (!def || def.redacted) return null;
  const name = def.displayProperties?.name;
  if (!name) return null;

  const itemType = def.itemType;
  const isGear = itemType === ITEM_TYPE_WEAPON || itemType === ITEM_TYPE_ARMOR;
  const tierType = def.inventory?.tierType ?? 0;

  // On ne retient que l'équipement intéressant : le consommable courant
  // (matériaux, munitions) n'aide pas à décider.
  if (!isGear) return null;
  if (tierType < TIER_LEGENDARY) return null;
  // Armure d'une autre classe : sans objet
  if (itemType === ITEM_TYPE_ARMOR && def.classType !== classType) return null;

  const isExotic = tierType === TIER_EXOTIC;
  const slot = def.inventory?.bucketTypeHash ?? 0;

  // Stats de l'exemplaire réellement proposé (le roll du marchand)
  const itemStats =
    vendorsData.itemComponents?.[String(vendorHash)]?.stats?.data?.[
      String(sale.vendorItemIndex)
    ]?.stats ?? {};
  const stats = ARMOR_STAT_HASHES.map(
    (h) => itemStats[String(h)]?.value ?? 0
  );
  const statTotal = stats.reduce((a, v) => a + v, 0);

  const power =
    vendorsData.itemComponents?.[String(vendorHash)]?.instances?.data?.[
      String(sale.vendorItemIndex)
    ]?.primaryStat?.value ?? 0;

  // Coûts, et est-ce que tu peux te le payer ?
  const costs = (sale.costs ?? [])
    .filter((c) => c.quantity > 0)
    .map((c) => {
      const costDef = defs.items[c.itemHash];
      const have = owned.get(c.itemHash) ?? 0;
      return {
        itemHash: c.itemHash,
        name: costDef?.displayProperties?.name ?? "Devise",
        icon: costDef?.displayProperties?.icon,
        quantity: c.quantity,
        owned: have,
        affordable: have >= c.quantity,
      };
    });
  const affordable = costs.every((c) => c.affordable);

  // ── Raisons ──
  const reasons: Reason[] = [];
  const alreadyOwned = isAlreadyOwned(defs, profile, sale.itemHash);

  if (alreadyOwned === false) {
    reasons.push({
      label: isExotic ? "Exotique jamais obtenu" : "Nouveau pour toi",
      tone: "primary",
      weight: isExotic ? 60 : 35,
    });
  }

  if (itemType === ITEM_TYPE_ARMOR && statTotal > 0) {
    const best = bestArmor.get(slot) ?? 0;
    if (best > 0 && statTotal > best) {
      reasons.push({
        label: `Meilleur que ton armure (${statTotal} vs ${best})`,
        tone: "success",
        weight: 40 + Math.min(30, statTotal - best),
      });
    } else if (statTotal >= 60) {
      reasons.push({
        label: `Bon roll — ${statTotal} de stats`,
        tone: "info",
        weight: 20,
      });
    }
  }

  if (power > 0 && currentPower > 0 && power > currentPower) {
    reasons.push({
      label: `✦ ${power} — au-dessus de ton niveau`,
      tone: "warning",
      weight: 25,
    });
  }

  if (isExotic && alreadyOwned !== false) {
    reasons.push({ label: "Exotique", tone: "warning", weight: 12 });
  }

  if (reasons.length > 0 && affordable) {
    reasons.push({ label: "Tu peux te le payer", tone: "success", weight: 8 });
  } else if (reasons.length > 0 && !affordable) {
    reasons.push({ label: "Devise insuffisante", tone: "info", weight: -15 });
  }

  // Sans raison, l'objet ne mérite pas d'être poussé en avant
  if (reasons.length === 0) return null;

  const score = reasons.reduce((a, r) => a + r.weight, 0);

  return {
    key: `${vendorHash}-${sale.vendorItemIndex}`,
    vendorHash,
    vendorName,
    vendorIcon,
    location,
    itemHash: sale.itemHash,
    name,
    icon: def.displayProperties?.icon,
    typeName: def.itemTypeDisplayName ?? "",
    tierType,
    isExotic,
    statTotal,
    stats,
    slotName: ARMOR_BUCKETS[slot],
    costs,
    affordable,
    reasons: reasons.sort((a, b) => b.weight - a.weight),
    score,
    refreshDate,
  };
}
