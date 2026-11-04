import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// next/font auto-héberge la police au build : aucune requête vers Google Fonts en production.
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "Freelance Hub", template: "%s · Freelance Hub" },
  description: "Gestion des freelances et du CRA mensuel",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={inter.variable}>
      <body className="min-h-screen bg-page font-sans text-ink">{children}</body>
    </html>
  );
}
