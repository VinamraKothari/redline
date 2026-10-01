/** Questions for the landing page and the pricing page, in plain language. */

export const LANDING_FAQ: { q: string; a: string }[] = [
  {
    q: "Does the site I review need any setup?",
    a: "No. Paste the address and Redline fetches the page through its own proxy, so it works on sites that refuse to be embedded, on staging and on preview deployments. Nothing is installed on the site.",
  },
  {
    q: "What about pages behind a login?",
    a: "Redline loads the page as an anonymous visitor, so pages that need a session won't show their signed-in state. Public pages, marketing sites, docs and most preview deployments work out of the box.",
  },
  {
    q: "How do comments stay in place when the page changes?",
    a: "Each pin is anchored to the element you clicked, not to a pixel position, so it follows the layout across viewports and small changes. For bigger changes, freeze a version: the exact page you reviewed is stored and feedback stays attached to it.",
  },
  {
    q: "What does “Compare with Figma” actually check?",
    a: "Paste a link to the Figma frame of the page. Redline compares copy, typography, spacing, position, images, buttons and section sizes and writes one developer comment per difference — in plain language, pinned to the element it concerns.",
  },
  {
    q: "Who can see a review?",
    a: "Members of the project. Invite people by e-mail as viewers, editors or admins; they sign in with Google and see every page in the project. A view-only link shows the marked-up page without the authoring tools.",
  },
  {
    q: "Where does my data live?",
    a: "In the EU, on Supabase (Postgres) with the app hosted on Vercel. Frozen snapshots, attachments and recordings are stored in the same place. See the privacy policy for the details.",
  },
];

export const PRICING_FAQ: { q: string; a: string }[] = [
  {
    q: "Do prices include VAT?",
    a: "Prices are shown without VAT. Where VAT applies, Stripe adds it at checkout based on your country; if you enter a valid EU VAT ID for a business, VAT is handled under the reverse-charge rule where that applies. The invoice states exactly what was charged.",
  },
  {
    q: "Can I cancel any time?",
    a: "Yes. Cancel from the billing page with one click. Your plan stays active until the end of the period you already paid for, then the account drops back to Free — nothing is deleted.",
  },
  {
    q: "What counts as a page?",
    a: "A page is one URL under review at one point in time, inside a project. A frozen version or a saved state counts as its own page. Viewports don't count: one page can be reviewed at 1440, 1024 and 390 pixels.",
  },
  {
    q: "What happens when I hit a limit?",
    a: "Everything you already have keeps working: comments, exports and existing pages stay available. You just can't add the next project, page, member or Figma comparison until you upgrade or free something up.",
  },
  {
    q: "Do I get invoices?",
    a: "Every payment produces a Stripe invoice you can download from Account → Billing. On Team, the invoice carries your company name, address and VAT ID.",
  },
  {
    q: "Is there a trial for Pro or Team?",
    a: "The Free plan is the trial: it includes every tool and two Figma comparisons a month, with no time limit. Upgrade the moment you need more pages, people or comparisons.",
  },
];
