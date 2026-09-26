import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { addPatient, type Patient } from "@/lib/patients";
import { errorMessage } from "@/lib/api";
import {
  BIRTH_WEIGHT,
  isValid,
  validatePatient,
  type Errors,
} from "@/lib/validation";
import { Button, ErrorBand, Field, Note, Select, TextInput } from "@/components/ui";
import GestationalAgeField from "@/components/app/patient/GestationalAgeField";

/**
 * Adding a baby in the middle of a screening.
 *
 * Nothing clinical is filled in for you. It used to open with 28 weeks, 1000 g
 * and blood type O+ already in the boxes — and the first two are read by the
 * screening model, so a form nobody corrected produced a risk for a baby who
 * does not exist. The blood type was worse: a fact about a real person,
 * invented by a form.
 *
 * Mother's name is optional. A baby can reach the unit before the mother is
 * identified, and the save used to fail on it, mid-screening, with a validation
 * message from the server.
 */
export default function QuickPatientModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (patient: Patient) => void;
}) {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    gender: "Female" as "Male" | "Female",
    motherName: "",
    gestationalAge: "",
    birthWeight: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  }

  async function handleSave() {
    const found = validatePatient({
      firstName: form.firstName,
      lastName: form.lastName,
      dateOfBirth: form.dateOfBirth,
      gestationalAge:
        form.gestationalAge === "" ? undefined : Number(form.gestationalAge),
      birthWeight: form.birthWeight === "" ? undefined : Number(form.birthWeight),
    });
    setErrors(found);
    if (!isValid(found)) return;

    setSaving(true);
    setError("");
    try {
      onCreated(
        await addPatient({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          dateOfBirth: form.dateOfBirth,
          gender: form.gender,
          motherName: form.motherName.trim(),
          gestationalAge: Number(form.gestationalAge),
          birthWeight: Number(form.birthWeight),
          phone: "",
          email: "",
          address: "",
          // Left empty on purpose: this form has no business inventing one.
          bloodType: "",
          notes: "Added during a screening.",
          status: "Active",
        }),
      );
    } catch (e) {
      setError(errorMessage(e, "Could not add this patient."));
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add a patient"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-heading text-title text-ink">Add a patient</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-lg p-1 text-ink-3 transition-colors hover:bg-inset hover:text-ink"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="space-y-4 overflow-y-auto p-5">
          {error && <ErrorBand message={error} />}

          <div className="grid grid-cols-2 gap-4">
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
            <GestationalAgeField
              value={form.gestationalAge}
              error={errors.gestationalAge}
              onChange={(weeks) => update("gestationalAge", weeks)}
            />
            <Field
              label="Birth weight"
              required
              hint={`${BIRTH_WEIGHT.min}–${BIRTH_WEIGHT.max} g · read by the model`}
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
            <div className="col-span-2">
              <Field label="Mother's name" hint="Optional">
                {(props) => (
                  <TextInput
                    {...props}
                    value={form.motherName}
                    onChange={(e) => update("motherName", e.target.value)}
                  />
                )}
              </Field>
            </div>
          </div>

          <Note>
            Gestational age and birth weight go to the screening model along with
            the photographs. The rest of the record can be filled in later from the
            patient's page.
          </Note>
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-line bg-inset px-5 py-4">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={saving} onClick={() => void handleSave()}>
            Add patient
          </Button>
        </footer>
      </div>
    </div>
  );
}
