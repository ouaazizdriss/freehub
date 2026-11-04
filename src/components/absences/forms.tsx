"use client";

import { cancelAbsence, declareAbsence } from "@/app/(app)/absences/actions";
import { ActionForm, Field } from "@/components/forms/action-form";

export function DeclareAbsenceForm() {
  return (
    <ActionForm action={declareAbsence} submitLabel="Déclarer l'absence" resetOnSuccess>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="kind" label="Type" required defaultValue="LEAVE">
          <option value="LEAVE">Congé</option>
          <option value="UNAVAILABLE">Indisponibilité</option>
          <option value="SICK">Arrêt maladie</option>
        </Field>
        <Field name="start" label="Du" type="date" required />
        <Field name="end" label="Au (inclus)" type="date" required />
      </div>
      <Field name="comment" label="Commentaire" maxLength={300} hint="Facultatif — visible par votre manager" />
    </ActionForm>
  );
}

export function CancelAbsenceButton({ id, label }: { id: string; label: string }) {
  return (
    <ActionForm action={cancelAbsence} submitLabel={`Annuler ${label}`}>
      <input type="hidden" name="id" value={id} />
    </ActionForm>
  );
}
