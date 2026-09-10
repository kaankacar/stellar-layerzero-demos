import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Loaded, LoadStatus } from '@/lib/cache';
import { safeJson, timeAgo, truncate } from '@/lib/format';

export function Section({ title, subtitle, right, children, className = '' }: { title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-4 sm:p-5 ${className}`}>
      {title || right ? (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title ? <h2 className="text-base font-semibold">{title}</h2> : null}
            {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
          </div>
          {right}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'danger' | 'ok' | 'mainnet' | 'testnet'; title?: ReactNode; children: ReactNode }) {
  const cls = {
    info: 'border-accent/40 bg-accent/10',
    warn: 'border-warn/50 bg-warn/10',
    danger: 'border-danger/50 bg-danger/10',
    ok: 'border-ok/40 bg-ok/10',
    mainnet: 'border-mainnet/50 bg-mainnet/10',
    testnet: 'border-testnet/50 bg-testnet/10',
  }[tone];
  return (
    <div className={`rounded-lg border p-3 text-sm ${cls}`}>
      {title ? <div className="mb-1 font-semibold">{title}</div> : null}
      <div className="prose-demo [&>p:last-child]:mb-0">{children}</div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted">
      <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-accent" />
      {label ?? 'Loading…'}
    </span>
  );
}

export function Skeleton({ className = 'h-5 w-32' }: { className?: string }) {
  return <span className={`skeleton inline-block rounded ${className}`} />;
}

const STATUS_LABEL: Record<LoadStatus, { text: string; cls: string }> = {
  loading: { text: 'loading', cls: 'border-border text-muted' },
  live: { text: 'live', cls: 'border-ok/50 text-ok' },
  stale: { text: 'stale (cached)', cls: 'border-warn/50 text-warn' },
  fallback: { text: 'live data unavailable · bundled fallback', cls: 'border-warn/50 text-warn' },
  unavailable: { text: 'live data unavailable', cls: 'border-danger/50 text-danger' },
};

/** Freshness pill: how live is the data on screen, and a reload button. */
export function DataStatus<T>({ state, reload, label }: { state: Loaded<T>; reload?: () => void; label?: string }) {
  const s = STATUS_LABEL[state.status];
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className={`pill ${s.cls}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${state.status === 'live' ? 'bg-ok pulse-dot' : state.status === 'loading' ? 'bg-muted pulse-dot' : 'bg-warn'}`} />
        {label ? `${label}: ` : ''}
        {s.text}
        {state.fetchedAt ? ` · ${timeAgo(state.fetchedAt)}` : ''}
      </span>
      {state.error ? <span className="text-danger" title={state.error}>{state.error.slice(0, 80)}</span> : null}
      {reload ? (
        <button className="text-muted hover:text-text" onClick={reload} title="Reload">
          ↻ refresh
        </button>
      ) : null}
    </div>
  );
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      className="btn px-2 py-1 text-xs"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => undefined);
        setOk(true);
        setTimeout(() => setOk(false), 1200);
      }}
    >
      {ok ? '✓ copied' : label ?? 'copy'}
    </button>
  );
}

export function AddressChip({ address, href, label, full = false }: { address: string; href?: string; label?: string; full?: boolean }) {
  const [ok, setOk] = useState(false);
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-xs">
      {label ? <span className="text-muted">{label}</span> : null}
      <span className="mono break-all" title={address}>
        {full ? address : truncate(address, 8, 6)}
      </span>
      <button
        className="text-muted hover:text-text"
        title="Copy"
        onClick={async () => {
          await navigator.clipboard.writeText(address).catch(() => undefined);
          setOk(true);
          setTimeout(() => setOk(false), 1000);
        }}
      >
        {ok ? '✓' : '⧉'}
      </button>
      {href ? (
        <a className="text-accent hover:underline" href={href} target="_blank" rel="noreferrer" title="Open in explorer">
          ↗
        </a>
      ) : null}
    </span>
  );
}

/** Animated number for stats. */
export function CountUp({ value, digits = 0, prefix = '', suffix = '', duration = 900 }: { value: number; digits?: number; prefix?: string; suffix?: string; duration?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    const b = value;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(a + (b - a) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return (
    <span className="tabular-nums">
      {prefix}
      {shown.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })}
      {suffix}
    </span>
  );
}

export function StatTile({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'danger' }) {
  const t = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : '';
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${t}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

/** "Verify it yourself": the exact request and the raw response. */
export function JsonReveal({ title = 'Verify it yourself', request, data, defaultOpen = false }: { title?: string; request?: string; data: unknown; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const text = safeJson(data);
  return (
    <div className="mt-2 text-xs">
      <button className="text-accent hover:underline" onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} {title}
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          {request ? (
            <div className="flex items-center gap-2 overflow-x-auto rounded-md bg-code-bg p-2">
              <span className="text-muted">request</span>
              <code className="break-all">{request}</code>
            </div>
          ) : null}
          <div className="relative">
            <pre className="max-h-80 overflow-auto rounded-md bg-code-bg p-3 text-[11px] leading-relaxed">{text}</pre>
            <div className="absolute right-2 top-2">
              <CopyButton text={text} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Minimal syntax colouring for TS/Rust/Solidity/bash snippets (good enough to read, no dependency). */
export function highlight(code: string): ReactNode[] {
  const tokens = code.split(/(\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|\b(?:const|let|var|function|return|await|async|import|export|from|type|interface|if|else|new|throw|for|of|while|class|extends|pub|fn|impl|struct|enum|use|mut|let|match|contract|address|uint256|bytes32|memory|calldata|payable|external|public|view|returns|emit|require|mapping)\b)/g);
  return tokens.map((t, i) => {
    if (!t) return null;
    if (t.startsWith('//') || t.startsWith('/*')) return <span key={i} className="text-muted italic">{t}</span>;
    if (/^['"`]/.test(t)) return <span key={i} className="text-ok">{t}</span>;
    if (/^(const|let|var|function|return|await|async|import|export|from|type|interface|if|else|new|throw|for|of|while|class|extends|pub|fn|impl|struct|enum|use|mut|match|contract|address|uint256|bytes32|memory|calldata|payable|external|public|view|returns|emit|require|mapping)$/.test(t))
      return <span key={i} className="text-accent">{t}</span>;
    return <span key={i}>{t}</span>;
  });
}

export function CodeBlock({ code, title, lang }: { code: string; title?: string; lang?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-code-bg">
      {(title || lang) && (
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-muted">
          <span>{title}</span>
          <span className="flex items-center gap-2">
            {lang ? <span>{lang}</span> : null}
            <CopyButton text={code} />
          </span>
        </div>
      )}
      <pre className="overflow-x-auto p-3 text-[12px] leading-relaxed">
        <code>{highlight(code)}</code>
      </pre>
    </div>
  );
}

/** Collapsible "What's happening here?" panel, open by default the first time a visitor sees it. */
export function Explainer({ id, title = "What's happening here?", children, diagram }: { id: string; title?: string; children: ReactNode; diagram?: ReactNode }) {
  const key = `explainer:${id}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(key) !== 'closed';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(key, o ? 'closed' : 'open');
      } catch {
        /* ignore */
      }
      return !o;
    });
  };
  return (
    <section className="card overflow-hidden">
      <button className="flex w-full items-center justify-between px-4 py-3 text-left" onClick={toggle}>
        <span className="flex items-center gap-2 font-semibold">
          <span>💡</span> {title}
        </span>
        <span className="text-muted">{open ? 'hide' : 'show'}</span>
      </button>
      {open ? (
        <div className="grid gap-4 border-t border-border p-4 sm:p-5 lg:grid-cols-[1fr_minmax(0,420px)]">
          <div className="prose-demo text-sm">{children}</div>
          {diagram ? <div className="min-w-0">{diagram}</div> : null}
        </div>
      ) : null}
    </section>
  );
}

export interface HoodItem {
  title: string;
  code: string;
  lang?: string;
  note?: ReactNode;
  /** Live request/response captured by the page for this snippet. */
  live?: { request?: string; data: unknown };
}

/** "Under the hood": the actual code this page runs, extracted from the source at build time. */
export function UnderTheHood({ items }: { items: HoodItem[] }) {
  const [active, setActive] = useState(0);
  const item = items[active] ?? items[0];
  if (!item) return null;
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <span>🔧</span> Under the hood
        </h2>
        <span className="text-xs text-muted">Real code from this repo, not pseudocode</span>
      </div>
      {items.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-1">
          {items.map((it, i) => (
            <button key={it.title} className={`rounded-md px-2.5 py-1 text-xs ${i === active ? 'bg-accent-strong text-white' : 'bg-surface-2 text-muted hover:text-text'}`} onClick={() => setActive(i)}>
              {it.title}
            </button>
          ))}
        </div>
      ) : null}
      {item.note ? <div className="prose-demo mb-3 text-sm">{item.note}</div> : null}
      <CodeBlock code={item.code} title={item.title} lang={item.lang ?? 'ts'} />
      {item.live ? <JsonReveal title="Live request / response from this page" request={item.live.request} data={item.live.data} /> : null}
    </section>
  );
}

export interface ConsoleEntry {
  id: number;
  time: number;
  level: 'info' | 'ok' | 'warn' | 'error';
  title: string;
  detail?: string;
  payload?: unknown;
}

/** Expandable transaction console: every XDR / calldata the demo is about to submit. */
export function ConsolePanel({ entries, onClear }: { entries: ConsoleEntry[]; onClear?: () => void }) {
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setOpenIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const color = { info: 'text-muted', ok: 'text-ok', warn: 'text-warn', error: 'text-danger' };
  return (
    <div className="rounded-lg border border-border bg-code-bg text-xs">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="font-semibold">Console · {entries.length} entries</span>
        {onClear ? (
          <button className="text-muted hover:text-text" onClick={onClear}>clear</button>
        ) : null}
      </div>
      <div className="max-h-96 overflow-auto p-2 font-mono">
        {entries.length === 0 ? <div className="p-2 text-muted">Nothing yet. Actions you take here will log their exact XDR / calldata.</div> : null}
        {entries.map((e) => (
          <div key={e.id} className="border-b border-border/50 py-1.5 last:border-0">
            <button className="flex w-full items-start gap-2 text-left" onClick={() => toggle(e.id)}>
              <span className="text-muted">{new Date(e.time).toISOString().slice(11, 19)}</span>
              <span className={color[e.level]}>{e.level === 'ok' ? '✓' : e.level === 'error' ? '✗' : e.level === 'warn' ? '!' : '›'}</span>
              <span className="flex-1">{e.title}</span>
              {e.payload !== undefined || e.detail ? <span className="text-muted">{openIds.has(e.id) ? '▾' : '▸'}</span> : null}
            </button>
            {openIds.has(e.id) && (e.detail || e.payload !== undefined) ? (
              <div className="mt-1 space-y-1 pl-6">
                {e.detail ? <div className="whitespace-pre-wrap text-muted">{e.detail}</div> : null}
                {e.payload !== undefined ? (
                  <div className="relative">
                    <pre className="max-h-60 overflow-auto rounded bg-bg p-2 text-[11px]">{typeof e.payload === 'string' ? e.payload : safeJson(e.payload)}</pre>
                    <div className="absolute right-1 top-1"><CopyButton text={typeof e.payload === 'string' ? e.payload : safeJson(e.payload)} /></div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function useConsole() {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const next = useRef(1);
  const log = (level: ConsoleEntry['level'], title: string, detail?: string, payload?: unknown) => {
    setEntries((es) => [...es, { id: next.current++, time: Date.now(), level, title, detail, payload }]);
  };
  return { entries, log, clear: () => setEntries([]) };
}
