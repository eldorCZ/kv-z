import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
}
const Ctx = createContext<(text: string, tone?: Tone) => void>(() => undefined);
const ICON = { success: CheckCircle2, error: XCircle, info: Info };
const CLS = { success: 'border-success bg-success-soft text-success', error: 'border-danger bg-danger-soft text-danger', info: 'border-info bg-info-soft text-info' };

/** Toasts in a polite live region (errors assertive); disappear after 5 s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: Tone = 'info') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 5000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
        {items.map((i) => {
          const Icon = ICON[i.tone];
          return (
            <div key={i.id} role={i.tone === 'error' ? 'alert' : 'status'} className={`pointer-events-auto flex items-start gap-2 rounded-md border p-3 text-sm font-semibold shadow-soft ${CLS[i.tone]}`}>
              <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="flex-1">{i.text}</span>
              <button className="rounded" aria-label="Zavřít" onClick={() => setItems((x) => x.filter((y) => y.id !== i.id))}>
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
