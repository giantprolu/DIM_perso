/** Types pragmatiques (sous-ensemble de l'API Bungie réellement utilisé). */

export interface DisplayProperties {
  name: string;
  description: string;
  icon?: string;
  hasIcon?: boolean;
}

export interface ItemDef {
  hash: number;
  displayProperties: DisplayProperties;
  itemType: number;
  itemTypeDisplayName?: string;
  classType: number; // 0 Titan, 1 Chasseur, 2 Arcaniste, 3 Tous
  inventory?: {
    bucketTypeHash: number;
    tierType: number;
    tierTypeName?: string;
  };
  setData?: {
    itemList?: { itemHash: number }[];
    questLineName?: string;
  };
  objectives?: { objectiveHashes?: number[] };
  redacted?: boolean;
}

export interface ObjectiveDef {
  hash: number;
  progressDescription?: string;
  completionValue?: number;
}

export interface StatDef {
  hash: number;
  displayProperties: DisplayProperties;
  index?: number;
}

export interface ClassDef {
  hash: number;
  displayProperties: DisplayProperties;
  classType: number;
}

export interface BucketDef {
  hash: number;
  displayProperties: DisplayProperties;
}

export interface Defs {
  items: Record<string, ItemDef>;
  objectives: Record<string, ObjectiveDef>;
  stats: Record<string, StatDef>;
  classes: Record<string, ClassDef>;
  buckets: Record<string, BucketDef>;
}

// ---- Profil ----

export interface ProfileItem {
  itemHash: number;
  itemInstanceId?: string;
  bucketHash: number;
  quantity: number;
  state?: number;
  expirationDate?: string;
}

export interface ObjectiveProgress {
  objectiveHash: number;
  progress?: number;
  completionValue: number;
  complete: boolean;
  visible?: boolean;
}

export interface Character {
  characterId: string;
  classType: number;
  classHash: number;
  light: number;
  emblemPath?: string;
  emblemBackgroundPath?: string;
  dateLastPlayed: string;
}

export interface ProfileResponse {
  characters?: { data?: Record<string, Character> };
  characterInventories?: { data?: Record<string, { items: ProfileItem[] }> };
  characterEquipment?: { data?: Record<string, { items: ProfileItem[] }> };
  profileInventory?: { data?: { items: ProfileItem[] } };
  itemComponents?: {
    objectives?: {
      data?: Record<string, { objectives: ObjectiveProgress[] }>;
    };
    stats?: {
      data?: Record<
        string,
        { stats: Record<string, { statHash: number; value: number }> }
      >;
    };
    instances?: {
      data?: Record<
        string,
        { primaryStat?: { value: number }; energy?: { energyCapacity: number } }
      >;
    };
  };
  characterUninstancedItemComponents?: Record<
    string,
    { objectives?: { data?: Record<string, { objectives: ObjectiveProgress[] }> } }
  >;
}

export interface SessionInfo {
  loggedIn: boolean;
  displayName?: string;
}
