/**
 * What changed, in product language. One entry per release day, newest
 * first; the changelog page groups them by month.
 */
export interface ChangelogEntry {
  /** ISO date, YYYY-MM-DD */
  date: string;
  title: string;
  /** one short paragraph per change */
  items: string[];
  /** a small label for the kind of release */
  tag?: "new" | "improved" | "fixed";
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-09-30",
    title: "Plans, a pricing page and a proper site",
    tag: "new",
    items: [
      "Free, Pro and Team plans, with limits on projects, pages, people and Figma comparisons. Pay by card via Stripe; manage your plan under Account → Billing. Card details never touch Redline.",
      "Settings (press ,) choose which developer comments you see, by category and severity.",
      "New pages around the app: pricing, how it works, this changelog, and the privacy, terms and imprint pages.",
    ],
  },
  {
    date: "2026-09-27",
    title: "Developer comments speak plainly",
    tag: "improved",
    items: [
      "Every difference between the page and its Figma frame is now one comment with one cause, written the way you would say it to a colleague: “Reads ‘Ship faster’, the design says ‘Ship better’.”",
      "Findings are labelled by category (copy, typography, spacing, …) and severity, so a long list can be triaged at a glance.",
    ],
  },
  {
    date: "2026-09-18",
    title: "Compare with Figma",
    tag: "new",
    items: [
      "Paste a link to the Figma frame of the page you are reviewing (⇧G). Redline compares the live page with the design and pins a violet developer comment on every element that differs — copy, font size and weight, colours, spacing, position, images, buttons and section sizes.",
      "Developer comments live in the same panel as everyone else's, can be replied to, resolved and exported to Jira.",
    ],
  },
  {
    date: "2026-09-12",
    title: "Recordings that last",
    tag: "fixed",
    items: [
      "Each clip gets its own recorder, so back-to-back recordings no longer bleed into each other. Clips are smaller and their duration shows correctly in every player.",
      "When a recording can't start — a blocked screen-share permission, an unsupported browser — Redline now says why.",
    ],
  },
  {
    date: "2026-09-11",
    title: "Recordings, viewport ranges, read & unread",
    tag: "new",
    items: [
      "Record your screen straight into a comment: a short clip says more than three paragraphs about a broken animation.",
      "A thread can apply to several viewports at once (“Desktop + Tablet”) and follows its element to each of them.",
      "Threads with new replies are flagged unread; U toggles a thread, ⇧U marks everything read, and the state follows you between devices.",
      "Save the current state as a new page (⇧P): open drawers, dialogs and locked menus become a frozen page everyone can comment on.",
      "Lock hover (H) keeps a CSS or script-driven menu open while you move the pointer to comment on it.",
      "Every action has a shortcut; press ? in a review to see them.",
      "PNG and Jira exports are rendered on the server: scroll-animated sections are revealed and lazy images are waited for, so the screenshots show the whole page.",
      "Pins stay in sync while the page scrolls, and saved states and exports are sturdier on long pages.",
    ],
  },
  {
    date: "2026-09-09",
    title: "Sign in with Google, projects and roles",
    tag: "new",
    items: [
      "Everyone signs in with Google. Reviews live in projects; invite people by e-mail as viewers, editors or admins and they see every page in the project.",
      "Live cursors show who is looking where; comments can carry a title, and Jira exports include the attachments.",
      "A landing page with a URL box: paste an address, sign in, and the review opens right after.",
      "Page previews are rendered on the server, so project pages show a thumbnail of every page.",
      "Client-side apps run for real: scripts, fetch calls and dynamic chunks go through the proxy, and a page whose scripts crash falls back to a static render instead of a blank frame.",
      "Pages and projects can be renamed and pages moved between projects. Consent managers no longer block a site's own scripts.",
    ],
  },
  {
    date: "2026-09-08",
    title: "Redline 0.1",
    tag: "new",
    items: [
      "The first release: load any live website through Redline's proxy, pin comments to elements, draw on the page, inspect typography, colours and spacing, measure between elements and share the marked-up canvas with a link.",
      "Hosted on Vercel with Supabase for data and realtime; without a database configured it runs from a local file.",
    ],
  },
];
