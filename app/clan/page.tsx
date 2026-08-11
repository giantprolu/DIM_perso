"use client";

import { useEffect, useMemo, useState } from "react";

type Phase = "loading" | "ready" | "unauth" | "none" | "error";

interface ClanMember {
  destinyUserInfo?: {
    membershipId?: string;
    membershipType?: number;
    displayName?: string;
    bungieGlobalDisplayName?: string;
    bungieGlobalDisplayNameCode?: number;
    iconPath?: string;
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

export default function ClanPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [clan, setClan] = useState<ClanDetail["detail"] | null>(null);
  const [members, setMembers] = useState<ClanMember[]>([]);
  const [onlyOnline, setOnlyOnline] = useState(false);

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
                  const name =
                    info?.bungieGlobalDisplayName ??
                    info?.displayName ??
                    m.bungieNetUserInfo?.displayName ??
                    "Gardien";
                  const code = info?.bungieGlobalDisplayNameCode;
                  const icon = info?.iconPath ?? m.bungieNetUserInfo?.iconPath;
                  return (
                    <tr key={info?.membershipId ?? name}>
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
    </div>
  );
}
