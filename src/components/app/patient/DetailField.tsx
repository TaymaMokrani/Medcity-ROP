import type { ReactNode } from "react";
import { Field, Select, TextInput } from "@/components/ui";

/**
 * One fact about a patient, readable or editable in the same place.
 *
 * Reading and editing used to be two different layouts, so the page moved under
 * you when you pressed Edit. Same grid either way now: the label stays put and
 * only the value changes from text to a control.
 */
export default function DetailField({
  label,
  value,
  editing,
  type = "text",
  displayValue,
  options,
  onChange,
  error,
  hint,
  required,
  min,
  max,
}: {
  label: string;
  value: string;
  editing: boolean;
  type?: "text" | "date" | "number" | "select";
  /** What to print when not editing, if it differs from the raw value. */
  displayValue?: ReactNode;
  options?: string[];
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  min?: number;
  max?: number;
}) {
  if (!editing) {
    return (
      <div>
        <p className="text-label text-ink-3">{label}</p>
        {/* An email or an address can be longer than its column. */}
        <p className="mt-1 break-words text-body text-ink">
          {displayValue || value || <span className="text-ink-3">—</span>}
        </p>
      </div>
    );
  }

  return (
    <Field label={label} error={error} hint={hint} required={required}>
      {(props) =>
        type === "select" && options ? (
          <Select
            {...props}
            value={value}
            error={error}
            onChange={(event) => onChange(event.target.value)}
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        ) : (
          <TextInput
            {...props}
            type={type}
            min={min}
            max={max}
            value={value}
            error={error}
            onChange={(event) => onChange(event.target.value)}
          />
        )
      }
    </Field>
  );
}
