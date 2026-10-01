import type { Metadata } from "next";
import { Container, PageHead } from "@/components/marketing/Shell";
import { CHANGELOG, type ChangelogEntry } from "@/content/changelog";
import { cn } from "@/lib/util";

const description = "What changed in Redline, release by release.";

export const metadata: Metadata = {
  title: "Changelog — Redline",
  description,
  alternates: { canonical: "/changelog" },
  openGraph: { title: "Redline changelog", description, type: "website", url: "/changelog", siteName: "Redline" },
};

const TAG: Record<NonNullable<ChangelogEntry["tag"]>, { label: string; className: string }> = {
  new: { label: "New", className: "bg-red-soft text-red-ink" },
  improved: { label: "Improved", className: "bg-blue-soft text-blue" },
  fixed: { label: "Fixed", className: "bg-hover text-ink-2" },
};

const monthOf = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const dayOf = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Entries grouped by month, newest first (the data file is already sorted). */
function byMonth(entries: ChangelogEntry[]): { month: string; entries: ChangelogEntry[] }[] {
  const groups: { month: string; entries: ChangelogEntry[] }[] = [];
  for (const e of entries) {
    const month = monthOf(e.date);
    const last = groups[groups.length - 1];
    if (last?.month === month) last.entries.push(e);
    else groups.push({ month, entries: [e] });
  }
  return groups;
}

export default function ChangelogPage() {
  return (
    <>
      <section className="border-b border-line">
        <Container className="py-14 lg:py-20">
          <PageHead eyebrow="Changelog" title="What's new in Redline." lead="Every release, in the order it shipped. Bigger changes get a line or two of context." />
        </Container>
      </section>

      <section>
        <Container className="py-12 lg:py-16">
          {byMonth(CHANGELOG).map((g) => (
            <section key={g.month} className="grid gap-4 border-t border-line py-10 first:border-0 first:pt-0 md:grid-cols-[200px_1fr] md:gap-10">
              <h2 className="text-[15px] font-semibold text-ink md:sticky md:top-20 md:self-start">{g.month}</h2>
              <ol className="space-y-10">
                {g.entries.map((e) => (
                  <li key={e.date + e.title} className="max-w-[680px]">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <time dateTime={e.date} className="mono text-[12px] text-ink-3">
                        {dayOf(e.date)}
                      </time>
                      {e.tag && <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-medium", TAG[e.tag].className)}>{TAG[e.tag].label}</span>}
                    </div>
                    <h3 className="mt-1.5 text-[20px] font-semibold leading-tight tracking-[-0.01em] text-ink">{e.title}</h3>
                    <ul className="mt-3 space-y-2.5">
                      {e.items.map((it) => (
                        <li key={it} className="flex gap-3 text-[14.5px] leading-relaxed text-ink-2">
                          <span className="mt-[11px] h-px w-3 shrink-0 bg-red" />
                          <span>{it}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </Container>
      </section>
    </>
  );
}
