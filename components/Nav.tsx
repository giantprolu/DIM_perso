"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { SessionInfo } from "@/lib/types";

const LINKS = [
  { href: "/", label: "Tableau de bord" },
  { href: "/quests", label: "Quêtes" },
  { href: "/armes", label: "Armes" },
  { href: "/optimizer", label: "Optimiseur" },
  { href: "/loadouts", label: "Loadouts" },
];

export default function Nav() {
  const pathname = usePathname();
  const [session, setSession] = useState<SessionInfo | null>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then(setSession)
      .catch(() => setSession({ loggedIn: false }));
  }, [pathname]);

  return (
    <div className="navbar bg-base-200 border-b border-base-300 px-6 gap-6 sticky top-0 z-20">
      <span className="text-xl font-semibold tracking-widest uppercase">
        DIM Perso
      </span>
      <div role="tablist" className="tabs tabs-bordered hidden md:flex">
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
      <div className="flex items-center gap-3">
        {session?.loggedIn ? (
          <div className="dropdown dropdown-end">
            <div
              tabIndex={0}
              role="button"
              className="btn btn-sm btn-outline btn-primary"
            >
              <span className="whitespace-nowrap">{session.displayName}</span>
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
            Connexion Bungie
          </a>
        ) : null}
      </div>
    </div>
  );
}
