"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { SessionInfo } from "@/lib/types";

const LINKS = [
  { href: "/", label: "Accueil" },
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
    <header className="nav">
      <span className="nav-brand">DIM Perso</span>
      <nav className="nav-links">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`nav-link${pathname === l.href ? " active" : ""}`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="nav-user">
        {session?.loggedIn ? (
          <>
            <span>{session.displayName}</span>
            <a className="btn btn-sm" href="/api/auth/logout">
              Déconnexion
            </a>
          </>
        ) : session ? (
          <a className="btn btn-sm btn-primary" href="/api/auth/login">
            Connexion Bungie
          </a>
        ) : null}
      </div>
    </header>
  );
}
