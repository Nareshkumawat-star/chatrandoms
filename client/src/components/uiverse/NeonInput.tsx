import { forwardRef } from 'react';

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  rightElement?: React.ReactNode;
}

/** Uiverse-inspired neon input — adapted from uiverse.io. */
const NeonInput = forwardRef<HTMLInputElement, Props>(function NeonInput({ label, rightElement, className = '', ...rest }, ref) {
  return (
    <label className="block text-left">
      {label && <span className="mb-1.5 block text-xs font-medium text-slate-300">{label}</span>}
      <div className="relative flex items-center">
        <input ref={ref} className={`uiverse-input ${rightElement ? 'pr-10' : ''} ${className}`} {...rest} />
        {rightElement && (
          <div className="absolute right-3 flex items-center text-slate-400 hover:text-slate-200 cursor-pointer select-none">
            {rightElement}
          </div>
        )}
      </div>
    </label>
  );
});

export default NeonInput;
