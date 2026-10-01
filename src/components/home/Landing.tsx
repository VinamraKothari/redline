"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  Check,
  CodeXml,
  Component,
  FileSpreadsheet,
  Globe,
  Link as LinkIcon,
  MessageCircle,
  Monitor,
  Palette,
  Pencil,
  Ruler,
  Smartphone,
  Snowflake,
  Tablet,
  Users,
} from "lucide-react";
import { signInWithGoogle } from "@/lib/auth/client";
import { PLANS, formatPrice } from "@/lib/billing/plans";
import { VIEWPORTS } from "@/lib/types";
import { cn, normalizeUrl } from "@/lib/util";
import { Faq } from "@/components/marketing/Faq";
import { Footer } from "@/components/marketing/Footer";
import { GoogleMark } from "@/components/marketing/GoogleMark";
import { Nav } from "@/components/marketing/Nav";
import { ReviewMock } from "@/components/marketing/ReviewMock";
import { Container, SectionHead } from "@/components/marketing/Shell";
import { LANDING_FAQ } from "@/content/faq";

const FEATURES = [
  {
    Icon: MessageCircle,
    title: "Comment like Figma",
    text: "Pin a thread to any element or drag over an area. Replies, mentions, reactions, screen recordings, resolve — and pins follow the layout across viewports.",
  },
  {
    Icon: Pencil,
    title: "Draw & annotate",
    text: "Pen, highlighter, arrows, shapes and text straight on the page. Everyone in the review sees strokes appear live.",
  },
  {
    Icon: Ruler,
    title: "Inspect type, colour & spacing",
    text: "Click anything for its font, size, line height, colours, padding and margins. Hold Alt to measure between elements, exactly like Figma.",
  },
  {
    Icon: Users,
    title: "Projects & roles",
    text: "Invite teammates by e-mail as viewers, editors or admins. Live cursors show who's looking where; unread badges show what's new.",
  },
  {
    Icon: Snowflake,
    title: "Freeze a version",
    text: "Snapshot the exact page you reviewed — open menus and drawers included — so feedback stays attached after the site changes.",
  },
  {
    Icon: FileSpreadsheet,
    title: "Export to Jira",
    text: "One issue per thread, with titles, replies and a screenshot of the pinned element, in the CSV format Jira imports directly.",
  },
];

const AUDIENCES = [
  {
    Icon: Palette,
    title: "Designers",
    text: "Review the built page the way you review a frame: pin, draw, measure. See at once where the build drifted from the design, without a screenshot round-trip.",
  },
  {
    Icon: CodeXml,
    title: "Developers",
    text: "Get feedback pinned to the element it's about, with the computed styles next to it. Export the thread list to Jira and work through it in order.",
  },
  {
    Icon: Briefcase,
    title: "Agencies & product teams",
    text: "One project per client or launch, everyone signed in with Google, roles for who may edit. Frozen versions keep a record of what was signed off.",
  },
];

const DEV_FINDINGS = [
  { cat: "Copy", sev: "high", text: "Reads “Ship faster”, the design says “Ship better”." },
  { cat: "Typography", sev: "medium", text: "Font size is 28px, the design has 32px." },
  { cat: "Spacing", sev: "low", text: "Gap between the cards is 16px, the design has 24px." },
];

const WORKS_WITH = [
  { Icon: Component, label: "Figma frames" },
  { Icon: FileSpreadsheet, label: "Jira (CSV import)" },
  { Icon: LinkIcon, label: "Vercel & Netlify previews" },
  { Icon: Globe, label: "Any URL — staging or production" },
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
    <div className="flex min-h-full flex-col">
      <Nav onSignIn={() => void google()} busy={busy} />

      <main className="flex-1">
        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 canvas-grid opacity-50 [mask-image:linear-gradient(to_bottom,black_40%,transparent)]" />
          <Container className="relative grid items-center gap-12 py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:gap-14 lg:py-24">
            <div className="max-w-[560px]">
              <div className="mk-eyebrow">Design review for the web</div>
              <h1 className="mk-balance mt-3 text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] text-ink lg:text-[52px]">
                Design feedback on{" "}
                <br className="hidden sm:block" />
                any{" "}
                <span className="relative inline-block">
                  live website<span className="absolute -bottom-1 left-0 h-[3px] w-full rounded bg-red" />
                </span>
                .
              </h1>
              <p className="mt-5 max-w-[480px] text-[16px] leading-relaxed text-ink-2">
                Load a page, pin comments like Figma, draw on it, inspect type, colour and spacing — then share the marked-up canvas with
                your team.
              </p>

              <form onSubmit={review} className="mt-8">
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-xl bg-panel p-1.5 shadow-pop transition-shadow",
                    "focus-within:shadow-[0_0_0_2px_var(--blue),var(--shadow-pop)]",
                  )}
                >
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="Paste a URL, e.g. vercel.com"
                    spellCheck={false}
                    aria-label="Web address to review"
                    className="h-11 min-w-0 flex-1 bg-transparent px-3 text-[15px] text-ink placeholder:text-ink-3 outline-none"
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
                        aria-label={t}
                        aria-pressed={viewport === w}
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
                    className="press flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-ink px-4 text-[13px] font-medium text-white transition-colors hover:bg-black disabled:opacity-60"
                  >
                    {busy ? "Opening…" : "Review"}
                    {!busy && <ArrowRight size={14} />}
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-3">
                  <span className="inline-flex items-center gap-1.5">
                    <GoogleMark size={12} /> Sign in with Google to start — your review opens right after.
                  </span>
                  <span className="hidden sm:inline">
                    Viewport: <span className="mono text-ink-2">{VIEWPORTS.find((v) => v.width === viewport)?.label.replace(" · ", " ")}</span>
                  </span>
                </div>
                {err && <p className="mt-3 text-[13px] text-red-ink">{err}</p>}
              </form>

              {testMode && (
                <section className="mt-5 max-w-[480px] rounded-lg bg-paper p-3 hairline">
                  <div className="mk-eyebrow">Test mode</div>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={testName}
                      onChange={(e) => setTestName(e.target.value)}
                      aria-label="Test user name"
                      className="h-9 min-w-0 flex-1 rounded-md bg-panel px-2.5 text-[13px] text-ink hairline outline-none"
                    />
                    <button type="button" onClick={testSignIn} className="h-9 shrink-0 rounded-md bg-ink px-3 text-[12.5px] font-medium text-white">
                      Sign in as test user
                    </button>
                  </div>
                </section>
              )}

              <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-ink-2">
                {["Nothing to install on the site", "Free for one project", "Works on staging and previews"].map((t) => (
                  <li key={t} className="inline-flex items-center gap-1.5">
                    <Check size={13} className="text-red" /> {t}
                  </li>
                ))}
              </ul>
            </div>

            <ReviewMock className="w-full lg:-mr-4" />
          </Container>
        </section>

        {/* ── Works with ────────────────────────────────────────────────── */}
        <section className="border-y border-line bg-panel/60">
          <Container className="flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:gap-8">
            <span className="mk-eyebrow shrink-0">Works with</span>
            <ul className="flex flex-wrap gap-x-7 gap-y-2">
              {WORKS_WITH.map(({ Icon, label }) => (
                <li key={label} className="inline-flex items-center gap-2 text-[13.5px] font-medium text-ink-2">
                  <Icon size={15} className="text-ink-3" /> {label}
                </li>
              ))}
            </ul>
          </Container>
        </section>

        {/* ── Product ───────────────────────────────────────────────────── */}
        <section id="product" className="scroll-mt-16 py-20 lg:py-24">
          <Container>
            <SectionHead
              eyebrow="Product"
              title="Everything a review needs, on the real page."
              lead="No screenshots, no plugin on the site. Redline loads the page itself, so comments, drawings and measurements sit on the actual layout — at every viewport."
            />

            <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {/* Compare with Figma: the one feature no screenshot tool has */}
              <div className="grid overflow-hidden rounded-xl bg-panel hairline sm:col-span-2 lg:col-span-3 lg:grid-cols-[1fr_1.15fr]">
                <div className="p-6 lg:p-8">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-soft text-violet">
                    <CodeXml size={18} />
                  </span>
                  <h3 className="mt-4 text-[20px] font-semibold tracking-[-0.01em] text-ink">Compare with Figma</h3>
                  <p className="mt-2 max-w-[420px] text-[14px] leading-relaxed text-ink-2">
                    Paste the link to the Figma frame of the page. Redline compares the build with the design and writes a{" "}
                    <span className="font-medium text-violet">developer comment</span> for every difference — copy, typography, spacing,
                    position, images, buttons, section sizes — pinned to the element it concerns, in plain language.
                  </p>
                  <Link href="/how-it-works#figma" className="mt-4 inline-flex items-center gap-1 text-[13.5px] font-medium text-ink hover:text-violet">
                    What it checks <ArrowRight size={14} />
                  </Link>
                </div>
                <div className="mk-canvas relative flex items-end p-5 pt-8 lg:p-8">
                  <div className="w-full rounded-lg bg-panel shadow-pop hairline">
                    <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
                      <span className="text-[12px] font-semibold text-ink">Developer comments</span>
                      <span className="mono text-[11px] text-ink-3">12 findings</span>
                    </div>
                    <ul className="divide-y divide-line">
                      {DEV_FINDINGS.map((f) => (
                        <li key={f.text} className="flex gap-3 px-3.5 py-2.5">
                          <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[9px_9px_9px_2px] bg-violet text-white">
                            <CodeXml size={10} strokeWidth={2.5} />
                          </span>
                          <div className="min-w-0">
                            <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-violet">
                              {f.cat} · {f.sev}
                            </div>
                            <p className="mt-0.5 text-[12.5px] leading-snug text-ink">{f.text}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {FEATURES.map(({ Icon, title, text }) => (
                <div key={title} className="rounded-xl bg-panel p-5 hairline">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red/10 text-red">
                    <Icon size={17} />
                  </span>
                  <h3 className="mt-4 text-[15px] font-semibold text-ink">{title}</h3>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{text}</p>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* ── Who it's for ──────────────────────────────────────────────── */}
        <section className="border-t border-line bg-panel/60 py-20 lg:py-24">
          <Container>
            <SectionHead eyebrow="Who it's for" title="Built for the people between a design and a deploy." />
            <div className="mt-10 grid gap-8 md:grid-cols-3">
              {AUDIENCES.map(({ Icon, title, text }) => (
                <div key={title} className="border-t-2 border-ink pt-5">
                  <Icon size={18} className="text-ink-2" />
                  <h3 className="mt-3 text-[16px] font-semibold text-ink">{title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{text}</p>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* ── Pricing teaser ────────────────────────────────────────────── */}
        <section className="border-t border-line py-20 lg:py-24">
          <Container>
            <SectionHead
              eyebrow="Pricing"
              title="Free to start. Pay when the team grows."
              lead="Every plan has all the tools. Plans differ in how many projects, pages, people and Figma comparisons you need."
              align="center"
            />
            <div className="mt-10 grid gap-3 md:grid-cols-3">
              {PLANS.map((p) => {
                const featured = p.id === "pro";
                return (
                  <Link
                    key={p.id}
                    href="/pricing"
                    aria-label={`${p.name} plan — see all plans`}
                    className={cn("mk-lift flex flex-col rounded-xl p-5", featured ? "bg-ink text-white" : "bg-panel hairline")}
                  >
                    <div className="flex items-baseline justify-between">
                      <h3 className="text-[15px] font-semibold">{p.name}</h3>
                      {featured && <span className="mk-eyebrow !text-white/60">Most popular</span>}
                    </div>
                    <div className="mt-3 flex items-baseline gap-1">
                      <span className="text-[32px] font-semibold leading-none tracking-[-0.02em]">{formatPrice(p.monthly)}</span>
                      <span className={cn("text-[13px]", featured ? "text-white/60" : "text-ink-3")}>/ month</span>
                    </div>
                    <p className={cn("mt-2 text-[13px] md:min-h-[38px]", featured ? "text-white/70" : "text-ink-2")}>{p.tagline}</p>
                    <ul className={cn("mt-4 space-y-1.5 text-[13px]", featured ? "text-white/85" : "text-ink-2")}>
                      {p.features.slice(0, 3).map((f) => (
                        <li key={f} className="flex items-start gap-2">
                          <Check size={13} className={cn("mt-0.5 shrink-0", featured ? "text-white/60" : "text-red")} /> {f}
                        </li>
                      ))}
                    </ul>
                  </Link>
                );
              })}
            </div>
            <div className="mt-6 text-center">
              <Link href="/pricing" className="inline-flex items-center gap-1 text-[14px] font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-red">
                Compare all plans <ArrowRight size={14} />
              </Link>
            </div>
          </Container>
        </section>

        {/* ── FAQ ───────────────────────────────────────────────────────── */}
        <section className="border-t border-line bg-panel/60 py-20 lg:py-24">
          <Container className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
            <SectionHead eyebrow="Questions" title="Good to know before the first review." />
            <Faq items={LANDING_FAQ} />
          </Container>
        </section>

        {/* ── Final call to action ──────────────────────────────────────── */}
        <section className="py-20 lg:py-24">
          <Container>
            <div className="flex flex-col items-start gap-6 rounded-2xl bg-ink px-6 py-8 text-white sm:px-10 sm:py-10 lg:flex-row lg:items-center">
              <div className="flex-1">
                <h2 className="mk-balance text-[24px] font-semibold leading-tight tracking-[-0.02em] sm:text-[28px]">Start your first review in a minute.</h2>
                <p className="mt-2 max-w-[520px] text-[14px] leading-relaxed text-white/70">
                  Sign in with the Google account you were invited with, or start your own project. We only use your name, e-mail and
                  picture to show who said what.
                </p>
              </div>
              <button
                type="button"
                onClick={() => google()}
                disabled={busy}
                className="press flex h-11 shrink-0 items-center gap-3 rounded-lg bg-white px-5 text-[14px] font-medium text-ink transition-colors hover:bg-paper disabled:opacity-60"
              >
                <GoogleMark size={18} /> {busy ? "Redirecting…" : "Continue with Google"}
              </button>
            </div>
          </Container>
        </section>
      </main>

      <Footer />
    </div>
  );
}
