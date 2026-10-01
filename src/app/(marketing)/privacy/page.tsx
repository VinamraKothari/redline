import type { Metadata } from "next";
import { LegalPage, Placeholder } from "@/components/marketing/Legal";
import { LEGAL_UPDATED } from "@/content/site";

const description = "What Redline stores when you sign in, review a page, compare it with Figma or pay for a plan — and how to have it deleted.";

export const metadata: Metadata = {
  title: "Privacy policy — Redline",
  description,
  alternates: { canonical: "/privacy" },
  openGraph: { title: "Redline privacy policy", description, type: "website", url: "/privacy", siteName: "Redline" },
};

/* Draft, to be checked by a lawyer before the service goes paid. Placeholders mark facts that must be confirmed with the providers. */
export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy policy"
      lead="Redline is run by an individual in Germany, and this page is written the way you would explain it to a colleague: what we store, why, for how long, and how to have it deleted."
      updated={LEGAL_UPDATED}
      current="/privacy"
    >
      <h2>Who is responsible</h2>
      <p>
        The controller in the sense of the GDPR is Vinamra Kothari, the operator of Redline. Contact details, including the postal address, are on the{" "}
        <a href="/imprint">imprint</a>. For anything about your data write to <a href="mailto:vinamra.kothari@gmx.de">vinamra.kothari@gmx.de</a>.
      </p>

      <h2>What we store, and why</h2>
      <h3>Your account (Google sign-in)</h3>
      <p>
        You sign in with Google through Supabase Auth. We receive and store your name, e-mail address and profile picture, plus a user ID. We use them to
        show who wrote a comment, to match invitations sent to your e-mail address, and to send you nothing else — Redline does not send marketing e-mail.
        Legal basis: performance of the contract (Art. 6 (1) b GDPR).
      </p>
      <h3>The pages you review</h3>
      <p>
        When you paste a URL, our server fetches that page and its assets (stylesheets, fonts, images, scripts) through a proxy and serves them back to your
        browser. The fetched page is not stored, except: a small preview image of each page is rendered for the project overview, and when you <strong>freeze</strong>{" "}
        a version or <strong>save a state</strong>, a snapshot of the rendered page (HTML with inlined styles) is stored so everyone in the project reviews the same
        thing. The site you review sees requests from our server, not from your browser. Legal basis: contract.
      </p>
      <h3>Comments, drawings, recordings and attachments</h3>
      <p>
        Everything you add to a review — comment threads, drawn shapes, images you attach, screen recordings you make — is stored with your user ID and a
        timestamp and shown to the members of the project. Attachments and recordings are stored as files under an unguessable URL so Jira and other tools can
        download them. Legal basis: contract.
      </p>
      <h3>Compare with Figma</h3>
      <p>
        When you paste a Figma link, our server fetches that frame from the Figma API with Redline&apos;s own token. The design data is processed in memory to
        compute the differences; only the resulting developer comments are stored. We do not keep a copy of your Figma file. Legal basis: contract. Figma&apos;s
        own privacy terms apply to your Figma account.
      </p>
      <h3>Payments</h3>
      <p>
        Paid plans are billed by Stripe. Your card details go directly to Stripe and never touch Redline&apos;s servers; we store your Stripe customer ID, the
        plan, the billing interval and the period end so we know what your account may do. Invoices are produced by Stripe. Legal basis: contract and legal
        obligations to keep accounting records. Stripe Payments Europe, Ltd., Dublin, Ireland, is a separate controller for the payment itself.
      </p>
      <h3>Server logs</h3>
      <p>
        Our hosting provider records the IP address, time, requested URL and user agent of each request for a short time to keep the service secure and
        working. Legal basis: legitimate interest (Art. 6 (1) f GDPR).
      </p>

      <h2>Cookies</h2>
      <p>
        Redline sets only the cookies it needs to work: your session (so you stay signed in) and, while a page is under review, a cookie naming the site being
        proxied so that its assets load correctly. There are no analytics or advertising cookies and no tracking pixels, which is why there is no cookie banner.
      </p>

      <h2>Where the data lives</h2>
      <ul>
        <li>
          <strong>Supabase</strong> (Supabase Inc.) hosts the database, file storage and authentication, in the{" "}
          <Placeholder>[Supabase project region — confirm in the Supabase dashboard]</Placeholder> region.
        </li>
        <li>
          <strong>Vercel</strong> (Vercel Inc.) hosts the application and renders previews and exports. Requests are served from the edge location nearest
          to you, which may be in the EU or the US; the application&apos;s server functions run in{" "}
          <Placeholder>[function region — confirm in the Vercel project settings]</Placeholder>.
        </li>
        <li>
          <strong>Stripe</strong> processes payments (see above).
        </li>
        <li>
          <strong>Figma</strong> provides the design data you ask us to compare with.
        </li>
        <li>
          <strong>Google</strong> provides sign-in.
        </li>
      </ul>
      <p>
        Where a provider processes data outside the EU, the transfer is covered by the EU standard contractual clauses or by the provider&apos;s certification under
        the EU–US Data Privacy Framework.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Your data stays as long as your account exists. Reviews, comments, snapshots and attachments are deleted when you delete the page, the project or your
        account; backups are overwritten within <Placeholder>[backup retention — confirm with Supabase]</Placeholder>. Billing records are kept for the ten years
        German tax law requires. Server logs are kept for at most <Placeholder>[log retention — confirm with Vercel]</Placeholder>.
      </p>

      <h2>Your rights</h2>
      <p>
        Under the GDPR you can ask for access to the data we hold about you, have it corrected or deleted, restrict or object to its processing, and receive it
        in a portable format. You can also withdraw a consent at any time, and you can complain to a data-protection authority — in Germany the one of the
        state you live in. To exercise any of these, write to <a href="mailto:vinamra.kothari@gmx.de">vinamra.kothari@gmx.de</a>; we answer within a month.
      </p>

      <h2>Deleting your account</h2>
      <p>
        Send a short e-mail from the address you sign in with. We delete your profile, the projects you own with everything in them, and your subscription;
        comments you left in other people&apos;s projects are kept with your name replaced by &ldquo;Deleted user&rdquo;, because they are part of those projects&apos;
        record.
      </p>

      <h2>Changes</h2>
      <p>This policy changes when the service does. The date at the top says when it was last updated; substantial changes are announced in the changelog.</p>
    </LegalPage>
  );
}
