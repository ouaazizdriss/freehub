"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveDraft } from "@/app/(app)/cra/actions";
import type { EditableDay, SubmissionIssue } from "@/lib/domain/cra-editor";
import { LOCAL_DRAFT_PREFIX } from "@/components/shell/logout-form";

export type SaveState =
  | { status: "idle" }
  | { status: "dirty" }
  | { status: "saving" }
  | { status: "saved"; at: string }
  | { status: "invalid"; issues: SubmissionIssue[] }
  | { status: "error" }
  /** Bloquant : le CRA a changé ailleurs (autre onglet) ou n'est plus modifiable. */
  | { status: "conflict" | "locked" };

const DEBOUNCE_MS = 700;

type Outcome = "saved" | "failed" | "blocked";

/**
 * Autosave du brouillon.
 * - une seule requête à la fois ; les modifications faites pendant un enregistrement
 *   sont regroupées et envoyées juste après (l'état complet est renvoyé à chaque fois) ;
 * - `flush()` force l'enregistrement immédiat et indique si tout est bien en base ;
 * - un échec réseau ou un refus ne relance rien automatiquement : la saisie reste en attente
 *   et repart à la prochaine modification ou via « Réessayer » ;
 * - après un conflit de version, plus aucune écriture : l'utilisateur doit recharger ;
 * - au démontage (navigation dans l'application), les modifications en attente sont envoyées.
 */
/** Copie locale : liée à l'utilisateur, au CRA et à l'onglet qui l'a écrite. */
type Stored = { version: number | null; timesheetId: string | null; tabId: string; days: EditableDay[]; at: number };

const TAB_ID = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());

/** Copie locale des modifications non envoyées (mode hors ligne). Le navigateur peut refuser le stockage. */
function store(key: string, value: Stored | null): boolean {
  try {
    if (value) window.localStorage.setItem(key, JSON.stringify(value));
    else window.localStorage.removeItem(key);
    return true;
  } catch {
    return false; // stockage indisponible (navigation privée, quota) : pas de file hors ligne
  }
}

function load(key: string): Stored | null {
  try {
    const raw = window.localStorage.getItem(key);
    const value = raw ? (JSON.parse(raw) as Stored) : null;
    return value && Array.isArray(value.days) ? value : null;
  } catch {
    return null;
  }
}

export function useAutosave(opts: {
  ownerId: string;
  timesheetId: string | null;
  poId: string;
  month: string;
  initialVersion: number | null;
  enabled: boolean;
  onRestore?: (days: EditableDay[]) => void;
}) {
  const { poId, month, enabled } = opts;
  // Clé propre à l'utilisateur : sur un poste partagé, la saisie d'un freelance n'est jamais
  // reprise dans le CRA d'un autre (les copies sont aussi effacées à la déconnexion).
  const storageKey = `${LOCAL_DRAFT_PREFIX}${opts.ownerId}:${poId}:${month}`;
  const timesheetId = useRef(opts.timesheetId);
  const writeCopy = useCallback(
    (days: EditableDay[]) => {
      const ok = store(storageKey, { version: version.current, timesheetId: timesheetId.current, tabId: TAB_ID, days, at: Date.now() });
      if (!ok) setOfflineNotice("Sauvegarde locale indisponible sur cet appareil : la saisie hors ligne n'est pas protégée.");
    },
    [storageKey],
  );
  const [state, setState] = useState<SaveState>({ status: "idle" });
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const version = useRef(opts.initialVersion);
  const pending = useRef<EditableDay[] | null>(null);
  const inflight = useRef<Promise<Outcome> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const blocked = useRef(false);
  /** Dernier envoi en échec ou refusé : la base ne reflète pas l'écran. */
  const failed = useRef(false);

  const send = useCallback(
    async (days: EditableDay[]): Promise<Outcome> => {
      setState({ status: "saving" });
      try {
        const result = await saveDraft({ poId, month, version: version.current, days });
        if (result.ok) {
          version.current = result.version;
          failed.current = false;
          // Pas d'autre modification en attente : copie inutile ; sinon, copie réécrite avec la
          // nouvelle version (elle resterait sinon rattachée à une version périmée et serait ignorée).
          if (!pending.current) store(storageKey, null);
          else writeCopy(pending.current);
          setState(pending.current ? { status: "dirty" } : { status: "saved", at: result.savedAt });
          return "saved";
        }
        if (result.error === "INVALID") {
          pending.current ??= days;
          failed.current = true;
          setState({ status: "invalid", issues: result.issues });
          return "failed";
        }
        blocked.current = true;
        pending.current = null;
        store(storageKey, null);
        setState({ status: result.error === "LOCKED" ? "locked" : "conflict" });
        return "blocked";
      } catch {
        // Erreur réseau ou serveur : on garde la saisie, sans relance automatique.
        pending.current ??= days;
        failed.current = true;
        setState({ status: "error" });
        return "failed";
      }
    },
    [poId, month, storageKey, writeCopy],
  );

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current);
    for (;;) {
      if (blocked.current) return false;
      if (inflight.current) {
        if ((await inflight.current) !== "saved") return false;
        continue;
      }
      const days = pending.current;
      if (!days) break;
      pending.current = null;
      const run = send(days);
      inflight.current = run;
      const outcome = await run;
      inflight.current = null;
      if (outcome !== "saved") return false;
    }
    return !failed.current;
  }, [send]);

  const schedule = useCallback(
    (days: EditableDay[]) => {
      if (!enabled || blocked.current) return;
      pending.current = days;
      // Copie locale immédiate : survit à une coupure réseau, une fermeture d'onglet ou un plantage.
      writeCopy(days);
      setState({ status: "dirty" });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    [enabled, flush, writeCopy],
  );

  // Hors ligne : reprise d'une copie locale au chargement, synchronisation au retour du réseau.
  const restoreRef = useRef(opts.onRestore);
  const initialVersion = useRef(opts.initialVersion);
  useEffect(() => {
    const saved = load(storageKey);
    if (!enabled) {
      // CRA soumis (ici ou ailleurs) : une copie restante n'a plus d'objet.
      if (saved) store(storageKey, null);
      return;
    }
    if (saved) {
      if (saved.version === initialVersion.current && saved.timesheetId === timesheetId.current) {
        pending.current = saved.days;
        restoreRef.current?.(saved.days);
        setOfflineNotice("Des modifications non synchronisées ont été reprises depuis cet appareil.");
        setState({ status: "dirty" });
        if (navigator.onLine) void flush();
      } else {
        // Le CRA a changé depuis (autre appareil) : la copie locale n'est pas réappliquée.
        store(storageKey, null);
        setOfflineNotice("Des modifications hors ligne plus anciennes que la version enregistrée ont été ignorées.");
      }
    }
    const onOnline = () => void flush();
    // Autre onglet sur le même CRA : on prévient plutôt que d'écraser sa saisie en silence.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey || !e.newValue) return;
      try {
        if ((JSON.parse(e.newValue) as Stored).tabId !== TAB_ID) {
          setOfflineNotice("Ce CRA est aussi ouvert dans un autre onglet : n'y saisissez qu'à un seul endroit.");
        }
      } catch {
        /* valeur illisible : ignorée */
      }
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("storage", onStorage);
    };
  }, [enabled, storageKey, flush]);

  // Avertit avant de fermer l'onglet avec des modifications non enregistrées ;
  // en navigation interne (démontage), envoie ce qui reste en attente.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current || inflight.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (pending.current) void flushRef.current();
      else clearTimeout(timer.current);
    };
  }, []);

  return {
    state,
    schedule,
    flush,
    getVersion: () => version.current,
    hasUnsaved: () => pending.current !== null || inflight.current !== null || failed.current,
    offlineNotice,
  };
}
