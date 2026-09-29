import { forwardRef } from 'react';

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

/** Uiverse-inspired neon input — adapted from uiverse.io. */
const NeonInput = forwardRef<HTMLInputElement, Props>(function NeonInput({ label, ...rest }, ref) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>}
      <input ref={ref} className="uiverse-input" {...rest} />
    </label>
  );
});

export default NeonInput;
