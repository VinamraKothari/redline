import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/Legal";
import { LEGAL_UPDATED } from "@/content/site";

const description = "The terms under which Redline is provided: accounts, acceptable use, plans, billing, cancellation, availability and liability.";

export const metadata: Metadata = {
  title: "Terms of service — Redline",
  description,
  alternates: { canonical: "/terms" },
  openGraph: { title: "Redline terms of service", description, type: "website", url: "/terms", siteName: "Redline" },
};

/* Draft. To be checked by a lawyer before the service goes paid. */
export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms of service"
      lead="These terms apply to everyone who uses Redline, on the Free plan or a paid one. They are short on purpose; if something is unclear, ask."
      updated={LEGAL_UPDATED}
      current="/terms"
    >
      <h2>1. What Redline is</h2>
      <p>
        Redline is a web service for reviewing live websites: it loads a page through its own proxy, lets members of a project pin comments to it, draw on it,
        inspect its typography, colours and spacing, freeze versions, compare the page with a Figma frame and export the results. It is provided by Vinamra
        Kothari (&ldquo;we&rdquo;), whose details are on the <a href="/imprint">imprint</a>.
      </p>

      <h2>2. Accounts</h2>
      <p>
        You need a Google account to sign in. You are responsible for what happens under your account and for keeping your Google credentials safe. One person,
        one account; a Team plan covers the members of your projects, who sign in with their own accounts.
      </p>

      <h2>3. Acceptable use</h2>
      <p>You may review pages you are allowed to look at. You may not use Redline to:</p>
      <ul>
        <li>access, copy or attack a site you have no right to access, or circumvent access controls;</li>
        <li>store unlawful content in comments, attachments or recordings, or content that infringes someone else&apos;s rights;</li>
        <li>overload the service, scrape it, or resell it;</li>
        <li>reverse-engineer or interfere with the service or its security.</li>
      </ul>
      <p>
        We may remove content and suspend accounts that break these rules. Content you add remains yours; you grant us the licence needed to store it, show it to
        the members of your project and produce your exports.
      </p>

      <h2>4. Plans and billing</h2>
      <p>
        The Free plan is free. Pro and Team are subscriptions billed monthly or yearly in advance, at the prices on the <a href="/pricing">pricing page</a>{" "}
        plus VAT where it applies. Payment is collected by Stripe; you agree to Stripe&apos;s terms for the payment itself. Prices may change with at least 30
        days&apos; notice by e-mail; a change applies from your next renewal.
      </p>
      <p>
        Plan limits (projects, pages, people, Figma comparisons, recordings, frozen versions, PNG export) are described on the pricing page. When you reach a
        limit, existing content keeps working; adding more requires an upgrade.
      </p>

      <h2>5. Cancelling and refunds</h2>
      <p>
        You can cancel at any time from the billing page. Your plan stays active until the end of the period already paid for, and is not renewed. There are no
        refunds for partial periods, unless the law requires them.
      </p>
      <p>
        <strong>Consumers in the EU</strong> have a right of withdrawal: you may withdraw from a paid subscription within 14 days of the purchase without giving a
        reason, by e-mail to <a href="mailto:vinamra.kothari@gmx.de">vinamra.kothari@gmx.de</a>. If you asked for the service to start during the withdrawal
        period, you pay a proportionate amount for the time used. Redline is intended for professional use; if you use it as a business, the withdrawal right
        does not apply.
      </p>

      <h2>6. Availability</h2>
      <p>
        We aim for Redline to be available around the clock, but do not guarantee it. Maintenance, provider outages and the sites you review being unreachable can
        interrupt the service. If a paid feature is unavailable for a significant part of a billing period, we extend your subscription accordingly on request.
      </p>

      <h2>7. Liability</h2>
      <p>
        We are liable without limit for intent and gross negligence, for injury to life, body or health, and under the German Product Liability Act. For slight
        negligence we are liable only for breach of an essential contractual obligation, and then only for the typical, foreseeable damage; in that case
        liability is limited to the fees you paid in the twelve months before the event. We are not liable for the content of the sites you review or for
        decisions you take based on the comparison with Figma, which is an automated aid, not a guarantee.
      </p>

      <h2>8. Your data</h2>
      <p>
        How we handle personal data is described in the <a href="/privacy">privacy policy</a>. You can export your comments at any time, and ask for your
        account and its data to be deleted.
      </p>

      <h2>9. Changes to these terms</h2>
      <p>
        We may change these terms when the service changes or the law requires it. You will be told by e-mail at least 30 days before a change takes effect; if
        you do not agree, you can cancel before that date. Continued use after the date counts as acceptance.
      </p>

      <h2>10. Governing law</h2>
      <p>
        These terms are governed by German law, excluding the UN Convention on Contracts for the International Sale of Goods. For business customers the place of
        jurisdiction is the seat of the operator; for consumers the statutory rules apply. The EU platform for online dispute resolution is at{" "}
        <a href="https://ec.europa.eu/consumers/odr" rel="noreferrer">
          ec.europa.eu/consumers/odr
        </a>
        ; we are not obliged and do not undertake to take part in dispute-resolution proceedings before a consumer arbitration board.
      </p>
    </LegalPage>
  );
}
