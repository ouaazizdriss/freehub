-- Lot 6 — Verrouillage des CRA en base (défense en profondeur, indépendante du code applicatif).
--  * Jours d'un CRA soumis ou validé : aucune insertion, modification ni suppression.
--  * CRA validé : seuls les champs de scellement (code d'authenticité, empreinte, instantané)
--    peuvent encore changer ; suppression interdite.
-- Exception unique : la purge de rétention (RGPD), qui active `app.retention_purge` pour sa
-- seule transaction (set_config(..., true)).

CREATE OR REPLACE FUNCTION fh_retention_purge() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.retention_purge', true), '') = 'on'
$$;

CREATE OR REPLACE FUNCTION fh_lock_timesheet_day() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_status "TimesheetStatus";
BEGIN
  IF fh_retention_purge() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT status INTO parent_status FROM "Timesheet" WHERE id = COALESCE(NEW."timesheetId", OLD."timesheetId");
  IF parent_status IN ('SUBMITTED', 'VALIDATED') THEN
    RAISE EXCEPTION 'CRA % : jours verrouillés (statut %)', COALESCE(NEW."timesheetId", OLD."timesheetId"), parent_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER "TimesheetDay_lock"
  BEFORE INSERT OR UPDATE OR DELETE ON "TimesheetDay"
  FOR EACH ROW EXECUTE FUNCTION fh_lock_timesheet_day();

CREATE OR REPLACE FUNCTION fh_lock_validated_timesheet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF fh_retention_purge() OR OLD.status <> 'VALIDATED' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CRA % validé : suppression interdite', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - 'authCode' - 'contentHash' - 'snapshot' - 'submittedCode' - 'updatedAt')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'authCode' - 'contentHash' - 'snapshot' - 'submittedCode' - 'updatedAt') THEN
    RAISE EXCEPTION 'CRA % validé : modification interdite', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Timesheet_lock_validated"
  BEFORE UPDATE OR DELETE ON "Timesheet"
  FOR EACH ROW EXECUTE FUNCTION fh_lock_validated_timesheet();
