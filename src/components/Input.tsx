import { useId, useState } from "react";
import { Check, Eye, EyeOff, KeyRound, Mail, User } from "lucide-react";
import "./Input.css";

type InputType = "email" | "password" | "username";

const ICONS: Record<InputType, React.ReactNode> = {
  email: <Mail size={16} />,
  password: <KeyRound size={16} />,
  username: <User size={16} />,
};

const PASSWORD_RULES = [
  { label: "At least one capital letter", test: (v: string) => /[A-Z]/.test(v) },
  { label: "At least one number", test: (v: string) => /[0-9]/.test(v) },
  { label: "At least 8 characters", test: (v: string) => v.length >= 8 },
];

/**
 * The sign-in field. Same look as before; it now behaves like a form field.
 *
 * The floating placeholder was a `<p>`, so the input had no name a screen
 * reader or a password manager could read, and `autoComplete="off"` told the
 * browser not to offer saved credentials — on a clinical workstation, that is a
 * password typed by hand several times a day. It is a real `<label>` now, tied
 * to the input, with the right autocomplete token, and the show-password button
 * is a button rather than a div that only appeared once the field had focus.
 */
export default function Input({
  type = "password",
  label,
  value,
  onChange,
  autoComplete,
  passwordStrength = true,
  className = "",
  dark = false,
  required = false,
}: {
  type?: InputType;
  /** Shown floating over the field, and read out as the field's name. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  passwordStrength?: boolean;
  className?: string;
  dark?: boolean;
  required?: boolean;
}) {
  const id = useId();
  const [hidden, setHidden] = useState(true);

  const isPassword = type === "password";
  const showStrength = isPassword && passwordStrength;

  return (
    <div className={`input-field ${className}`} data-dark={dark}>
      <div className="icon" aria-hidden>
        {ICONS[type]}
      </div>

      <input
        id={id}
        name={type === "username" ? "name" : type}
        type={isPassword && hidden ? "password" : type === "username" ? "text" : type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        data-empty={value === ""}
      />
      <label htmlFor={id}>{label}</label>

      {isPassword && (
        <button
          type="button"
          className="toggle"
          aria-label={hidden ? "Show the password" : "Hide the password"}
          aria-pressed={!hidden}
          onClick={() => setHidden(!hidden)}
        >
          {hidden ? <Eye size={18} /> : <EyeOff size={18} />}
        </button>
      )}

      {showStrength && (
        <div className="input-strength">
          <div className="bars" aria-hidden>
            {PASSWORD_RULES.map((rule) => (
              <progress key={rule.label} value={rule.test(value) ? 10 : 0} max="10" />
            ))}
          </div>
          <div className="rules">
            {PASSWORD_RULES.map((rule) => (
              <div key={rule.label} className="rule" data-met={rule.test(value)}>
                <span className="check" aria-hidden>
                  <Check size={12} />
                </span>
                {rule.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
