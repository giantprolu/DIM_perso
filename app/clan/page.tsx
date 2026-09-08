"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { loadDefs } from "@/lib/manifest-client";
import { fetchPlayer, cachedPlayer, type PlayerData } from "@/lib/player-client";
import PlayerHoverCard, {
  type HoverAnchor,
  type HoverMember,
} from "@/components/PlayerHoverCard";
import PlayerModal, { type ModalTarget } from "@/components/PlayerModal";
import type { Defs, PlayerSearchResult } from "@/lib/types";

type Phase = "loading" | "ready" | "unauth" | "none" | "error";

interface ClanMember {
  destinyUserInfo?: {
    membershipId?: string;
    membershipType?: number;
    displayName?: string;
    bungieGlobalDisplayName?: string;
    bungieGlobalDisplayNameCode?: number;
    iconPath?: string;
    /** ≠ 0 quand le joueur a activé la sauvegarde partagée */
    crossSaveOverride?: number;
    applicableMembershipTypes?: number[];
  };
  bungieNetUserInfo?: { displayName?: string; iconPath?: string };
  isOnline?: boolean;
  lastOnlineStatusChange?: string;
  joinDate?: string;
  memberType?: number;
}

interface ClanDetail {
  detail?: {
    groupId?: string;
    name?: string;
    about?: string;
    motto?: string;
    memberCount?: number;
    creationDate?: string;
    clanInfo?: {
      clanBannerData?: unknown;
      clanCallsign?: string;
      d2ClanProgressions?: Record<
        string,
        { level?: number; progressToNextLevel?: number; nextLevelAt?: number }
      >;
    };
    bannerPath?: string;
    avatarPath?: string;
  };
}

const MEMBER_TYPES: Record<number, string> = {
  1: "Membre",
  2: "Administrateur",
  3: "Administrateur",
  4: "Fondateur",
  5: "Fondateur",
};

const BUNGIE_ROOT = "https://www.bungie.net";

/** Délai avant d'interroger Bungie : traverser une ligne ne doit rien déclencher. */
const HOVER_DELAY_MS = 180;

function lastSeen(iso?: string, online?: boolean): string {
  if (online) return "en ligne";
  if (!iso) return "—";
  // lastOnlineStatusChange est un timestamp Unix en secondes, sous forme
  // de chaîne dans la réponse Bungie.
  const seconds = Number(iso);
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const ms = Date.now() - seconds * 1000;
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `il y a ${days} j`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `il y a ${hours} h`;
  const minutes = Math.floor(ms / 60_000);
  return `il y a ${Math.max(1, minutes)} min`;
}

/**
 * Compte Destiny à interroger. En sauvegarde partagée, seul le compte
 * `crossSaveOverride` porte les personnages : les autres plateformes
 * renvoient un profil vide.
 */
function destinyAccount(
  m: ClanMember
): { type: number; id: string } | null {
  const info = m.destinyUserInfo;
  if (!info?.membershipId) return null;
  const type =
    info.crossSaveOverride && info.crossSaveOverride !== 0
      ? info.crossSaveOverride
      : info.membershipType;
  if (type === undefined) return null;
  return { type, id: info.membershipId };
}

function memberName(m: ClanMember): string {
  const info = m.destinyUserInfo;
  return (
    info?.bungieGlobalDisplayName ??
    info?.displayName ??
    m.bungieNetUserInfo?.displayName ??
    "Gardien"
  );
}

function hoverMemberOf(m: ClanMember): HoverMember {
  const info = m.destinyUserInfo;
  return {
    name: memberName(m),
    code: info?.bungieGlobalDisplayNameCode,
    icon: info?.iconPath ?? m.bungieNetUserInfo?.iconPath,
    isOnline: m.isOnline,
    membershipType: destinyAccount(m)?.type,
    role: MEMBER_TYPES[m.memberType ?? 1] ?? "Membre",
    joinDate: m.joinDate,
    lastSeen: lastSeen(m.lastOnlineStatusChange, m.isOnline),
  };
}

export default function ClanPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [clan, setClan] = useState<ClanDetail["detail"] | null>(null);
  const [members, setMembers] = useState<ClanMember[]>([]);
  const [onlyOnline, setOnlyOnline] = useState(false);

  const [defs, setDefs] = useState<Defs | null>(null);
  const [defsStatus, setDefsStatus] = useState("Chargement des définitions…");

  const [hover, setHover] = useState<{
    member: ClanMember;
    anchor: HoverAnchor;
  } | null>(null);
  const [hoverData, setHoverData] = useState<PlayerData | null>(null);
  const [hoverLoading, setHoverLoading] = useState(false);
  const [hoverError, setHoverError] = useState("");
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Identifie le survol en cours : les réponses tardives d'un autre membre sont ignorées. */
  const hoverKey = useRef("");

  const [modalTarget, setModalTarget] = useState<ModalTarget | null>(null);

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PlayerSearchResult[] | null>(
    null
  );
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState("");

  /** Cherche un Gardien par nom Bungie, membre du clan ou non. */
  async function runSearch(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 3) {
      setSearchError("Tape au moins 3 caractères.");
      return;
    }
    setSearchBusy(true);
    setSearchError("");
    try {
      const res = await fetch(`/api/bungie/search-player?q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as {
        results?: PlayerSearchResult[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Recherche impossible");
      setSearchResults(data.results ?? []);
    } catch (err) {
      setSearchResults(null);
      setSearchError(err instanceof Error ? err.message : "Recherche impossible");
    } finally {
      setSearchBusy(false);
    }
  }

  /** Un joueur trouvé s'ouvre dans la même fiche qu'un membre du clan. */
  function openFoundPlayer(player: PlayerSearchResult) {
    setModalTarget({
      membershipType: player.membershipType,
      membershipId: player.membershipId,
      name: player.name,
      code: player.code,
      icon: player.icon,
      role: "Hors clan",
      lastSeen: "—",
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/bungie/clan");
        if (res.status === 401) {
          setPhase("unauth");
          return;
        }
        const data = (await res.json()) as {
          detail?: ClanDetail;
          members?: { results?: ClanMember[] };
          clan?: null;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? "Erreur clan");
        if (cancelled) return;
        if (!data.detail) {
          setPhase("none");
          return;
        }
        setClan(data.detail.detail ?? null);
        setMembers(data.members?.results ?? []);
        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Erreur inconnue");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Le manifest se charge en tâche de fond : la liste du clan s'affiche tout
   * de suite, et les fiches sont prêtes au premier survol. Un échec ici ne
   * doit pas empêcher de consulter le clan.
   */
  useEffect(() => {
    let cancelled = false;
    loadDefs((msg) => !cancelled && setDefsStatus(msg))
      .then((d) => !cancelled && setDefs(d))
      .catch(
        (e: unknown) =>
          !cancelled &&
          setDefsStatus(
            e instanceof Error ? e.message : "Définitions indisponibles"
          )
      );
    return () => {
      cancelled = true;
    };
  }, []);

  const clearHover = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    hoverKey.current = "";
    setHover(null);
    setHoverData(null);
    setHoverError("");
    setHoverLoading(false);
  }, []);

  const startHover = useCallback(
    (m: ClanMember, element: HTMLElement) => {
      // Le survol précédent ne doit pas déclencher sa requête après coup.
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      hoverTimer.current = null;

      const account = destinyAccount(m);
      const rect = element.getBoundingClientRect();
      setHover({
        member: m,
        anchor: { top: rect.top, bottom: rect.bottom, left: rect.left },
      });
      setHoverError("");

      if (!account) {
        setHoverData(null);
        setHoverLoading(false);
        return;
      }

      const key = `${account.type}/${account.id}`;
      hoverKey.current = key;

      // Déjà lu récemment : affichage immédiat, aucune requête.
      const cachedData = cachedPlayer(account.type, account.id);
      if (cachedData) {
        setHoverData(cachedData);
        setHoverLoading(false);
        return;
      }

      setHoverData(null);
      setHoverLoading(true);
      hoverTimer.current = setTimeout(() => {
        fetchPlayer(account.type, account.id, true)
          .then((d) => {
            if (hoverKey.current === key) setHoverData(d);
          })
          .catch((e: unknown) => {
            if (hoverKey.current === key) {
              setHoverError(
                e instanceof Error ? e.message : "Profil illisible"
              );
            }
          })
          .finally(() => {
            if (hoverKey.current === key) setHoverLoading(false);
          });
      }, HOVER_DELAY_MS);
    },
    []
  );

  const openMember = useCallback(
    (m: ClanMember) => {
      const account = destinyAccount(m);
      if (!account) return;
      clearHover();
      const info = m.destinyUserInfo;
      setModalTarget({
        membershipType: account.type,
        membershipId: account.id,
        name: memberName(m),
        code: info?.bungieGlobalDisplayNameCode,
        icon: info?.iconPath ?? m.bungieNetUserInfo?.iconPath,
        isOnline: m.isOnline,
        role: MEMBER_TYPES[m.memberType ?? 1] ?? "Membre",
        joinDate: m.joinDate,
        lastSeen: lastSeen(m.lastOnlineStatusChange, m.isOnline),
      });
    },
    [clearHover]
  );

  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  const sorted = useMemo(() => {
    const list = [...members];
    list.sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      return Number(b.lastOnlineStatusChange) - Number(a.lastOnlineStatusChange);
    });
    return onlyOnline ? list.filter((m) => m.isOnline) : list;
  }, [members, onlyOnline]);

  const onlineCount = members.filter((m) => m.isOnline).length;

  if (phase === "loading") {
    return (
      <div className="flex flex-col items-center gap-4 py-16 opacity-70">
        <span className="loading loading-spinner loading-lg text-primary" />
        <div className="text-sm">Chargement du clan…</div>
      </div>
    );
  }
  if (phase === "unauth") {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <p className="opacity-70">Connecte-toi pour voir ton clan.</p>
        <a className="btn btn-primary" href="/api/auth/login">
          Se connecter avec Bungie.net
        </a>
      </div>
    );
  }
  if (phase === "none") {
    return (
      <div className="opacity-60 py-16 text-center">
        Tu n&apos;appartiens à aucun clan.
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div role="alert" className="alert alert-error">
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card bg-base-200 shadow overflow-hidden">
        {clan?.bannerPath && (
          <div
            className="h-24 bg-cover bg-center"
            style={{
              backgroundImage: `linear-gradient(to bottom, rgba(20,24,31,.3), rgba(20,24,31,.95)), url(${BUNGIE_ROOT}${clan.bannerPath})`,
            }}
          />
        )}
        <div className="card-body p-5 gap-2">
          <h1 className="text-2xl font-semibold">
            {clan?.name}
            {clan?.clanInfo?.clanCallsign && (
              <span className="badge badge-outline badge-primary ml-2 align-middle">
                [{clan.clanInfo.clanCallsign}]
              </span>
            )}
          </h1>
          {clan?.motto && (
            <p className="text-sm italic opacity-70">{clan.motto}</p>
          )}
          {clan?.about && (
            <p className="text-sm opacity-60 whitespace-pre-line line-clamp-4">
              {clan.about}
            </p>
          )}
          <div className="stats stats-horizontal bg-base-300 mt-2 w-fit">
            <div className="stat py-2 px-4">
              <div className="stat-title text-xs">Membres</div>
              <div className="stat-value text-2xl">{clan?.memberCount ?? 0}</div>
            </div>
            <div className="stat py-2 px-4">
              <div className="stat-title text-xs">En ligne</div>
              <div className="stat-value text-2xl text-success">
                {onlineCount}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card bg-base-200 shadow">
        <div className="card-body p-4 gap-3">
          <form className="flex gap-2 flex-wrap items-center" onSubmit={runSearch}>
            <input
              className="input input-sm input-bordered flex-1 min-w-[220px]"
              placeholder="Chercher un Gardien : Nom ou Nom#1234"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="btn btn-sm btn-primary" disabled={searchBusy}>
              {searchBusy ? "Recherche…" : "Chercher"}
            </button>
            {searchResults !== null && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setSearchResults(null);
                  setQuery("");
                }}
              >
                Effacer
              </button>
            )}
          </form>

          {searchError && (
            <div role="alert" className="alert alert-warning text-sm">
              <span>{searchError}</span>
            </div>
          )}

          {searchResults !== null &&
            (searchResults.length === 0 ? (
              <p className="text-sm opacity-60">
                Aucun Gardien trouvé. Le nom exact « Nom#1234 » donne toujours un
                résultat s&apos;il existe.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {searchResults.map((player) => (
                  <button
                    key={`${player.membershipType}-${player.membershipId}`}
                    className="btn btn-ghost btn-sm justify-start gap-2 font-normal"
                    onClick={() => openFoundPlayer(player)}
                  >
                    {player.icon && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="w-5 h-5 rounded"
                        src={`${BUNGIE_ROOT}${player.icon}`}
                        alt=""
                      />
                    )}
                    <span className="font-medium">{player.name}</span>
                    {player.code !== undefined && (
                      <span className="opacity-50 text-xs">
                        #{String(player.code).padStart(4, "0")}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}
        </div>
      </div>

      <label className="label cursor-pointer justify-start gap-3 py-0">
        <input
          type="checkbox"
          className="toggle toggle-primary toggle-sm"
          checked={onlyOnline}
          onChange={(e) => setOnlyOnline(e.target.checked)}
        />
        <span className="label-text text-sm">Seulement les membres en ligne</span>
      </label>

      <div className="card bg-base-200 shadow">
        <div className="card-body p-2">
          <div className="overflow-x-auto">
            <table className="table table-zebra table-sm">
              <thead>
                <tr>
                  <th>Gardien</th>
                  <th>Rôle</th>
                  <th className="text-right">Dernière connexion</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => {
                  const info = m.destinyUserInfo;
                  const name = memberName(m);
                  const code = info?.bungieGlobalDisplayNameCode;
                  const icon = info?.iconPath ?? m.bungieNetUserInfo?.iconPath;
                  const account = destinyAccount(m);
                  return (
                    <tr
                      key={info?.membershipId ?? name}
                      className={
                        account
                          ? "cursor-pointer hover:bg-base-300/60 focus:bg-base-300/60 outline-none"
                          : undefined
                      }
                      tabIndex={account ? 0 : undefined}
                      role={account ? "button" : undefined}
                      aria-label={account ? `Fiche de ${name}` : undefined}
                      onMouseEnter={(e) => startHover(m, e.currentTarget)}
                      onMouseLeave={clearHover}
                      onFocus={(e) => startHover(m, e.currentTarget)}
                      onBlur={clearHover}
                      onClick={() => openMember(m)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openMember(m);
                        }
                      }}
                    >
                      <td>
                        <div className="flex items-center gap-2">
                          {icon && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`${BUNGIE_ROOT}${icon}`}
                              alt=""
                              className="w-7 h-7 rounded"
                            />
                          )}
                          <span
                            className={`w-2 h-2 rounded-full ${
                              m.isOnline ? "bg-success" : "bg-base-content/25"
                            }`}
                          />
                          <span className="font-medium">
                            {name}
                            {code !== undefined && (
                              <span className="opacity-40 font-mono text-xs">
                                #{String(code).padStart(4, "0")}
                              </span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="text-xs opacity-60">
                        {MEMBER_TYPES[m.memberType ?? 1] ?? "Membre"}
                      </td>
                      <td className="text-right text-xs opacity-60">
                        {lastSeen(m.lastOnlineStatusChange, m.isOnline)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p className="text-xs opacity-50">
        Survole un gardien pour un aperçu, clique pour sa fiche complète —
        personnages, puissance, statistiques, activité en cours et équipement
        porté. Ce que Bungie accepte de montrer dépend des réglages de
        confidentialité de chacun : un profil privé est signalé comme tel.
      </p>

      {hover && (
        <PlayerHoverCard
          member={hoverMemberOf(hover.member)}
          data={hoverData}
          defs={defs}
          loading={hoverLoading}
          error={hoverError}
          anchor={hover.anchor}
        />
      )}

      {modalTarget && (
        <PlayerModal
          target={modalTarget}
          defs={defs}
          defsStatus={defsStatus}
          onClose={() => setModalTarget(null)}
        />
      )}
    </div>
  );
}
