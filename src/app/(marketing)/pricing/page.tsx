import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Faq } from "@/components/marketing/Faq";
import { Pricing } from "@/components/marketing/Pricing";
import { Container, PageHead, SectionHead } from "@/components/marketing/Shell";
import { PRICING_FAQ } from "@/content/faq";

const description = "Free for one project. Pro and Team add unlimited pages, more people, unlimited Figma comparisons, recordings and frozen versions.";

export const metadata: Metadata = {
  title: "Pricing — Redline",
  description,
  alternates: { canonical: "/pricing" },
  openGraph: { title: "Redline pricing", description, type: "website", url: "/pricing", siteName: "Redline" },
};

export default function PricingPage() {
  return (
    <>
      <section className="border-b border-line">
        <Container className="py-14 lg:py-20">
          <PageHead
            eyebrow="Pricing"
            title="Free to start. Pay when the team grows."
            lead="Every plan has all the tools — comments, drawing, inspect, Figma comparison, exports. Plans differ in how many projects, pages, people and comparisons you need. Prices in euro, VAT added at checkout where it applies."
          />
        </Container>
      </section>

      <section>
        <Container className="py-12 lg:py-16">
          <Pricing />
        </Container>
      </section>

      <section className="border-t border-line bg-panel/60">
        <Container className="grid gap-10 py-16 lg:grid-cols-[1fr_1.6fr] lg:py-20">
          <SectionHead eyebrow="Questions" title="Billing, in plain words." lead="Everything about VAT, cancelling, limits and invoices. Something missing? Write to us — the address is in the imprint." />
          <Faq items={PRICING_FAQ} />
        </Container>
      </section>

      <section className="border-t border-line">
        <Container className="py-16 text-center lg:py-20">
          <h2 className="mk-balance text-[24px] font-semibold tracking-[-0.02em] text-ink sm:text-[28px]">Not sure which plan? Start free.</h2>
          <p className="mx-auto mt-2 max-w-[460px] text-[14px] text-ink-2">
            One project, three pages and two Figma comparisons a month, with every tool. Upgrade from the billing page whenever you need more.
          </p>
          <Link href="/login" className="press mt-6 inline-flex h-11 items-center gap-2 rounded-lg bg-ink px-5 text-[14px] font-medium text-white hover:bg-black">
            Start free <ArrowRight size={15} />
          </Link>
        </Container>
      </section>
    </>
  );
}
