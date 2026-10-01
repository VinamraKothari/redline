import Link from "next/link";
import { Container, PageHead } from "./Shell";

const LEGAL = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/imprint", label: "Imprint" },
];

/** Long-form legal text: a title block, a "last updated" line and prose. */
export function LegalPage({
  eyebrow,
  title,
  lead,
  updated,
  current,
  children,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  /** ISO date of the last change */
  updated: string;
  current: string;
  children: React.ReactNode;
}) {
  const date = new Date(updated + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <>
      <section className="border-b border-line">
        <Container className="py-14 lg:py-20">
          <PageHead eyebrow={eyebrow} title={title} lead={lead} />
          <p className="mono mt-5 text-[12px] text-ink-3">Last updated {date}</p>
        </Container>
      </section>
      <section>
        <Container className="grid gap-10 py-12 lg:grid-cols-[200px_1fr] lg:py-16">
          <nav aria-label="Legal pages" className="flex gap-4 lg:sticky lg:top-20 lg:flex-col lg:gap-2 lg:self-start">
            {LEGAL.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={l.href === current ? "page" : undefined}
                className={l.href === current ? "text-[13.5px] font-medium text-ink" : "text-[13.5px] text-ink-2 hover:text-ink"}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="mk-prose max-w-[680px]">{children}</div>
        </Container>
      </section>
    </>
  );
}

/** A fact still to be filled in or confirmed before the page goes live — visibly marked so it can't be missed. */
export function Placeholder({ children }: { children: React.ReactNode }) {
  return <span className="mk-placeholder">{children}</span>;
}
