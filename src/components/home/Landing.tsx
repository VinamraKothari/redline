"use client";

import { useState } from "react";
import { ArrowRight, MessageCircle, Monitor, Pencil, Ruler, Smartphone, Tablet, Users, FileSpreadsheet, Snowflake } from "lucide-react";
import { Logo } from "@/components/Logo";
import { signInWithGoogle } from "@/lib/auth/client";
import { VIEWPORTS } from "@/lib/types";
import { cn, normalizeUrl } from "@/lib/util";

function GoogleMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z" />
      <path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.7 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

const FEATURES = [
  { Icon: MessageCircle, title: "Comment like Figma", text: "Pin threads to any element or drag over an area. Replies, mentions, reactions, resolve — pins follow the layout across viewports." },
  { Icon: Pencil, title: "Draw & annotate", text: "Pen, highlighter, arrows, shapes and text straight on the page. Everyone sees strokes appear live." },
  { Icon: Ruler, title: "Inspect type, colour & spacing", text: "Click anything for its font, size, line height, colours, padding and margins. Hold Alt to measure between elements, exactly like Figma." },
  { Icon: Users, title: "Projects & roles", text: "Invite teammates by e-mail as viewers, editors or admins. Live cursors show who's looking where." },
  { Icon: Snowflake, title: "Freeze a version", text: "Snapshot the exact page you reviewed so feedback stays attached even after the site changes." },
  { Icon: FileSpreadsheet, title: "Export to Jira", text: "One issue per thread, with titles, replies and screenshots, in the CSV format Jira imports directly." },
];

/**
 * Landing page for signed-out visitors (also the sign-in page). The URL box
 * works as a call to action: sign in with Google, then continue straight to
 * starting that review.
 */
export function Landing({ next, error, testMode }: { next: string; error: string | null; testMode: boolean }) {
  const [url, setUrl] = useState("");
  const [viewport, setViewport] = useState(1440);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(error);
  const [testName, setTestName] = useState("Priya Test");

  const startTarget = () => {
    const n = normalizeUrl(url);
    return n ? `/start?url=${encodeURIComponent(n)}&viewport=${viewport}` : next;
  };

  async function google(target = next) {
    setBusy(true);
    setErr(null);
    try {
      await signInWithGoogle(target);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  function review(e: React.FormEvent) {
    e.preventDefault();
    if (url.trim() && !normalizeUrl(url)) {
      setErr("Enter a web address, like stripe.com or https://example.com/pricing");
      return;
    }
    void google(startTarget());
  }

  async function testSignIn() {
    const slug = testName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "tester";
    await fetch("/api/auth/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: `00000000-0000-4000-8000-${slug.replace(/[^0-9a-f]/g, "0").padEnd(12, "0").slice(0, 12)}`,
        email: `${slug}@example.test`,
        name: testName.trim() || "Tester",
      }),
    });
    window.location.href = startTarget();
  }

  return (
    <main className="relative h-full overflow-y-auto overflow-x-hidden">
      {/* backdrop: faint blueprint grid + one red stroke */}
      <div className="pointer-events-none absolute inset-0 canvas-grid opacity-60" />
      <svg className="pointer-events-none absolute -right-24 top-24 h-[520px] w-[720px] opacity-90" viewBox="0 0 720 520" fill="none" aria-hidden>
        <path d="M20 400 C 180 380, 260 120, 420 140 S 640 300, 700 60" stroke="var(--red)" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="420" cy="140" r="14" fill="var(--red)" />
        <text x="415" y="145" fill="#fff" fontSize="12" fontWeight="700" fontFamily="var(--font-ui)">1</text>
        <rect x="470" y="220" width="180" height="92" rx="6" stroke="var(--blue)" strokeWidth="1.5" strokeDasharray="4 4" />
        <text x="478" y="212" fill="var(--blue)" fontSize="11" fontFamily="var(--font-mono)">180 × 92</text>
      </svg>

      <div className="relative mx-auto flex min-h-full max-w-[880px] flex-col px-6 pb-12 pt-8">
        <header className="flex items-center justify-between">
          <Logo />
          <button
            type="button"
            onClick={() => google()}
            disabled={busy}
            className="flex h-9 items-center gap-2 rounded-lg bg-panel px-3 text-[13px] font-medium text-ink hairline transition-colors hover:bg-hover disabled:opacity-60"
          >
            <GoogleMark size={14} /> {busy ? "Redirecting…" : "Sign in"}
          </button>
        </header>

        <section className="mt-24 max-w-[620px]">
          <h1 className="text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] text-ink">
            Design feedback on
            <br />
            any{" "}
            <span className="relative inline-block">
              live website<span className="absolute -bottom-1 left-0 h-[3px] w-full rounded bg-red" />
            </span>
            .
          </h1>
          <p className="mt-4 max-w-[480px] text-[15px] leading-relaxed text-ink-2">
            Load a page, pin comments like Figma, draw on it, inspect type, colour and spacing — then share the marked-up canvas with your
            team.
          </p>

          <form onSubmit={review} className="mt-9">
            <div
              className={cn(
                "flex items-center gap-2 rounded-xl bg-panel p-1.5 shadow-pop transition-shadow",
                "focus-within:shadow-[0_0_0_2px_var(--blue),var(--shadow-pop)]",
              )}
            >
              <input
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste a URL — e.g. linear.app or vercel.com/pricing"
                spellCheck={false}
                aria-label="Web address to review"
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
              <span className="inline-flex items-center gap-1.5">
                <GoogleMark size={12} /> Sign in with Google to start — your review opens right after.
              </span>
              <span className="hidden sm:inline">
                Viewport: <span className="mono text-ink-2">{VIEWPORTS.find((v) => v.width === viewport)?.label.replace(" · ", " ")}</span>
              </span>
            </div>
            {err && <p className="mt-3 text-[13px] text-red-ink">{err}</p>}
          </form>
        </section>

        <section className="mt-20 grid gap-3 sm:grid-cols-3">
          {FEATURES.map(({ Icon, title, text }) => (
            <div key={title} className="rounded-xl bg-panel/80 p-4 hairline backdrop-blur-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red/10 text-red">
                <Icon size={16} />
              </span>
              <h2 className="mt-3 text-[13.5px] font-semibold text-ink">{title}</h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{text}</p>
            </div>
          ))}
        </section>

        <section className="mt-16 flex flex-col items-start gap-4 rounded-2xl bg-ink px-6 py-6 text-white sm:flex-row sm:items-center">
          <div className="flex-1">
            <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Reviews live in projects shared with your team.</h2>
            <p className="mt-1 text-[13px] text-white/70">
              Sign in with the Google account you were invited with — or start your own project. We only use your name, e-mail and picture
              to show who said what.
            </p>
          </div>
          <button
            type="button"
            onClick={() => google()}
            disabled={busy}
            className="flex h-11 shrink-0 items-center gap-3 rounded-lg bg-white px-4 text-[14px] font-medium text-ink transition-colors hover:bg-paper disabled:opacity-60"
          >
            <GoogleMark size={18} /> {busy ? "Redirecting…" : "Continue with Google"}
          </button>
        </section>

        {testMode && (
          <section className="mt-6 rounded-lg bg-paper p-3 hairline">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Test mode</div>
            <div className="mt-2 flex gap-2">
              <input
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
                aria-label="Test user name"
                className="h-9 min-w-0 flex-1 rounded-md bg-panel px-2.5 text-[13px] text-ink hairline outline-none"
              />
              <button type="button" onClick={testSignIn} className="h-9 rounded-md bg-ink px-3 text-[12.5px] font-medium text-white">
                Sign in as test user
              </button>
            </div>
          </section>
        )}

        <footer className="mt-auto pt-16 text-[12px] text-ink-3">
          Works best on pages that don&apos;t require sign-in. Comments are anchored to the elements you click, so they follow the layout.
        </footer>
      </div>
    </main>
  );
}
