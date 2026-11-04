"use client";

import { useRouter } from "next/navigation";
import {
  createContract,
  createFreelancer,
  setFreelancerActive,
  updateContract,
  updateFreelancer,
  uploadDocument,
} from "@/app/(app)/freelances/actions";
import { ActionForm, Field } from "@/components/forms/action-form";

type Profile = {
  id?: string;
  name: string;
  email: string;
  jobTitle: string | null;
  company: string | null;
  siret: string | null;
};

function ProfileFields({ profile }: { profile?: Profile }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field name="name" label="Nom complet" required defaultValue={profile?.name} maxLength={120} autoComplete="off" />
      <Field
        name="email"
        label="E-mail (connexion SSO)"
        type="email"
        required
        defaultValue={profile?.email}
        maxLength={200}
        autoComplete="off"
      />
      <Field name="jobTitle" label="Intitulé du poste" required defaultValue={profile?.jobTitle} maxLength={120} />
      <Field name="company" label="Société (portage, EURL…)" defaultValue={profile?.company} maxLength={160} />
      <Field
        name="siret"
        label="SIRET"
        defaultValue={profile?.siret}
        inputMode="numeric"
        maxLength={14}
        hint="14 chiffres, facultatif"
      />
    </div>
  );
}

export function NewFreelancerForm() {
  const router = useRouter();
  return (
    <ActionForm
      action={createFreelancer}
      submitLabel="Créer le freelance"
      onSuccess={(s) => s.id && router.push(`/freelances/${s.id}`)}
    >
      <ProfileFields />
    </ActionForm>
  );
}

export function EditFreelancerForm({ profile }: { profile: Profile & { id: string } }) {
  return (
    <ActionForm action={updateFreelancer} submitLabel="Enregistrer la fiche">
      <input type="hidden" name="id" value={profile.id} />
      <ProfileFields profile={profile} />
    </ActionForm>
  );
}

export function ActivationForm({ id, active }: { id: string; active: boolean }) {
  return (
    <ActionForm action={setFreelancerActive} submitLabel={active ? "Désactiver le compte" : "Réactiver le compte"}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <p className="text-[12.5px] text-ink-muted">
        {active
          ? "Le freelance ne pourra plus se connecter. Ses CRA et documents sont conservés."
          : "Le freelance pourra de nouveau se connecter."}
      </p>
    </ActionForm>
  );
}

export function NewContractForm({
  freelancerId,
  missions,
}: {
  freelancerId: string;
  missions: { id: string; name: string; start: string; end: string }[];
}) {
  return (
    <ActionForm action={createContract} submitLabel="Créer le contrat" resetOnSuccess>
      <input type="hidden" name="freelancerId" value={freelancerId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="missionId" label="Mission" required>
          <option value="">Choisir…</option>
          {missions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.start} → {m.end})
            </option>
          ))}
        </Field>
        <Field name="startDate" label="Début" type="date" required />
        <Field name="endDate" label="Fin" type="date" required />
        <Field name="dailyRate" label="TJM (HT)" type="number" required min={1} step={0.01} />
        <Field name="overtimeRate" label="Taux heure sup." type="number" required min={0} step={0.01} defaultValue={95} />
        <Field name="onCallRate" label="Forfait astreinte" type="number" required min={0} step={0.01} defaultValue={150} />
        <Field name="currency" label="Devise" required defaultValue="EUR">
          <option value="EUR">EUR</option>
          <option value="MAD">MAD</option>
        </Field>
      </div>
    </ActionForm>
  );
}

export function EditContractForm({
  contract,
}: {
  contract: {
    id: string;
    endDate: string;
    dailyRateCents: number;
    overtimeHourlyRateCents: number;
    onCallRateCents: number;
    locked: boolean;
  };
}) {
  return (
    <ActionForm action={updateContract} submitLabel="Enregistrer le contrat">
      <input type="hidden" name="id" value={contract.id} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Field name="endDate" label="Fin" type="date" required defaultValue={contract.endDate} />
        <Field
          name="dailyRate"
          label="TJM"
          type="number"
          required
          step={0.01}
          defaultValue={contract.dailyRateCents / 100}
          readOnly={contract.locked}
        />
        <Field
          name="overtimeRate"
          label="Heure sup."
          type="number"
          required
          step={0.01}
          defaultValue={contract.overtimeHourlyRateCents / 100}
          readOnly={contract.locked}
        />
        <Field
          name="onCallRate"
          label="Astreinte"
          type="number"
          required
          step={0.01}
          defaultValue={contract.onCallRateCents / 100}
          readOnly={contract.locked}
        />
      </div>
      {contract.locked ? (
        <p className="text-[11.5px] text-ink-subtle">
          Taux figés : des CRA ont été soumis sur ce contrat. Pour un nouveau taux, créez un contrat (avenant).
        </p>
      ) : null}
    </ActionForm>
  );
}

export function UploadDocumentForm({ freelancerId }: { freelancerId?: string }) {
  return (
    <ActionForm action={uploadDocument} submitLabel="Déposer la pièce" resetOnSuccess>
      {freelancerId ? <input type="hidden" name="freelancerId" value={freelancerId} /> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="kind" label="Type de pièce" required>
          <option value="URSSAF">Attestation URSSAF</option>
          <option value="INSURANCE">Assurance RC Pro</option>
          <option value="KBIS">Extrait Kbis</option>
          <option value="OTHER">Autre document</option>
        </Field>
        <Field name="expiresAt" label="Date d'expiration" type="date" hint="Obligatoire sauf Kbis" />
        <Field
          name="file"
          label="Fichier"
          type="file"
          required
          accept="application/pdf,image/png,image/jpeg"
          data-max-bytes={4 * 1024 * 1024}
          hint="PDF, PNG ou JPG, 4 Mo max."
        />
      </div>
    </ActionForm>
  );
}
