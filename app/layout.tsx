import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "DIM Perso",
  description: "Quêtes et optimiseur d'équipement Destiny 2 — usage personnel",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>
        <Nav />
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
