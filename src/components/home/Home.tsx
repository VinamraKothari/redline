"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FileCode2, Monitor, Smartphone, Tablet, Trash2 } from "lucide-react";
import { api, setOwnerKey } from "@/lib/api";
import { VIEWPORTS } from "@/lib/types";
import { cn, hostOf, normalizeUrl, timeAgo } from "@/lib/util";
import { Logo } from "@/components/Logo";

interface Recent {
  id: string;
  url: string;
  title: string;
  at: string;
}
const RECENT_KEY = "redline:recent";

export function rememberRecent(r: Recent) {
  try {
    const list = (JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") as Recent[]).filter((x) => x.id !== r.id);
    list.unshift(r);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 12)));
  } catch {
    /* ignore */
  }
}

export function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [viewport, setViewport] = useState(1440);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"));
    } catch {
      /* ignore */
    }
  }, []);

  async function start(e?: React.FormEvent) {
    e?.preventDefault();
    const n = normalizeUrl(url);
    if (!n) {
      setError("Enter a web address, like stripe.com or https://example.com/pricing");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { review } = await api.createReview({ url: n, viewport });
      setOwnerKey(review.id, review.owner_key);
      rememberRecent({ id: review.id, url: review.url, title: review.title, at: review.created_at });
      router.push(`/r/${review.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function upload(file: File) {
    if (!/\.html?$/i.test(file.name) && file.type !== "text/html") {
      setError("Drop an .html file.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const html = await file.text();
      const { review } = await api.createReview({ mode: "upload", html, title: file.name.replace(/\.html?$/i, ""), viewport });
      setOwnerKey(review.id, review.owner_key);
      rememberRecent({ id: review.id, url: review.url, title: review.title, at: review.created_at });
      router.push(`/r/${review.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  function forget(id: string) {
    const list = recent.filter((r) => r.id !== id);
    setRecent(list);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch {
      /* ignore */
    }
  }

  return (
    <main
      className="relative h-full overflow-y-auto overflow-x-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) upload(f);
      }}
    >
      {/* backdrop: faint blueprint grid + one red stroke */}
      <div className="pointer-events-none absolute inset-0 canvas-grid opacity-60" />
      <svg className="pointer-events-none absolute -right-24 top-24 h-[520px] w-[720px] opacity-90" viewBox="0 0 720 520" fill="none">
        <path d="M20 400 C 180 380, 260 120, 420 140 S 640 300, 700 60" stroke="var(--red)" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="420" cy="140" r="14" fill="var(--red)" />
        <text x="415" y="145" fill="#fff" fontSize="12" fontWeight="700" fontFamily="var(--font-ui)">1</text>
        <rect x="470" y="220" width="180" height="92" rx="6" stroke="var(--blue)" strokeWidth="1.5" strokeDasharray="4 4" />
        <text x="478" y="212" fill="var(--blue)" fontSize="11" fontFamily="var(--font-mono)">180 × 92</text>
      </svg>

      <div className="relative mx-auto flex min-h-full max-w-[880px] flex-col px-6 pb-10 pt-10">
        <header className="flex items-center justify-between">
          <Logo />
          <a
            href="https://github.com/VinamraKothari/redline"
            target="_blank"
            rel="noreferrer"
            className="text-[12px] text-ink-3 hover:text-ink"
          >
            GitHub
          </a>
        </header>

        <section className="mt-24 max-w-[620px]">
          <h1 className="text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] text-ink">
            Design feedback on
            <br />
            any <span className="relative inline-block">live website<span className="absolute -bottom-1 left-0 h-[3px] w-full rounded bg-red" /></span>.
          </h1>
          <p className="mt-4 max-w-[480px] text-[15px] leading-relaxed text-ink-2">
            Load a page, pin comments like Figma, draw on it, inspect type, colour and spacing — then share the marked-up canvas with a
            link.
          </p>

          <form onSubmit={start} className="mt-9">
            <div
              className={cn(
                "flex items-center gap-2 rounded-xl bg-panel p-1.5 shadow-pop transition-shadow",
                "focus-within:shadow-[0_0_0_2px_var(--blue),var(--shadow-pop)]",
                dragging && "shadow-[0_0_0_2px_var(--red),var(--shadow-pop)]",
              )}
            >
              <input
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste a URL — e.g. linear.app or vercel.com/pricing"
                spellCheck={false}
                className="h-11 flex-1 bg-transparent px-3 text-[15px] text-ink placeholder:text-ink-3 outline-none"
              />
              <div className="hidden items-center gap-0.5 rounded-lg bg-hover p-0.5 sm:flex">
                {[
                  { w: 1440, Icon: Monitor, t: "Desktop 1440" },
                  { w: 1024, Icon: Tablet, t: "Tablet 1024" },
                  { w: 390, Icon: Smartphone, t: "Phone 390" },
                ].map(({ w, Icon, t }) => (
                  <button
                    key={w}
                    type="button"
                    title={t}
                    onClick={() => setViewport(w)}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                      viewport === w ? "bg-panel text-ink shadow-sm" : "text-ink-3 hover:text-ink",
                    )}
                  >
                    <Icon size={15} />
                  </button>
                ))}
              </div>
              <button
                type="submit"
                disabled={busy}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-[13px] font-medium text-white transition-colors hover:bg-black disabled:opacity-60"
              >
                {busy ? "Opening…" : "Review"}
                {!busy && <ArrowRight size={14} />}
              </button>
            </div>
            <div className="mt-3 flex items-center gap-4 text-[12.5px] text-ink-3">
              <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 hover:text-ink">
                <FileCode2 size={13} /> or drop an .html file anywhere
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".html,.htm,text/html"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              />
              <span className="hidden sm:inline">
                Viewport:{" "}
                <span className="mono text-ink-2">{VIEWPORTS.find((v) => v.width === viewport)?.label.replace(" · ", " ")}</span>
              </span>
            </div>
            {error && <p className="mt-3 text-[13px] text-red-ink">{error}</p>}
          </form>
        </section>

        {recent.length > 0 && (
          <section className="mt-20">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Recent reviews on this device</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {recent.map((r) => (
                <li key={r.id} className="group flex items-center gap-3 rounded-lg bg-panel px-3 py-2.5 hairline transition-colors hover:bg-hover">
                  <a href={`/r/${r.id}`} className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-ink">{r.title || hostOf(r.url)}</div>
                    <div className="truncate text-[12px] text-ink-3">
                      {r.url.startsWith("upload://") ? "Uploaded file" : hostOf(r.url)} · {timeAgo(r.at)}
                    </div>
                  </a>
                  <button
                    type="button"
                    onClick={() => forget(r.id)}
                    className="rounded p-1 text-ink-3 opacity-0 transition-opacity hover:text-red group-hover:opacity-100"
                    title="Remove from this list"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="mt-auto pt-20 text-[12px] text-ink-3">
          Works best on pages that don&apos;t require sign-in. Comments are anchored to the elements you click, so they follow the layout.
        </footer>
      </div>
    </main>
  );
}
