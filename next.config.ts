import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Politique de sécurité du contenu.
 * - frame-ancestors 'none' : l'application ne peut pas être affichée dans un cadre (clickjacking) ;
 * - form-action : formulaires vers l'application et vers Microsoft (redirection de connexion SSO) ;
 * - script-src : 'unsafe-inline' requis par les scripts d'hydratation de Next en prérendu partiel
 *   (une CSP à nonce rendrait toutes les pages dynamiques) ; 'unsafe-eval' en développement seulement.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://login.microsoftonline.com",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // HSTS : ignoré par les navigateurs en HTTP (local), actif derrière HTTPS.
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  experimental: {
    // Pièces justificatives (≤ 4 Mo) et signature (≤ 1 Mo) + surcoût multipart ;
    // la taille réelle est revérifiée dans chaque action.
    serverActions: { bodySizeLimit: "4.2mb" },
  },
  // Bibliothèques Node lisant leurs propres fichiers (polices AFM, etc.) : non bundlées.
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
