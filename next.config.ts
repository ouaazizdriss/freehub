import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Bibliothèques Node lisant leurs propres fichiers (polices AFM, etc.) : non bundlées.
  experimental: {
    // Pièces justificatives (≤ 4 Mo) et signature (≤ 1 Mo) + surcoût multipart ;
    // la taille réelle est revérifiée dans chaque action.
    serverActions: { bodySizeLimit: "4.2mb" },
  },
  serverExternalPackages: ["pdfkit", "exceljs", "bwip-js", "sharp", "nodemailer"],
  turbopack: {
    rules: {
      "*.css": {
        // Limité aux CSS du projet : sans cette condition, le loader Tailwind traite aussi
        // le CSS interne généré par next/font et casse la résolution des fichiers de police en dev.
        condition: { path: /^src\// },
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
