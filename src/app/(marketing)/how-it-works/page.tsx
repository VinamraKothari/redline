import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CodeXml } from "lucide-react";
import { StepArt, type StepKind } from "@/components/marketing/StepArt";
import { Container, PageHead, SectionHead } from "@/components/marketing/Shell";
import { SHORTCUT_GROUPS } from "@/content/shortcuts";
import { DEV_CATEGORIES, DEV_SEVERITIES } from "@/lib/figma/categories";

const description = "Paste a URL, review the live page with comments, drawings and measurements, freeze a version, compare it with Figma and export to Jira.";

export const metadata: Metadata = {
  title: "How it works — Redline",
  description,
  alternates: { canonical: "/how-it-works" },
  openGraph: { title: "How Redline works", description, type: "website", url: "/how-it-works", siteName: "Redline" },
};

const STEPS: { kind: StepKind; title: string; text: string; detail?: string }[] = [
  {
    kind: "url",
    title: "Paste a URL",
    text: "Any public page: production, staging, a Vercel or Netlify preview. Pick the viewport you want to look at first — you can switch later with 1, 2 and 3.",
  },
  {
    kind: "load",
    title: "The page loads inside Redline",
    text: "Redline fetches the page through its own proxy and serves it from its origin, so sites that refuse to be embedded still open, their fonts still load and their scripts still run.",
    detail: "Because the page is now same-origin, Redline can read the real DOM: what you hover, what an element's computed styles are, how far apart two boxes sit.",
  },
  {
    kind: "review",
    title: "Pin comments, draw, inspect",
    text: "Click an element to start a thread that stays anchored to it, or drag over an area. Draw with pen, arrows and shapes. Inspect type, colour and spacing; hold Alt to measure between elements.",
    detail: "Menus and drawers that only open on hover? Press H to lock the hover state and comment on it.",
  },
  {
    kind: "freeze",
    title: "Freeze a version",
    text: "Shift+F stores the rendered page — scripts run, stylesheets inlined — as a snapshot, so everyone reviews the same thing even after the site changes. Shift+P saves the current state (an open dialog, a menu) as a new page.",
  },
  {
    kind: "figma",
    title: "Compare with Figma",
    text: "Paste the link to the frame of this page in Figma. Redline lines the design up with the build and writes one developer comment per difference, pinned to the element it concerns.",
    detail: "Developer comments are violet, carry a category and a severity, and sit in the same panel as everyone else's.",
  },
  {
    kind: "jira",
    title: "Export to Jira",
    text: "One issue per thread: title, body, replies and a screenshot of the pinned element, as a CSV Jira imports directly. Or export the marked-up page as a PNG.",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <section className="border-b border-line">
        <Container className="py-14 lg:py-20">
          <PageHead
            eyebrow="How it works"
            title="From a URL to a list of things to fix."
            lead="Six steps, no plugin on the site, nothing to install. Everything happens on the real page, at the real viewport."
          />
        </Container>
      </section>

      {/* the walk-through */}
      <section>
        <Container className="py-16 lg:py-20">
          <ol className="grid gap-x-8 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.kind} className="flex flex-col">
                <StepArt kind={s.kind} />
                <div className="mt-5 flex items-baseline gap-3">
                  <span className="mono text-[12px] text-red">{String(i + 1).padStart(2, "0")}</span>
                  <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{s.title}</h2>
                </div>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{s.text}</p>
                {s.detail && <p className="mt-2 text-[13px] leading-relaxed text-ink-3">{s.detail}</p>}
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* what the comparison checks */}
      <section id="figma" className="scroll-mt-16 border-t border-line bg-panel/60">
        <Container className="py-16 lg:py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
            <div>
              <SectionHead
                eyebrow="Compare with Figma"
                title="What Redline checks against the design."
                lead="Each finding becomes one developer comment with one cause. Choose in your account settings which categories and severities to report."
              />
              <div className="mt-8 space-y-3">
                {DEV_SEVERITIES.map((s) => (
                  <div key={s.id} className="flex gap-3 text-[13.5px]">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-violet" style={{ opacity: s.id === "high" ? 1 : s.id === "medium" ? 0.6 : 0.3 }} />
                    <div>
                      <span className="font-medium text-ink">{s.label}</span> <span className="text-ink-2">— {s.description}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {DEV_CATEGORIES.map((c) => (
                <li key={c.id} className="rounded-xl bg-panel p-4 hairline">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-[6px_6px_6px_1px] bg-violet text-white">
                      <CodeXml size={12} strokeWidth={2.5} />
                    </span>
                    <h3 className="text-[14px] font-semibold text-ink">{c.label}</h3>
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{c.description}</p>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      {/* shortcuts */}
      <section className="border-t border-line">
        <Container className="py-16 lg:py-20">
          <SectionHead
            eyebrow="Keyboard"
            title="Every action has a key."
            lead="Press ? inside a review to see this list. ⌘ stands for Ctrl on Windows and Linux."
          />
          <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {SHORTCUT_GROUPS.map((g) => (
              <div key={g.title}>
                <h3 className="mk-eyebrow">{g.title}</h3>
                <table className="mt-3 w-full border-collapse text-[13px]">
                  <tbody>
                    {g.items.map((s) => (
                      <tr key={s.does} className="border-t border-line">
                        <td className="w-[104px] py-2 pr-3 align-top">
                          <span className="inline-flex flex-wrap gap-1">
                            {s.keys.map((k) => (
                              <kbd key={k} className="mk-kbd">
                                {k}
                              </kbd>
                            ))}
                          </span>
                        </td>
                        <td className="py-2 text-ink-2">{s.does}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-t border-line bg-panel/60">
        <Container className="py-16 text-center lg:py-20">
          <h2 className="mk-balance text-[24px] font-semibold tracking-[-0.02em] text-ink sm:text-[28px]">Try it on a page you know.</h2>
          <p className="mx-auto mt-2 max-w-[460px] text-[14px] text-ink-2">The Free plan has every tool and needs no card. Paste a URL on the home page and the review opens right after you sign in.</p>
          <Link href="/" className="press mt-6 inline-flex h-11 items-center gap-2 rounded-lg bg-ink px-5 text-[14px] font-medium text-white hover:bg-black">
            Start a review <ArrowRight size={15} />
          </Link>
        </Container>
      </section>
    </>
  );
}
