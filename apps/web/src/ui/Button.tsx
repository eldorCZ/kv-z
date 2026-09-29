import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success' | 'accent';
export type ButtonSize = 'sm' | 'md' | 'lg';

// outline-like variants (Dodatek 5, point 1): a quiet 1px --line border; ghost keeps a transparent one so
// hovering never changes its size. shadow-pop stays only on primary and only in the playful mood (tokens).
const OUTLINE = 'border border-line bg-surface text-fg hover:border-line-strong hover:bg-surface-2';
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover shadow-pop',
  secondary: OUTLINE,
  outline: OUTLINE,
  ghost: 'border border-transparent text-fg hover:border-line hover:bg-surface-2',
  danger: 'bg-danger text-on-danger hover:brightness-95',
  success: 'bg-success-strong text-on-success hover:brightness-95',
  accent: 'bg-accent text-on-accent hover:brightness-95',
};
const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-sm',
  md: 'min-h-11 px-4 text-sm',
  lg: 'min-h-14 px-6 text-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  loading?: boolean;
}

/** Button (V9.1): in the playful mood it gets a solid bottom shadow and presses down. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading = false, className = '', children, disabled, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`btn-press inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-[background-color,filter,transform,box-shadow] duration-[var(--motion-fast)] disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
});

/** Icon-only button with a mandatory accessible name; touch target at least 44 × 44 px (V11.1). */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'icon' | 'children'> & { label: string; children: ReactNode }>(function IconButton(
  { label, children, variant = 'ghost', className = '', ...props },
  ref,
) {
  return (
    <Button ref={ref} variant={variant} aria-label={label} title={label} className={`min-w-11 px-0 ${className}`} {...props}>
      {children}
    </Button>
  );
});
