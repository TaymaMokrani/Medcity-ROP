import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Save } from "lucide-react";
import AppPage from "@/components/app/AppPage";
import {
  Band,
  Button,
  ErrorBand,
  Field,
  Note,
  Select,
  TextInput,
  Textarea,
} from "@/components/ui";
import { addPatient, type Patient } from "@/lib/patients";
import { errorMessage } from "@/lib/api";
import {
  BIRTH_WEIGHT,
  isValid,
  validatePatient,
  type Errors,
} from "@/lib/validation";
import GestationalAgeField from "@/components/app/patient/GestationalAgeField";
import { useUnsavedWork } from "@/hooks/unsaved";
import { useTitle } from "@/hooks/useTitle";

type Form = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: "Male" | "Female";
  gestationalAge: string;
  birthWeight: string;
  motherName: string;
  phone: string;
  email: string;
  address: string;
  bloodType: string;
  notes: string;
};

const EMPTY: Form = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  gender: "Female",
  // Empty, not 28 and 1000. Both are read by the screening model, and a number
  // nobody typed is indistinguishable from one somebody did.
  gestationalAge: "",
  birthWeight: "",
  motherName: "",
  phone: "",
  email: "",
  address: "",
  bloodType: "",
  notes: "",
};

/**
 * Registering a baby.
 *
 * Two sections rather than five, and the clinical fields are not buried among
 * the contact details: the three that decide screening — date of birth,
 * gestational age, birth weight — come first and say what reads them. The
 * administrative status field is gone; a patient's state comes from their
 * screenings.
 */
export default function NewPatient() {
  useTitle("New patient");
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const touched = JSON.stringify(form) !== JSON.stringify(EMPTY);
  useUnsavedWork(touched && !saving, "This patient has not been saved.");

  function update(key: keyof Form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  }

  async function handleSubmit() {
    const found = validatePatient({
      firstName: form.firstName,
      lastName: form.lastName,
      dateOfBirth: form.dateOfBirth,
      gestationalAge: form.gestationalAge === "" ? undefined : Number(form.gestationalAge),
      birthWeight: form.birthWeight === "" ? undefined : Number(form.birthWeight),
    });
    setErrors(found);
    if (!isValid(found)) return;

    setSaving(true);
    setError("");
    try {
      const saved: Patient = await addPatient({
        ...form,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        gestationalAge: Number(form.gestationalAge),
        birthWeight: Number(form.birthWeight),
        status: "Active",
      });
      navigate(`/app/patient/${saved.id}`, { replace: true });
    } catch (e) {
      setError(errorMessage(e, "Could not save this patient."));
      setSaving(false);
    }
  }

  return (
    <AppPage>
      <div className="mx-auto max-w-4xl p-6 md:p-10">
        <header className="mb-2">
          <h1 className="font-heading text-display text-ink">New patient</h1>
          <p className="mt-1.5 text-body text-ink-3">
            Enough to screen with. The rest can be filled in from the record later.
          </p>
        </header>

        <Band title="Identity">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="First name" required error={errors.firstName}>
              {(props) => (
                <TextInput
                  {...props}
                  value={form.firstName}
                  error={errors.firstName}
                  onChange={(e) => update("firstName", e.target.value)}
                />
              )}
            </Field>
            <Field label="Last name" required error={errors.lastName}>
              {(props) => (
                <TextInput
                  {...props}
                  value={form.lastName}
                  error={errors.lastName}
                  onChange={(e) => update("lastName", e.target.value)}
                />
              )}
            </Field>
            <Field label="Date of birth" required error={errors.dateOfBirth}>
              {(props) => (
                <TextInput
                  {...props}
                  type="date"
                  value={form.dateOfBirth}
                  error={errors.dateOfBirth}
                  onChange={(e) => update("dateOfBirth", e.target.value)}
                />
              )}
            </Field>
            <Field label="Sex">
              {(props) => (
                <Select
                  {...props}
                  value={form.gender}
                  onChange={(e) => update("gender", e.target.value)}
                >
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                </Select>
              )}
            </Field>
          </div>
        </Band>

        <Band title="Birth" meta="Sent to the screening model with every set of photographs">
          <div className="grid gap-5 sm:grid-cols-3">
            <GestationalAgeField
              value={form.gestationalAge}
              error={errors.gestationalAge}
              onChange={(weeks) => update("gestationalAge", weeks)}
            />
            <Field
              label="Birth weight"
              required
              hint={`${BIRTH_WEIGHT.min}–${BIRTH_WEIGHT.max} g`}
              error={errors.birthWeight}
            >
              {(props) => (
                <TextInput
                  {...props}
                  type="number"
                  inputMode="numeric"
                  placeholder="grams"
                  min={BIRTH_WEIGHT.min}
                  max={BIRTH_WEIGHT.max}
                  value={form.birthWeight}
                  error={errors.birthWeight}
                  onChange={(e) => update("birthWeight", e.target.value)}
                />
              )}
            </Field>
            <Field label="Blood type" hint="Optional">
              {(props) => (
                <TextInput
                  {...props}
                  value={form.bloodType}
                  placeholder="e.g. O+"
                  onChange={(e) => update("bloodType", e.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="mt-5">
            <Note>
              These two numbers go to the model alongside the photographs, so a
              mistyped weight comes back as a risk that looks exactly like a real
              one. They are checked here and again by the gateway.
            </Note>
          </div>
        </Band>

        <Band title="Family and contact" meta="All optional">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Mother's name">
              {(props) => (
                <TextInput
                  {...props}
                  value={form.motherName}
                  onChange={(e) => update("motherName", e.target.value)}
                />
              )}
            </Field>
            <Field label="Phone">
              {(props) => (
                <TextInput
                  {...props}
                  type="tel"
                  value={form.phone}
                  onChange={(e) => update("phone", e.target.value)}
                />
              )}
            </Field>
            <Field label="Email">
              {(props) => (
                <TextInput
                  {...props}
                  type="email"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                />
              )}
            </Field>
            <Field label="Address">
              {(props) => (
                <TextInput
                  {...props}
                  value={form.address}
                  onChange={(e) => update("address", e.target.value)}
                />
              )}
            </Field>
          </div>
        </Band>

        <Band title="Notes">
          <Textarea
            rows={4}
            aria-label="Notes"
            placeholder="Anything the unit should know about this baby."
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
          />
        </Band>

        {error && (
          <div className="mt-6">
            <ErrorBand message={error} />
          </div>
        )}

        <div className="mt-8 flex items-center justify-end gap-3 border-t border-line pt-6">
          <Button icon={ArrowLeft} onClick={() => navigate("/app/patient")}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="lg"
            icon={Save}
            busy={saving}
            onClick={() => void handleSubmit()}
          >
            Save patient
          </Button>
        </div>
      </div>
    </AppPage>
  );
}
