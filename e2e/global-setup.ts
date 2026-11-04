import { execSync } from "node:child_process";

/** Réinitialise la base de test avec les données de démonstration (seed idempotent). */
export default function globalSetup() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL est obligatoire (base dédiée aux tests, réinitialisée à chaque exécution).");
  // Le nom de la base doit se terminer par _e2e ou _test : la suite efface tout avant de s'exécuter.
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/(_e2e|_test)$/.test(name)) {
    throw new Error(`Refus : la base « ${name} » ne se termine pas par _e2e ou _test. Utilisez une base dédiée aux tests.`);
  }
  execSync("npx prisma migrate deploy && npx prisma db seed", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
}
