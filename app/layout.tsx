import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "DIM Perso — Armurerie",
  description: "Quêtes et optimiseur d'équipement Destiny 2 — usage personnel",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" data-theme="dim">
      <body className="min-h-screen bg-base-100 text-base-content">
        <Nav />
        <main className="p-6 max-w-[1400px] mx-auto">{children}</main>
      </body>
    </html>
  );
}
