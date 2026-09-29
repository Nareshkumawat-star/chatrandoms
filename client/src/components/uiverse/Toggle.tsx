interface Props {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}

/** Uiverse-inspired iOS-style toggle — adapted from uiverse.io. */
export default function Toggle({ on, onChange, label }: Props) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className="uiverse-toggle"
        data-on={on}
        onClick={() => onChange(!on)}
      />
      {label && <span className="text-sm text-slate-300">{label}</span>}
    </label>
  );
}
