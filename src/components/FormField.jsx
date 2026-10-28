export default function FormField({ label, hint, children, ...inputProps }) {
  return <label>{label}{children || <input {...inputProps} />}{hint && <small className="field-hint">{hint}</small>}</label>;
}
