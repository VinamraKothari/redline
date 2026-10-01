import Link from "next/link";
import { Logo } from "@/components/Logo";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/how-it-works", label: "Features" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/pricing", label: "Pricing" },
      { href: "/changelog", label: "Changelog" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/login", label: "Sign in" },
      { href: "/", label: "Your projects" },
      { href: "/account/billing", label: "Billing" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
      { href: "/imprint", label: "Imprint" },
    ],
  },
];

/** Site footer shared by the landing page and every marketing page. */
export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-[1120px] px-5 py-12 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-3 max-w-[260px] text-[13px] leading-relaxed text-ink-2">
              Design feedback on any live website — comments, drawing, inspection and a Figma comparison, on the real page.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <div className="mk-eyebrow">{col.title}</div>
              <ul className="mt-3 space-y-2">
                {col.links.map((l) => (
                  <li key={l.href + l.label}>
                    <Link href={l.href} className="text-[13.5px] text-ink-2 transition-colors hover:text-ink">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-line pt-6 text-[12.5px] text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Redline</span>
          <span className="inline-flex items-center gap-2">
            {/* the redline, small: a stroke and a pin */}
            <svg width="28" height="12" viewBox="0 0 28 12" fill="none" aria-hidden>
              <path d="M1 10 C 7 9, 9 2, 14 3 S 21 9, 27 2" stroke="var(--red)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Made in Germany
          </span>
        </div>
      </div>
    </footer>
  );
}
