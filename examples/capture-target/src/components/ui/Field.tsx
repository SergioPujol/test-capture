import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

type BaseFieldProps = {
  label: string;
  hint?: string;
};

export function TextField({ label, hint, id, ...props }: BaseFieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const fieldId = id ?? props.name;
  return (
    <label className="field" htmlFor={fieldId}>
      <span className="field__label">{label}</span>
      <input id={fieldId} className="field__control" {...props} />
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export function SelectField({ label, hint, id, children, ...props }: BaseFieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const fieldId = id ?? props.name;
  return (
    <label className="field" htmlFor={fieldId}>
      <span className="field__label">{label}</span>
      <select id={fieldId} className="field__control" {...props}>
        {children}
      </select>
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export function TextAreaField({ label, hint, id, ...props }: BaseFieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const fieldId = id ?? props.name;
  return (
    <label className="field" htmlFor={fieldId}>
      <span className="field__label">{label}</span>
      <textarea id={fieldId} className="field__control field__control--textarea" {...props} />
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}
