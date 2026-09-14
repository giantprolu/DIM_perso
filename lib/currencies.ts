import type { Defs, ProfileItem, ProfileResponse } from "./types";

/**
 * Les monnaies et matériaux du compte.
 *
 * Bungie en épingle une poignée (composant 103 « ProfileCurrencies » :
 * éclats, poussière lumineuse…) mais tout le reste — noyaux d'amélioration,
 * prismes, fragments ascendants, matériaux planétaires — vit dans le coffre
 * comme n'importe quel objet. Pour donner la vue complète, on réunit les deux
 * et on ne garde que ce que le jeu classe comme monnaie ou matériau
 * d'échange, plutôt que d'entretenir une liste de hashs qui vieillit à chaque
 * saison.
 */

/** DestinyItemType.Currency — l'éclat, et ce que le jeu traite comme tel. */
const ITEM_TYPE_CURRENCY = 1;
/** DestinyItemType.ExchangeMaterial — tout ce qui s'échange chez un marchand. */
const ITEM_TYPE_EXCHANGE_MATERIAL = 10;

export interface CurrencyRow {
  itemHash: number;
  name: string;
  icon?: string;
  quantity: number;
  /** true quand Bungie la met lui-même en avant (composant 103) */
  pinned: boolean;
}

function isCurrencyItem(defs: Defs, itemHash: number): boolean {
  const type = defs.items?.[itemHash]?.itemType;
  return type === ITEM_TYPE_CURRENCY || type === ITEM_TYPE_EXCHANGE_MATERIAL;
}

/** Les seules devises que Bungie épingle, dans son ordre (composant 103). */
export function pinnedCurrencies(
  defs: Defs,
  profile: ProfileResponse
): CurrencyRow[] {
  const out: CurrencyRow[] = [];
  for (const item of profile.profileCurrencies?.data?.items ?? []) {
    const name = defs.items?.[item.itemHash]?.displayProperties?.name;
    if (!name) continue;
    out.push({
      itemHash: item.itemHash,
      name,
      icon: defs.items?.[item.itemHash]?.displayProperties?.icon,
      quantity: item.quantity,
      pinned: true,
    });
  }
  return out;
}

/**
 * Toutes les monnaies détenues : celles qu'épingle Bungie d'abord, puis les
 * matériaux du coffre et des personnages, de la plus abondante à la plus rare.
 *
 * Un même matériau peut apparaître à plusieurs endroits (coffre et sacs) : les
 * quantités s'additionnent, comme le jeu les compte.
 */
export function allCurrencies(
  defs: Defs,
  profile: ProfileResponse
): CurrencyRow[] {
  const pinned = pinnedCurrencies(defs, profile);
  const pinnedHashes = new Set(pinned.map((c) => c.itemHash));

  const stacks = new Map<number, number>();
  const add = (items: ProfileItem[] | undefined) => {
    for (const i of items ?? []) {
      if (pinnedHashes.has(i.itemHash)) continue;
      if (!isCurrencyItem(defs, i.itemHash)) continue;
      stacks.set(i.itemHash, (stacks.get(i.itemHash) ?? 0) + (i.quantity ?? 1));
    }
  };
  add(profile.profileInventory?.data?.items);
  for (const inv of Object.values(profile.characterInventories?.data ?? {})) {
    add(inv.items);
  }

  const rest: CurrencyRow[] = [];
  for (const [itemHash, quantity] of stacks) {
    const def = defs.items?.[itemHash];
    const name = def?.displayProperties?.name;
    if (!name || quantity <= 0) continue;
    rest.push({
      itemHash,
      name,
      icon: def?.displayProperties?.icon,
      quantity,
      pinned: false,
    });
  }
  rest.sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));

  return [...pinned, ...rest];
}

/**
 * Forme courte d'une quantité : les éclats se comptent par centaines de
 * milliers, le chiffre exact n'apprend rien de plus que « 218 k ».
 */
export function shortQuantity(n: number): string {
  if (n < 10_000) return n.toLocaleString("fr-FR");
  if (n < 1_000_000) return `${Math.floor(n / 1000)} k`;
  return `${(n / 1_000_000).toFixed(1).replace(".", ",")} M`;
}
