"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import CurrencyBar from "@/components/CurrencyBar";
import RaIcon from "@/components/RaIcon";
import { ICONS } from "@/lib/rpg-icons";
import type { SessionInfo } from "@/lib/types";

const LINKS = [
  { href: "/", label: "Tableau de bord", icon: ICONS.activity },
  { href: "/perso", label: "Personnage", icon: ICONS.character },
  { href: "/semaine", label: "Semaine", icon: ICONS.time },
  { href: "/quests", label: "Quêtes", icon: ICONS.quest },
  { href: "/activite", label: "Activité", icon: ICONS.history },
  { href: "/armes", label: "Armes", icon: ICONS.weapon },
  { href: "/postmaster", label: "Postes", icon: ICONS.postmaster },
  { href: "/marchands", label: "Marchands", icon: ICONS.vendor },
  { href: "/optimizer", label: "Optimiseur", icon: ICONS.optimizer },
  { href: "/loadouts", label: "Loadouts", icon: ICONS.loadout },
  { href: "/clan", label: "Clan", icon: ICONS.clan },
];

export default function Nav() {
  const pathname = usePathname();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then(setSession)
      .catch(() => setSession({ loggedIn: false }));
  }, [pathname]);

  // Une page choisie referme le menu.
  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <div className="navbar bg-base-200 border-b border-base-300 px-2 sm:px-6 gap-2 sm:gap-6 sticky top-0 z-20">
      {/*
        Onze onglets ne tiennent pas sous 1280 px : en dessous, ils passent
        dans un menu déroulant sous la barre.
      */}
      <button
        className="btn btn-ghost btn-sm btn-square xl:hidden"
        aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        {menuOpen ? (
          <span className="text-lg leading-none">✕</span>
        ) : (
          <svg
            viewBox="0 0 24 24"
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        )}
      </button>

      <Link
        href="/"
        className="text-base sm:text-xl font-semibold tracking-widest uppercase whitespace-nowrap"
      >
        DIM Perso
      </Link>

      <div role="tablist" className="tabs tabs-bordered tabs-scroll hidden xl:grid min-w-0">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            role="tab"
            className={`tab${pathname === l.href ? " tab-active" : ""}`}
          >
            {l.label}
          </Link>
        ))}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1 sm:gap-2 min-w-0">
        <CurrencyBar enabled={Boolean(session?.loggedIn)} />
        {session?.loggedIn ? (
          <div className="dropdown dropdown-end">
            <div
              tabIndex={0}
              role="button"
              className="btn btn-sm btn-outline btn-primary max-w-[7.5rem] sm:max-w-none"
            >
              <span className="truncate whitespace-nowrap">
                {session.displayName}
              </span>
            </div>
            <ul
              tabIndex={0}
              className="dropdown-content menu bg-base-200 rounded-box z-10 w-56 p-2 shadow"
            >
              <li>
                <a href="/api/auth/logout">Déconnexion</a>
              </li>
            </ul>
          </div>
        ) : session ? (
          <a className="btn btn-sm btn-primary" href="/api/auth/login">
            <span className="sm:hidden">Connexion</span>
            <span className="hidden sm:inline">Connexion Bungie</span>
          </a>
        ) : null}
      </div>

      {menuOpen && (
        <>
          <div
            className="fixed inset-0 top-16 bg-black/50 xl:hidden"
            onClick={() => setMenuOpen(false)}
            role="presentation"
          />
          <nav className="absolute left-0 right-0 top-full xl:hidden bg-base-200 border-b border-base-300 shadow-xl max-h-[calc(100dvh-4rem)] overflow-y-auto">
            <ul className="grid grid-cols-2 sm:grid-cols-3 gap-1 p-2">
              {LINKS.map((l) => {
                const active = pathname === l.href;
                return (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-2.5 rounded-box px-3 py-3 text-sm transition-colors ${
                        active
                          ? "bg-primary/15 text-primary font-medium"
                          : "hover:bg-base-300"
                      }`}
                      onClick={() => setMenuOpen(false)}
                    >
                      <RaIcon
                        icon={l.icon}
                        className={`text-lg ${active ? "" : "opacity-60"}`}
                      />
                      {l.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </>
      )}
    </div>
  );
}
