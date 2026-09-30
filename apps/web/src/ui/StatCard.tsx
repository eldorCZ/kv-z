import type { ReactNode } from 'react';
import { Card } from './Card';
import { NumberTicker } from './NumberTicker';

/**
 * Malá karta se štítkem a hodnotou nad galerií (Dodatek 5/5).
 *
 * Číslo se dopočítává přes `NumberTicker`, takže při omezeném pohybu naskočí rovnou.
 * `hint` je doplňující řádek pod hodnotou — drží se v něm vysvětlení, ne další číslo,
 * ať karta zůstane čitelná na jeden pohled.
 */
export function StatCard({ label, value, suffix = '', icon, hint }: { label: string; value: number; suffix?: string; icon?: ReactNode; hint?: string }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      {icon && <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-panel text-primary">{icon}</span>}
      <div className="min-w-0">
        <p className="truncate text-sm text-muted">{label}</p>
        <p className="font-display text-2xl font-bold">
          <NumberTicker value={value} suffix={suffix} />
        </p>
        {hint && <p className="truncate text-xs text-muted">{hint}</p>}
      </div>
    </Card>
  );
}
