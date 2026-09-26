import { useId } from 'react';
import { appName } from '../app-config';

/** The Jiskra mark: a four-point spark with a small notch, amber to coral (Dodatek 4, V2.2). */
export function SparkMark({ className = 'h-8 w-8', mono = false }: { className?: string; mono?: boolean }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        {!mono && (
          <linearGradient id={`g${id}`} x1="12" y1="8" x2="52" y2="56" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#ffc247" />
            <stop offset="1" stopColor="#ff5a5f" />
          </linearGradient>
        )}
        <mask id={`n${id}`}>
          <rect width="64" height="64" fill="#fff" />
          <path d="M37 37 42.2 38.6 38.6 42.2z" fill="#000" />
        </mask>
      </defs>
      <path
        mask={`url(#n${id})`}
        fill={mono ? 'currentColor' : `url(#g${id})`}
        d="M32 6c1.9 14.8 8.6 22.6 24 26-15.4 3.4-22.1 11.2-24 26-1.9-14.8-8.6-22.6-24-26 15.4-3.4 22.1-11.2 24-26z"
      />
      <circle cx="47" cy="16" r="3.2" fill={mono ? 'currentColor' : '#ffc247'} />
    </svg>
  );
}

/** Mark + wordmark in the heading font; works on light and dark surfaces through currentColor. */
export function Logo({ className = '', size = 'md' }: { className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const s = { sm: ['h-6 w-6', 'text-lg'], md: ['h-8 w-8', 'text-2xl'], lg: ['h-12 w-12', 'text-4xl'] }[size];
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <SparkMark className={s[0]} />
      <span className={`font-display font-bold leading-none text-fg ${s[1]}`}>{appName}</span>
    </span>
  );
}
