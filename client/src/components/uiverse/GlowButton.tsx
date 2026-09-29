interface Props {
  children: React.ReactNode;
  variant?: 'default' | 'primary';
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}

/** Uiverse-inspired glow button — adapted from uiverse.io MIT-licensed elements. */
export default function GlowButton({ children, variant = 'default', onClick, disabled, type = 'button', className = '' }: Props) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`uiverse-btn ${variant === 'primary' ? 'uiverse-btn-primary' : ''} ${className}`}
    >
      {children}
    </button>
  );
}
