import type { Metadata } from "next";
import { LegalPage, Placeholder } from "@/components/marketing/Legal";
import { LEGAL_UPDATED } from "@/content/site";

const description = "Who runs Redline (Impressum, § 5 DDG).";

export const metadata: Metadata = {
  title: "Imprint — Redline",
  description,
  alternates: { canonical: "/imprint" },
  openGraph: { title: "Redline imprint", description, type: "website", url: "/imprint", siteName: "Redline" },
};

/* The address and VAT placeholders must be filled in before this page goes live. */
export default function ImprintPage() {
  return (
    <LegalPage eyebrow="Legal" title="Imprint" lead="Information according to § 5 DDG (German Digital Services Act) and § 18 (2) MStV." updated={LEGAL_UPDATED} current="/imprint">
      <h2>Operator</h2>
      <p>
        Vinamra Kothari
        <br />
        <Placeholder>[Street and number]</Placeholder>
        <br />
        <Placeholder>[Postcode City]</Placeholder>
        <br />
        Germany
      </p>

      <h2>Contact</h2>
      <p>
        E-mail: <a href="mailto:vinamra.kothari@gmx.de">vinamra.kothari@gmx.de</a>
      </p>

      <h2>Responsible for the content</h2>
      <p>Vinamra Kothari, at the address above (§ 18 (2) MStV).</p>

      <h2>VAT</h2>
      <p>
        VAT identification number according to § 27a UStG: <Placeholder>[VAT ID, or the applicable VAT status]</Placeholder>
      </p>

      <h2>Dispute resolution</h2>
      <p>
        The European Commission provides a platform for online dispute resolution at{" "}
        <a href="https://ec.europa.eu/consumers/odr" rel="noreferrer">
          ec.europa.eu/consumers/odr
        </a>
        . We are neither obliged nor willing to take part in dispute-resolution proceedings before a consumer arbitration board.
      </p>

      <h2>Liability for links</h2>
      <p>
        Redline loads third-party websites at your request so that you can review them. Their content belongs to their operators; we have no influence on it
        and do not adopt it as our own.
      </p>
    </LegalPage>
  );
}
