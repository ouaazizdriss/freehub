/**
 * Vérification de la configuration au démarrage du serveur (production) : une configuration
 * dangereuse ou incomplète empêche le démarrage au lieu d'échouer plus tard, en pleine transaction.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const problems: string[] = [];
  const env = (name: string) => process.env[name]?.trim() ?? "";
  if (env("AUTH_SECRET").length < 32) problems.push("AUTH_SECRET absent ou trop court (32 caractères minimum)");
  if (env("AUTH_CODE_SECRET").length < 32) problems.push("AUTH_CODE_SECRET absent ou trop court (32 caractères minimum)");
  if (env("AUTH_CODE_SECRET") && env("AUTH_CODE_SECRET") === env("AUTH_SECRET"))
    problems.push("AUTH_CODE_SECRET doit être distinct de AUTH_SECRET");
  if (!/^https:\/\//.test(env("APP_URL"))) problems.push("APP_URL doit être l'URL HTTPS publique de l'application");
  if (!env("SMTP_URL")) problems.push("SMTP_URL absent : les notifications ne partiraient pas");
  if (env("CRON_SECRET").length < 32) problems.push("CRON_SECRET absent ou trop court (32 caractères minimum)");
  if (!env("AUTH_MICROSOFT_ENTRA_ID_ID") || !env("AUTH_MICROSOFT_ENTRA_ID_SECRET")) problems.push("SSO Entra ID non configuré");
  if (problems.length > 0) throw new Error(`Configuration de production invalide :\n- ${problems.join("\n- ")}`);
}
