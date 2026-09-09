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
  defaultDamageTypeHash?: number;
  screenshot?: string;
  flavorText?: string;
  collectibleHash?: number;
  setData?: {
    itemList?: { itemHash: number }[];
    questLineName?: string;
  };
  objectives?: { objectiveHashes?: number[] };
  plug?: {
    plugCategoryIdentifier?: string;
    energyCost?: { energyCost: number; energyTypeHash?: number };
  };
  investmentStats?: {
    statTypeHash: number;
    value: number;
    isConditionallyActive?: boolean;
  }[];
  sockets?: {
    socketCategories?: { socketCategoryHash: number; socketIndexes: number[] }[];
    socketEntries?: {
      socketTypeHash?: number;
      singleInitialItemHash?: number;
      reusablePlugSetHash?: number;
      randomizedPlugSetHash?: number;
    }[];
  };
  redacted?: boolean;
}

export interface PlugSetDef {
  hash: number;
  reusablePlugItems?: { plugItemHash: number }[];
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

export interface DamageTypeDef {
  hash: number;
  displayProperties: DisplayProperties;
}

export interface RecordDef {
  hash: number;
  displayProperties: DisplayProperties;
  /** Sceaux : le titre porté, décliné par genre */
  titleInfo?: { titlesByGender?: Record<string, string> };
  redacted?: boolean;
}

export interface PresentationNodeDef {
  hash: number;
  displayProperties: DisplayProperties;
  children?: {
    presentationNodes?: { presentationNodeHash: number }[];
    records?: { recordHash: number }[];
  };
  redacted?: boolean;
}

export interface SeasonDef {
  hash: number;
  displayProperties: DisplayProperties;
  seasonNumber?: number;
  seasonalChallengesPresentationNodeHash?: number;
  startDate?: string;
  endDate?: string;
  /**
   * Une saison peut enchaîner plusieurs pass (un par acte). Les dates
   * délimitent celui qui est actif ; `seasonPassProgressionHash` est resté
   * à 0 depuis que Bungie a introduit cette liste.
   */
  seasonPassList?: {
    seasonPassHash: number;
    seasonPassStartDate?: string;
    seasonPassEndDate?: string;
  }[];
  seasonPassProgressionHash?: number;
}

/** Un pass de saison : sa piste de récompenses et sa piste de prestige. */
export interface SeasonPassDef {
  hash: number;
  displayProperties?: DisplayProperties;
  rewardProgressionHash?: number;
  prestigeProgressionHash?: number;
}

export interface LoadoutNameDef {
  hash: number;
  name?: string;
  index?: number;
}

export interface LoadoutIconDef {
  hash: number;
  iconImagePath?: string;
  index?: number;
}

export interface LoadoutColorDef {
  hash: number;
  colorImagePath?: string;
  index?: number;
}

export interface LoadoutConstantsDef {
  hash: number;
  loadoutCountPerCharacter?: number;
}

export interface VendorDef {
  hash: number;
  displayProperties?: {
    name?: string;
    description?: string;
    icon?: string;
    subtitle?: string;
    largeIcon?: string;
  };
  vendorPortrait?: string;
  vendorBanner?: string;
  enabled?: boolean;
  visible?: boolean;
  locations?: { destinationHash: number; backgroundImagePath?: string }[];
  displayItemHash?: number;
}

export interface DestinationDef {
  hash: number;
  displayProperties?: { name?: string; description?: string };
  placeHash?: number;
}

export interface PlaceDef {
  hash: number;
  displayProperties?: { name?: string };
}

export interface ActivityDef {
  hash: number;
  displayProperties: DisplayProperties;
  pgcrImage?: string;
  activityTypeHash?: number;
  activityModeHashes?: number[];
  destinationHash?: number;
  placeHash?: number;
}

export interface ActivityModeDef {
  hash: number;
  displayProperties: DisplayProperties;
  modeType?: number;
}

export interface RaceDef {
  hash: number;
  displayProperties: DisplayProperties;
  genderedRaceNames?: Record<string, string>;
}

export interface GuardianRankDef {
  hash: number;
  displayProperties: DisplayProperties;
  rankNumber: number;
  presentationNodeHash?: number;
}

/** Un jalon : activité hebdomadaire, quête à étapes, événement. */
export interface MilestoneDef {
  hash: number;
  displayProperties?: DisplayProperties;
  image?: string;
  /** 0 inconnu, 1 tutoriel, 2 unique, 3 hebdomadaire, 4 quotidien, 5 spécial */
  milestoneType?: number;
  friendlyName?: string;
  showInMilestones?: boolean;
  isInGameMilestone?: boolean;
  hasPredictableDates?: boolean;
  quests?: Record<
    string,
    { displayProperties?: DisplayProperties; overrideImage?: string }
  >;
  rewards?: Record<
    string,
    {
      categoryHash: number;
      displayProperties?: DisplayProperties;
      rewardEntries?: Record<
        string,
        { rewardEntryHash: number; displayProperties?: DisplayProperties }
      >;
    }
  >;
  redacted?: boolean;
}

/** Un rang de réputation (Avant-garde, Creuset, saison…). */
export interface ProgressionDef {
  hash: number;
  displayProperties?: DisplayProperties;
  /** 0 compte, 1 personnage, 2 clan… (DestinyProgressionScope) */
  scope?: number;
  repeatLastStep?: boolean;
  factionHash?: number;
  rankIcon?: string;
  steps?: { stepName?: string; progressTotal?: number; icon?: string }[];
  visible?: boolean;
  redacted?: boolean;
}

export interface FactionDef {
  hash: number;
  displayProperties?: DisplayProperties;
  progressionHash?: number;
}

/** Modificateur d'activité (« Brûlure solaire », « Champions »…). */
export interface ActivityModifierDef {
  hash: number;
  displayProperties?: DisplayProperties;
  displayInActivitySelection?: boolean;
  displayInNavMode?: boolean;
}

export interface ArtifactDef {
  hash: number;
  displayProperties?: DisplayProperties;
}

export interface Defs {
  items: Record<string, ItemDef>;
  objectives: Record<string, ObjectiveDef>;
  stats: Record<string, StatDef>;
  classes: Record<string, ClassDef>;
  buckets: Record<string, BucketDef>;
  damageTypes: Record<string, DamageTypeDef>;
  records: Record<string, RecordDef>;
  nodes: Record<string, PresentationNodeDef>;
  seasons: Record<string, SeasonDef>;
  seasonPasses: Record<string, SeasonPassDef>;
  guardianRanks: Record<string, GuardianRankDef>;
  plugSets: Record<string, PlugSetDef>;
  loadoutNames: Record<string, LoadoutNameDef>;
  loadoutIcons: Record<string, LoadoutIconDef>;
  loadoutColors: Record<string, LoadoutColorDef>;
  loadoutConstants: Record<string, LoadoutConstantsDef>;
  vendors: Record<string, VendorDef>;
  destinations: Record<string, DestinationDef>;
  places: Record<string, PlaceDef>;
  activities: Record<string, ActivityDef>;
  activityModes: Record<string, ActivityModeDef>;
  races: Record<string, RaceDef>;
  milestones: Record<string, MilestoneDef>;
  progressions: Record<string, ProgressionDef>;
  factions: Record<string, FactionDef>;
  activityModifiers: Record<string, ActivityModifierDef>;
  artifacts: Record<string, ArtifactDef>;
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

export interface RecordComponent {
  state: number;
  objectives?: ObjectiveProgress[];
  intervalObjectives?: ObjectiveProgress[];
}

export interface Character {
  characterId: string;
  classType: number;
  classHash: number;
  light: number;
  /** Valeurs par hash de stat (les 6 stats d'armure + puissance) */
  stats?: Record<string, number>;
  emblemPath?: string;
  emblemBackgroundPath?: string;
  dateLastPlayed: string;
  raceHash?: number;
  genderHash?: number;
  genderType?: number;
  baseCharacterLevel?: number;
  minutesPlayedTotal?: string;
  minutesPlayedThisSession?: string;
  /** Sceau porté (DestinyRecordDefinition.titleInfo) */
  titleRecordHash?: number;
}

/** Ce que fait un personnage en ce moment (composant 204). */
export interface CharacterActivities {
  currentActivityHash?: number;
  currentActivityModeHash?: number;
  currentActivityModeType?: number;
  currentPlaylistActivityHash?: number;
  dateActivityStarted?: string;
}

export interface InGameLoadoutItem {
  itemInstanceId?: string;
  plugItemHashes?: number[];
}

export interface InGameLoadout {
  colorHash: number;
  iconHash: number;
  nameHash: number;
  items?: InGameLoadoutItem[];
}

export interface PlugSetsComponent {
  plugs?: Record<string, AvailablePlug[]>;
}

export interface ItemQuantity {
  itemHash: number;
  quantity: number;
}

export interface VendorSaleItem {
  vendorItemIndex: number;
  itemHash: number;
  quantity: number;
  saleStatus: number;
  costs?: ItemQuantity[];
  apiPurchasable?: boolean;
  overrideNextRefreshDate?: string;
}

export interface VendorComponent {
  vendorHash: number;
  vendorLocationIndex?: number;
  nextRefreshDate?: string;
  enabled?: boolean;
  canPurchase?: boolean;
  progression?: {
    progressionHash?: number;
    level?: number;
    progressToNextLevel?: number;
    nextLevelAt?: number;
  };
}

export interface VendorsResponse {
  vendors?: { data?: Record<string, VendorComponent> };
  sales?: {
    data?: Record<string, { saleItems?: Record<string, VendorSaleItem> }>;
  };
  itemComponents?: Record<
    string,
    {
      instances?: {
        data?: Record<
          string,
          {
            primaryStat?: { value: number };
            damageTypeHash?: number;
            energy?: { energyCapacity?: number; energyUsed?: number };
          }
        >;
      };
      stats?: {
        data?: Record<
          string,
          { stats?: Record<string, { statHash: number; value: number }> }
        >;
      };
      sockets?: { data?: Record<string, { sockets: SocketState[] }> };
    }
  >;
  error?: string;
}

export interface SocketState {
  plugHash?: number;
  isEnabled?: boolean;
  isVisible?: boolean;
}

/** Une option de mod proposée par Bungie pour un emplacement donné. */
export interface AvailablePlug {
  plugItemHash: number;
  canInsert?: boolean;
  enabled?: boolean;
}

export interface ProfileResponse {
  profile?: {
    data?: {
      currentSeasonHash?: number;
      currentGuardianRank?: number;
      lifetimeHighestGuardianRank?: number;
      dateLastPlayed?: string;
      characterIds?: string[];
      userInfo?: {
        membershipId?: string;
        membershipType?: number;
        displayName?: string;
        bungieGlobalDisplayName?: string;
        bungieGlobalDisplayNameCode?: number;
        iconPath?: string;
        crossSaveOverride?: number;
        applicableMembershipTypes?: number[];
      };
    };
    privacy?: number;
  };
  characters?: { data?: Record<string, Character>; privacy?: number };
  characterActivities?: {
    data?: Record<string, CharacterActivities>;
    privacy?: number;
  };
  characterInventories?: { data?: Record<string, { items: ProfileItem[] }> };
  characterEquipment?: {
    data?: Record<string, { items: ProfileItem[] }>;
    privacy?: number;
  };
  profileInventory?: { data?: { items: ProfileItem[] } };
  profileRecords?: {
    data?: {
      records?: Record<string, RecordComponent>;
      /** Triomphe suivi dans le HUD, quand le joueur en a choisi un */
      trackedRecordHash?: number;
    };
  };
  profileCollectibles?: {
    data?: { collectibles?: Record<string, { state: number }> };
  };
  profileCurrencies?: { data?: { items: ProfileItem[] } };
  /** Plugs débloqués au niveau du compte (livrés avec le composant 305) */
  profilePlugSets?: { data?: PlugSetsComponent };
  /** Plugs débloqués par personnage */
  characterPlugSets?: { data?: Record<string, PlugSetsComponent> };
  characterLoadouts?: {
    data?: Record<string, { loadouts?: InGameLoadout[] }>;
  };
  characterRecords?: {
    data?: Record<string, { records?: Record<string, RecordComponent> }>;
  };
  /** Artefact saisonnier vu du compte (composant 104) */
  profileProgression?: { data?: { seasonalArtifact?: SeasonalArtifact } };
  /** Jalons, réputations et artefact, par personnage (composant 202) */
  characterProgressions?: { data?: Record<string, CharacterProgressions> };
  /**
   * Valeurs des variables citées par les libellés (composant 1200).
   * Sans elles, un objectif s'affiche « Éliminez {var:123} ennemis ».
   */
  profileStringVariables?: {
    data?: { integerValuesByHash?: Record<string, number> };
  };
  characterStringVariables?: {
    data?: Record<string, { integerValuesByHash?: Record<string, number> }>;
  };
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
        {
          primaryStat?: { value: number };
          damageTypeHash?: number;
          energy?: { energyCapacity: number; energyUsed?: number };
        }
      >;
    };
    sockets?: {
      data?: Record<string, { sockets: SocketState[] }>;
    };
    reusablePlugs?: {
      data?: Record<string, { plugs?: Record<string, AvailablePlug[]> }>;
    };
  };
  characterUninstancedItemComponents?: Record<
    string,
    { objectives?: { data?: Record<string, { objectives: ObjectiveProgress[] }> } }
  >;
}

// ---- Progression (composants 104 / 202 / 1200) ----

/** Un rang en cours : niveau atteint et progression vers le suivant. */
export interface ProgressionState {
  progressionHash: number;
  level: number;
  levelCap?: number;
  stepIndex?: number;
  progressToNextLevel?: number;
  nextLevelAt?: number;
  currentProgress?: number;
  weeklyProgress?: number;
  weeklyLimit?: number;
  dailyProgress?: number;
  currentResetCount?: number;
  seasonResets?: { season: number; resets: number }[];
}

/** Artefact saisonnier : les points gagnés et le bonus de puissance qu'il donne. */
export interface SeasonalArtifact {
  artifactHash: number;
  pointsAcquired?: number;
  powerBonus?: number;
  pointProgression?: ProgressionState;
  powerBonusProgression?: ProgressionState;
}

export interface MilestoneActivityState {
  activityHash: number;
  challenges?: { objective: ObjectiveProgress }[];
  modifierHashes?: number[];
  phases?: { phaseHash: number; complete: boolean }[];
  booleanActivityOptions?: Record<string, boolean>;
}

export interface MilestoneQuestState {
  questItemHash: number;
  status?: {
    questHash: number;
    stepHash?: number;
    stepObjectives?: ObjectiveProgress[];
    completed?: boolean;
    redeemed?: boolean;
    started?: boolean;
    tracked?: boolean;
  };
  activity?: MilestoneActivityState;
  challenges?: { objective: ObjectiveProgress }[];
}

/** Un jalon tel que le personnage le vit : progression et récompenses. */
export interface MilestoneState {
  milestoneHash: number;
  availableQuests?: MilestoneQuestState[];
  activities?: MilestoneActivityState[];
  rewards?: {
    rewardCategoryHash: number;
    entries?: { rewardEntryHash: number; earned: boolean; redeemed: boolean }[];
  }[];
  values?: Record<string, number>;
  startDate?: string;
  endDate?: string;
  order?: number;
}

/** La rotation publique, identique pour tout le monde (GetPublicMilestones). */
export interface PublicMilestone {
  milestoneHash: number;
  activities?: {
    activityHash: number;
    modifierHashes?: number[];
    challengeObjectiveHashes?: number[];
    loadoutRequirementIndex?: number;
  }[];
  availableQuests?: { questItemHash: number }[];
  startDate?: string;
  endDate?: string;
  order?: number;
}

export interface CharacterProgressions {
  progressions?: Record<string, ProgressionState>;
  factions?: Record<string, ProgressionState & { factionHash: number }>;
  milestones?: Record<string, MilestoneState>;
  seasonalArtifact?: SeasonalArtifact;
}

// ---- Historique et statistiques ----

export interface StatsValue {
  basic?: { value?: number; displayValue?: string };
}

export interface ActivityHistoryEntry {
  period: string;
  activityDetails: {
    referenceId: number;
    directorActivityHash: number;
    instanceId: string;
    mode?: number;
    modes?: number[];
    isPrivate?: boolean;
  };
  values?: Record<string, StatsValue>;
}

export interface ActivityHistoryPage {
  activities?: ActivityHistoryEntry[];
}

/**
 * Une arme telle qu'un rapport de fin de partie la compte.
 * C'est la seule source qui couvre autre chose que les exotiques.
 */
export interface WeaponUsage {
  referenceId: number;
  values?: Record<string, StatsValue>;
}

export interface PgcrEntry {
  standing?: number;
  score?: StatsValue;
  characterId: string;
  player: {
    destinyUserInfo: UserInfoCard;
    characterClass?: string;
    classHash?: number;
    lightLevel?: number;
    clanName?: string;
    clanTag?: string;
    emblemHash?: number;
  };
  values?: Record<string, StatsValue>;
  /** Détail par arme et médailles gagnées pendant la partie */
  extended?: { weapons?: WeaponUsage[] };
}

export interface PostGameCarnageReport {
  period: string;
  activityDetails: {
    referenceId: number;
    directorActivityHash: number;
    instanceId: string;
    mode?: number;
    modes?: number[];
  };
  entries?: PgcrEntry[];
  teams?: {
    teamId: number;
    standing?: StatsValue;
    score?: StatsValue;
    teamName?: string;
  }[];
  activityWasStartedFromBeginning?: boolean;
}

export interface UniqueWeaponResults {
  weapons?: { referenceId: number; values?: Record<string, StatsValue> }[];
}

export interface AggregateActivityResults {
  activities?: { activityHash: number; values?: Record<string, StatsValue> }[];
}

export interface AccountHistoricalStats {
  mergedAllCharacters?: {
    results?: Record<string, { allTime?: Record<string, StatsValue> }>;
  };
  characters?: {
    characterId: string;
    deleted?: boolean;
    results?: Record<string, { allTime?: Record<string, StatsValue> }>;
  }[];
}

// ---- Comptes et recherche ----

export interface UserInfoCard {
  membershipType: number;
  membershipId: string;
  displayName?: string;
  bungieGlobalDisplayName?: string;
  bungieGlobalDisplayNameCode?: number;
  iconPath?: string;
  crossSaveOverride?: number;
  applicableMembershipTypes?: number[];
  isPublic?: boolean;
}

export interface PlayerSearchResult {
  membershipType: number;
  membershipId: string;
  name: string;
  code?: number;
  icon?: string;
  platforms: number[];
}

/** Réponse de GetItem : une seule instance, ses stats et ses emplacements. */
export interface ItemResponse {
  characterId?: string;
  item?: { data?: ProfileItem };
  instance?: {
    data?: {
      primaryStat?: { value: number };
      damageTypeHash?: number;
      energy?: { energyCapacity: number; energyUsed?: number };
    };
  };
  stats?: {
    data?: { stats?: Record<string, { statHash: number; value: number }> };
  };
  sockets?: { data?: { sockets?: SocketState[] } };
}

export interface SessionInfo {
  loggedIn: boolean;
  displayName?: string;
}
