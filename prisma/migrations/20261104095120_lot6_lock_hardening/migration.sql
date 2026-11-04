-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deactivatedAt" TIMESTAMP(3);


-- Durcissement des verrous (revue du lot 6).
-- Jours : contrôle du CRA d'origine ET de destination ; un jour ne change jamais de CRA.
CREATE OR REPLACE FUNCTION fh_lock_timesheet_day() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  locked text;
BEGIN
  IF fh_retention_purge() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."timesheetId" IS DISTINCT FROM OLD."timesheetId" THEN
    RAISE EXCEPTION 'Un jour ne peut pas changer de CRA' USING ERRCODE = 'check_violation';
  END IF;
  SELECT string_agg(id || ' (' || status || ')', ', ') INTO locked
    FROM "Timesheet"
   WHERE status IN ('SUBMITTED', 'VALIDATED')
     AND id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD."timesheetId" END, CASE WHEN TG_OP <> 'DELETE' THEN NEW."timesheetId" END);
  IF locked IS NOT NULL THEN
    RAISE EXCEPTION 'CRA % : jours verrouillés', locked USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- CRA soumis : seules les transitions vers VALIDATED / REJECTED (champs de décision) et le
-- scellement sont permis ; suppression interdite.
-- CRA validé : rien ne change, sauf le scellement tant que le code « validé » n'est pas posé
-- (authCode nul ou encore égal au code du document provisoire) ; suppression interdite.
CREATE OR REPLACE FUNCTION fh_lock_validated_timesheet() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sealing text[] := ARRAY['authCode', 'contentHash', 'snapshot', 'submittedCode', 'updatedAt'];
  allowed text[];
BEGIN
  IF fh_retention_purge() OR OLD.status NOT IN ('SUBMITTED', 'VALIDATED') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CRA % (%) : suppression interdite', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'VALIDATED' THEN
    IF NOT (OLD."authCode" IS NULL OR OLD."authCode" IS NOT DISTINCT FROM OLD."submittedCode") THEN
      allowed := ARRAY['updatedAt'];          -- déjà scellé en version validée : figé
    ELSIF NEW."authCode" IS NULL THEN
      RAISE EXCEPTION 'CRA % validé : code d''authenticité obligatoire', OLD.id USING ERRCODE = 'check_violation';
    ELSE
      allowed := sealing;
    END IF;
  ELSIF NEW.status = 'VALIDATED' THEN
    allowed := sealing || ARRAY['status', 'version', 'validatedAt', 'validatedById', 'rejectionReason'];
  ELSIF NEW.status = 'REJECTED' THEN
    allowed := sealing || ARRAY['status', 'version', 'validatedAt', 'validatedById', 'rejectionReason'];
  ELSIF NEW.status = 'SUBMITTED' THEN
    allowed := sealing;
  ELSE
    RAISE EXCEPTION 'CRA % soumis : transition vers % interdite', OLD.id, NEW.status USING ERRCODE = 'check_violation';
  END IF;

  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION 'CRA % (%) : modification interdite', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
