import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AnswerMark, ANSWER_STYLES } from '../components/Shapes';
import { Badge, Button } from '../components/ui';
import { Logo } from '../ui/Logo';
import { SchemeSwitcher } from '../ui/SchemeSwitcher';
import type { MascotPose } from '../ui/Mascot';
import { MOTIVE_LIST } from '@kvizhub/core/client';
import { motiveThumb } from '../components/ThemePicker';

const COLORS = [
  'canvas', 'surface', 'surface-2', 'fg', 'muted', 'line', 'line-strong',
  'primary', 'primary-hover', 'on-primary', 'primary-soft', 'on-primary-soft',
  'accent', 'on-accent', 'success', 'success-soft', 'success-strong', 'warning', 'warning-soft', 'warning-line',
  'danger', 'danger-soft', 'info', 'info-soft', 'focus',
];

function Swatch({ name }: { name: string }) {
  const [value, setValue] = useState('');
  useEffect(() => {
    const update = () => setValue(getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim());
    update();
    const o = new MutationObserver(update);
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => o.disconnect();
  }, [name]);
  return (
    <li className="overflow-hidden rounded-md border border-line bg-surface text-xs">
      <div className="h-12" ref={(el) => el?.style.setProperty('background', `var(--${name})`)} />
      <div className="p-2">
        <p className="font-semibold">--{name}</p>
        <p className="font-mono text-muted">{value}</p>
      </div>
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-5 shadow-soft">
      <h2 className="text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Development page (Dodatek 4, V9.1): tokens, components and (later) motives in the current scheme.
 * Enabled only with DESIGN_PAGE=1 (e2e, visual tests) or in development.
 */
export default function DesignPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    fetch('/api/auth/config')
      .then((r) => r.json())
      .then((c: { designPage?: boolean }) => setEnabled(!!c.designPage))
      .catch(() => setEnabled(false));
  }, []);
  if (enabled === null) return null;
  if (!enabled)
    return (
      <p className="p-8">
        Stránka není dostupná. <Link to="/">Zpět</Link>
      </p>
    );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6" data-testid="design-page">
      <header className="flex items-center gap-4">
        <Logo height={40} />
        <span className="text-muted">/_design</span>
        <SchemeSwitcher className="ml-auto" />
      </header>

      <Section title="Barevné tokeny">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {COLORS.map((c) => (
            <Swatch key={c} name={c} />
          ))}
        </ul>
      </Section>

      <Section title="Odpovědi: tvar, písmeno, barva">
        <div className="grid gap-3 sm:grid-cols-5">
          {ANSWER_STYLES.map((s, i) => (
            <div key={s.name} className={`flex min-h-16 items-center gap-3 rounded-md p-4 text-lg font-semibold ${s.bg} ${s.fg}`}>
              <AnswerMark index={i} />
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Značka">
        <div className="grid gap-4 lg:grid-cols-2" data-testid="brand-sheet">
          {(['light', 'dark'] as const).map((sc) => (
            <div key={sc} data-theme={sc} className="space-y-4 rounded-md border border-line bg-surface p-4 text-fg" data-testid={`brand-${sc}`}>
              <p className="text-sm font-semibold text-muted">{sc === 'light' ? 'Světlý povrch' : 'Tmavý povrch'}</p>
              <div className="flex flex-wrap items-end gap-6">
                <Logo height={56} scheme={sc} />
                <Logo variant="mark" height={56} scheme={sc} />
                <Logo variant="wordmark" height={40} scheme={sc} />
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <span className="rounded-md bg-primary p-3 text-[#ffffff]">
                  <Logo height={32} tone="mono" />
                </span>
                {/* clear zone: at least the height of the letter "o" around the logo */}
                <span className="inline-block outline-2 outline-dashed outline-line-strong" style={{ padding: 18 }}>
                  <Logo height={32} scheme={sc} />
                </span>
              </div>
              <div className="flex flex-wrap items-end gap-4 text-xs text-muted">
                <span className="flex flex-col items-center gap-1">
                  <Logo variant="mark" height={16} scheme={sc} />
                  znak 16 px
                </span>
                <span className="flex flex-col items-center gap-1">
                  <Logo height={24} scheme={sc} />
                  logo 24 px
                </span>
                <span className="flex flex-col items-center gap-1">
                  <Logo variant="wordmark" height={20} scheme={sc} />
                  slovní znak 20 px
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {(['hello', 'think', 'celebrate', 'encourage', 'sleep', 'error'] as MascotPose[]).map((p) => (
                  <figure key={p} className="text-center text-xs text-muted">
                    <img src={`/brand/mascot/lore-${p}.svg`} alt="" width={96} height={103} />
                    <figcaption>{p}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Motivy">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {MOTIVE_LIST.map((m) => (
            <figure key={m.id} className="text-sm">
              <img src={motiveThumb(m.id, document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')} alt="" className="aspect-video w-full rounded-sm border border-line object-cover" />
              <figcaption>
                {m.name} {m.calm ? '· klidný' : ''} {m.animated ? '· pohyb' : ''}
              </figcaption>
            </figure>
          ))}
        </div>
      </Section>
      <Section title="Tlačítka a odznaky">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary">Primární</Button>
          <Button>Sekundární</Button>
          <Button variant="ghost">Nenápadné</Button>
          <Button variant="danger">Smazat</Button>
          <Button variant="success">Spustit</Button>
          <Button disabled>Nedostupné</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="ok">v pořádku</Badge>
          <Badge tone="flagged">ke kontrole</Badge>
          <Badge tone="approved">schváleno</Badge>
          <Badge tone="neutral">koncept</Badge>
        </div>
      </Section>

      <Section title="Písmo">
        <p className="font-display text-3xl">Příliš žluťoučký kůň úpěl ďábelské ódy</p>
        <p className="text-lg">Příliš žluťoučký kůň úpěl ďábelské ódy – PŘÍLIŠ ŽLUŤOUČKÝ KŮŇ ÚPĚL ĎÁBELSKÉ ÓDY</p>
        <p className="tabular text-4xl font-extrabold tracking-widest">482 913 · K7MQ-2XRT</p>
      </Section>
    </div>
  );
}
