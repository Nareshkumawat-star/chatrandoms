import { Spinner } from './Spinner';

interface Props {
  children: React.ReactNode;
  variant?: 'default' | 'primary';
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}

/** Uiverse-inspired glow button — adapted from uiverse.io MIT-licensed elements. */
export default function GlowButton({
  children,
  variant = 'default',
  onClick,
  disabled,
  loading = false,
  type = 'button',
  className = '',
}: Props) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`uiverse-btn ${variant === 'primary' ? 'uiverse-btn-primary' : ''} ${className}`}
    >
      {loading && <Spinner size={15} />}
      {children}
    </button>
  );
}
