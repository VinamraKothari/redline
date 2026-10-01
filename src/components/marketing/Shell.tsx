import { Footer } from "./Footer";
import { Nav } from "./Nav";

/** Nav above, footer below; the page scrolls as a normal document. */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <Nav />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}

/** Centred column used by every marketing section. */
export function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1120px] px-5 sm:px-8 ${className}`}>{children}</div>;
}

/** A section heading: small eyebrow, a title, one line of context. */
export function SectionHead({
  eyebrow,
  title,
  lead,
  align = "left",
  id,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  align?: "left" | "center";
  id?: string;
}) {
  const centred = align === "center";
  return (
    <div id={id} className={centred ? "mx-auto max-w-[620px] text-center" : "max-w-[620px]"}>
      {eyebrow && <div className="mk-eyebrow">{eyebrow}</div>}
      <h2 className="mk-balance mt-2 text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink sm:text-[32px]">{title}</h2>
      {lead && <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{lead}</p>}
    </div>
  );
}

/** Title block at the top of a marketing page (the h1). */
export function PageHead({ eyebrow, title, lead }: { eyebrow?: string; title: React.ReactNode; lead?: React.ReactNode }) {
  return (
    <div className="max-w-[680px]">
      {eyebrow && <div className="mk-eyebrow">{eyebrow}</div>}
      <h1 className="mk-balance mt-2 text-[34px] font-semibold leading-[1.05] tracking-[-0.02em] text-ink sm:text-[40px]">{title}</h1>
      {lead && <p className="mt-4 max-w-[560px] text-[16px] leading-relaxed text-ink-2">{lead}</p>}
    </div>
  );
}
