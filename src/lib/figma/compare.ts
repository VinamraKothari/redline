import type { FigmaSpec, SpecNode, SpecText } from "./spec";
import type { ImplNode, ImplSnapshot } from "./snapshot";

/**
 * Compares a Figma frame with the rendered page and lists every difference a
 * developer would have to fix: copy, type, colour, geometry, spacing, images
 * and missing pieces. Pure — runs on the server and in tests.
 *
 * Approach: match Figma text nodes to rendered text runs (exact, fuzzy, then
 * by position), use the matches to learn how the page's vertical rhythm
 * drifts from the design, then compare styles on each pair and geometry
 * between neighbouring pairs (gaps, paddings, x positions, sizes).
 */

export type Rule =
  | "section-spacing"
  | "copy"
  | "copy-case"
  | "copy-punctuation"
  | "font-size"
  | "font-weight"
  | "font-family"
  | "line-height"
  | "letter-spacing"
  | "text-color"
  | "text-transform"
  | "text-decoration"
  | "text-align"
  | "position-x"
  | "width"
  | "height"
  | "gap"
  | "padding"
  | "section-height"
  | "missing-text"
  | "missing-image"
  | "image-size"
  | "image-position"
  | "background"
  | "radius"
  | "border"
  | "extra-text";

export interface Finding {
  rule: Rule;
  severity: "high" | "medium" | "low";
  title: string;
  body: string;
  expected: string;
  actual: string;
  figmaId: string;
  figmaName: string;
  /** index into the snapshot, when the finding is pinned to a rendered element */
  dom?: number;
  sel?: string;
  label?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  region?: { x: number; y: number; w: number; h: number } | null;
  /** what the finding is about, in a few words (the text, the image) — for grouped lists */
  subject?: string;
  fingerprint: string;
}

export interface CompareOptions {
  /** ignore differences smaller than these (px) */
  tolerance?: { position?: number; size?: number; gap?: number; font?: number };
  /** cap on findings */
  limit?: number;
  /** collapse identical findings within a section into one (default true) */
  group?: boolean;
  /** debugging: every text / image match as it is made */
  onMatch?: (figma: SpecNode, dom: ImplNode, kind: string) => void;
  /** debugging: log gap measurements for frames whose name matches */
  debugGap?: RegExp;
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

interface FNode extends SpecNode {
  parent: FNode | null;
  section: number;
  depth: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const px = (v: number) => `${r1(v)}px`;

function norm(s: string): string {
  return s
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function key(s: string): string {
  return norm(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = " " + s + " ";
  for (let i = 0; i < t.length - 1; i++) {
    const b = t.slice(i, i + 2);
    m.set(b, (m.get(b) || 0) + 1);
  }
  return m;
}
function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  let na = 0;
  let nb = 0;
  for (const v of A.values()) na += v;
  for (const v of B.values()) nb += v;
  for (const [k, v] of A) inter += Math.min(v, B.get(k) || 0);
  return (2 * inter) / (na + nb);
}
const PLACEHOLDER = /lorem ipsum|dolor sit amet|consectetur|adipiscing|placeholder|category tag|marvin mckinney|jun 5, 2025|12 min read|^\d+(\.\d+)?k?$|^text$|^heading$|^tagline$/i;
function isPlaceholder(s: string): boolean {
  return PLACEHOLDER.test(norm(s));
}
function famKey(f?: string): string {
  if (!f) return "";
  let s = f.toLowerCase().replace(/^__/, "").replace(/_[0-9a-f]{6,}$/i, "").replace(/-fallback$/, "");
  s = s.replace(/[^a-z]/g, "");
  return s;
}
function hexRgb(h: string): [number, number, number] | null {
  const m = h.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function colorClose(a?: string, b?: string, tol = 8): boolean {
  if (!a || !b) return true;
  const A = hexRgb(a);
  const B = hexRgb(b);
  if (!A || !B) return a.toLowerCase() === b.toLowerCase();
  return Math.max(Math.abs(A[0] - B[0]), Math.abs(A[1] - B[1]), Math.abs(A[2] - B[2])) <= tol;
}
function lhPx(t: SpecText): number | null {
  const lh = t.lineHeight;
  if (lh == null || lh === "auto" || !t.size) return null;
  if (typeof lh === "number") return lh;
  const m = String(lh).match(/^([\d.]+)%$/);
  return m ? (t.size * parseFloat(m[1])) / 100 : null;
}
function lsPx(t: SpecText): number {
  const ls = t.letterSpacing;
  if (ls == null || !t.size) return 0;
  if (typeof ls === "number") return ls;
  const m = String(ls).match(/^(-?[\d.]+)%$/);
  return m ? (t.size * parseFloat(m[1])) / 100 : 0;
}
function iou(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}
function shortName(n: SpecNode): string {
  const t = n.text?.chars ? norm(n.text.chars) : n.name;
  return t.length > 48 ? t.slice(0, 45) + "…" : t;
}
function styleSummary(t: SpecText): string {
  const parts = [t.family, t.weight ? String(t.weight) : "", t.size ? `${t.size}px` : "", t.lineHeight && t.lineHeight !== "auto" ? `lh ${t.lineHeight}` : ""].filter(Boolean);
  return parts.join(" ");
}

/* ── flatten the design ──────────────────────────────────────────────────── */

function flatten(spec: FigmaSpec): FNode[] {
  const out: FNode[] = [];
  const walk = (n: SpecNode, parent: FNode | null, section: number, depth: number) => {
    if (n.v === false) return;
    if (/^filler$/i.test(n.name)) return;
    const f: FNode = { ...n, parent, section, depth };
    out.push(f);
    n.children?.forEach((c) => walk(c, f, section, depth + 1));
  };
  spec.sections.forEach((s, i) => walk(s, null, i, 0));
  return out;
}

/* ── snapshot preparation ────────────────────────────────────────────────── */

/**
 * Normalise a snapshot before comparing: older snapshots carry text on a
 * wrapper and again on its only child, and know nothing about overflow
 * clipping — both are repaired here so the rules see one run per text and
 * the visible part of cover-fit images.
 */
function prepare(impl: ImplSnapshot): ImplSnapshot {
  const nodes = impl.nodes.map((n) => ({ ...n }));
  const kidsOf = new Map<number, number[]>();
  nodes.forEach((n) => {
    if (n.p >= 0) {
      if (!kidsOf.has(n.p)) kidsOf.set(n.p, []);
      kidsOf.get(n.p)!.push(n.i);
    }
  });
  // a wrapper whose words all come from its children is not a run of its own
  for (const n of nodes) {
    if (!n.text) continue;
    const kids = (kidsOf.get(n.i) ?? []).filter((i) => nodes[i].text);
    if (!kids.length) continue;
    const own = key(n.text.chars).replace(/\s+/g, "");
    if (kids.some((i) => key(nodes[i].text!.chars) === key(n.text!.chars)) || kids.map((i) => key(nodes[i].text!.chars).replace(/\s+/g, "")).join("") === own) delete n.text;
  }
  // parked beside the page (slide-in menus, carousel clones): not part of the layout
  for (const n of nodes) if (n.x >= impl.width - 1 || n.x + n.w <= 1) {
    delete n.text;
    delete n.img;
  }
  const knowsClipping = nodes.some((n) => n.clip || n.clipped);
  if (!knowsClipping) {
    // cover-fit images spill out of their (overflow hidden) box: keep the visible part
    for (const n of nodes) {
      if (!n.img || n.p < 0) continue;
      let p = nodes[n.p];
      for (let k = 0; k < 4 && p.p >= 0 && p.w >= n.w - 1 && p.h >= n.h - 1; k++) p = nodes[p.p];
      if (n.w <= p.w + 1 && n.h <= p.h + 1) continue;
      const x = Math.max(n.x, p.x);
      const y = Math.max(n.y, p.y);
      const r = Math.min(n.x + n.w, p.x + p.w);
      const b = Math.min(n.y + n.h, p.y + p.h);
      if (r - x > 0 && b - y > 0) Object.assign(n, { x, y, w: r - x, h: b - y, clipped: true });
    }
  }
  return { ...impl, nodes };
}

/* ── the comparison ──────────────────────────────────────────────────────── */

export function compare(spec: FigmaSpec, rawImpl: ImplSnapshot, opts: CompareOptions = {}): Finding[] {
  const tol = { position: 2, size: 4, gap: 1, font: 0.6, ...(opts.tolerance ?? {}) };
  const limit = opts.limit ?? 400;
  const impl = prepare(rawImpl);
  // a narrower page (a scrollbar took 15px) centres everything a little to the left
  const xSlack = Math.max(0, (spec.w - impl.width) / 2);
  const fnodes = flatten(spec);
  const byId = new Map<string, FNode>();
  fnodes.forEach((f) => byId.set(f.id, f));
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const add = (f: Omit<Finding, "fingerprint">) => {
    const fp = `${f.rule}|${f.figmaId}|${f.sel || f.dom || ""}`;
    if (seen.has(fp)) return;
    seen.add(fp);
    findings.push({ ...f, fingerprint: fp });
  };
  const nodes = impl.nodes;
  const parentOf = (i: number) => (i >= 0 ? nodes[i].p : -1);

  // ── 1. texts ─────────────────────────────────────────────────────────────
  const ftexts = fnodes.filter((f) => f.type === "TEXT" && f.text && norm(f.text.chars).length > 0 && f.w > 0 && f.h > 0);
  const dtexts = nodes.filter((n) => n.text && n.text.chars.length > 0 && n.w > 0 && n.h > 0);
  const dTaken = new Set<number>();
  const match = new Map<FNode, ImplNode>();
  const matchKind = new Map<FNode, "exact" | "fuzzy" | "position">();

  // offset model: figma y → page y, learnt from matches (nearest matched pair by figma y)
  const pairs: { fy: number; dy: number }[] = [];
  const offsetAt = (fy: number): number => {
    if (!pairs.length) return 0;
    let best = pairs[0];
    let bd = Infinity;
    for (const p of pairs) {
      const d = Math.abs(p.fy - fy);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best.dy - best.fy;
  };
  const dist = (f: FNode, d: ImplNode) => {
    const fy = f.y + offsetAt(f.y);
    return Math.hypot((f.x - d.x) * 0.6, fy - d.y);
  };
  const take = (f: FNode, d: ImplNode, kind: "exact" | "fuzzy" | "position", anchor = kind !== "position") => {
    opts.onMatch?.(f, d, kind);
    match.set(f, d);
    matchKind.set(f, kind);
    dTaken.add(d.i);
    if (anchor) pairs.push({ fy: f.y, dy: d.y });
  };

  const fKeys = new Map<FNode, string>();
  ftexts.forEach((f) => fKeys.set(f, key(f.text!.chars)));
  const dKeys = new Map<number, string>();
  dtexts.forEach((d) => dKeys.set(d.i, key(d.text!.chars)));
  const dByKey = new Map<string, ImplNode[]>();
  dtexts.forEach((d) => {
    const k = dKeys.get(d.i)!;
    if (!dByKey.has(k)) dByKey.set(k, []);
    dByKey.get(k)!.push(d);
  });
  const fCount = new Map<string, number>();
  ftexts.forEach((f) => fCount.set(fKeys.get(f)!, (fCount.get(fKeys.get(f)!) || 0) + 1));

  // pass A: keys unique on both sides — the anchors of the offset model
  const ordered = ftexts.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  for (const f of ordered) {
    const k = fKeys.get(f)!;
    if (k.length < 3) continue;
    const cands = dByKey.get(k);
    if (cands && cands.length === 1 && fCount.get(k) === 1) take(f, cands[0], "exact");
  }
  // pass B: repeated exact keys ("Contact Us" in the header and the footer), nearest by
  // predicted position — a candidate far from where the model expects it belongs to
  // another occurrence, so it is left for that one
  for (const f of ordered) {
    if (match.has(f)) continue;
    const k = fKeys.get(f)!;
    const cands = (dByKey.get(k) || []).filter((d) => !dTaken.has(d.i));
    if (!cands.length) continue;
    cands.sort((a, b) => dist(f, a) - dist(f, b));
    const best = dist(f, cands[0]);
    if (pairs.length && best > 400) continue;
    take(f, cands[0], "exact", best <= 120);
  }
  // pass C: fuzzy (typos, casing already ignored by key(); wording changes)
  for (const f of ordered) {
    if (match.has(f)) continue;
    const k = fKeys.get(f)!;
    if (k.length < 4 || isPlaceholder(f.text!.chars)) continue;
    let best: { d: ImplNode; s: number } | null = null;
    for (const d of dtexts) {
      if (dTaken.has(d.i)) continue;
      const dk = dKeys.get(d.i)!;
      let s = dice(k, dk);
      // one side is a prefix/superset of the other (line broken differently, extra word)
      if (s < 0.75 && (dk.startsWith(k) || k.startsWith(dk)) && Math.min(k.length, dk.length) >= 8) s = 0.8;
      if (s < 0.72) continue;
      const geo = dist(f, d);
      if (geo > 400) continue;
      const score = s - geo / 4000;
      if (!best || score > best.s) best = { d, s: score };
    }
    if (best) take(f, best.d, "fuzzy");
  }
  // pass D: same place, different words (CMS copy, placeholders) — style only
  for (const f of ordered) {
    if (match.has(f)) continue;
    const fy = f.y + offsetAt(f.y);
    let best: { d: ImplNode; s: number } | null = null;
    for (const d of dtexts) {
      if (dTaken.has(d.i)) continue;
      const dx = Math.abs(d.x - f.x);
      const dy = Math.abs(d.y - fy);
      if (dx > 16 || dy > 40) continue;
      const sizeOk = !f.text!.size || Math.abs(d.text!.size - f.text!.size) <= Math.max(6, f.text!.size * 0.5);
      if (!sizeOk) continue;
      const s = dx + dy;
      if (!best || s < best.s) best = { d, s };
    }
    if (best) take(f, best.d, "position");
  }

  // pass E: one design paragraph rendered as several page elements — pick up the
  // continuation and treat the run as one (its box is the union)
  const splitInto = new Map<FNode, ImplNode[]>();
  for (const f of ordered) {
    const d = match.get(f);
    if (!d || matchKind.get(f) === "position") continue;
    const fk = fKeys.get(f)!;
    const dk = dKeys.get(d.i)!;
    if (dk.length + 8 > fk.length || !fk.startsWith(dk)) continue;
    const parts = [d];
    let rest = fk.slice(dk.length).trim();
    let last = d;
    while (rest.length) {
      const sameLine = (c: ImplNode) => Math.abs(c.y - last.y) <= 4 && c.x >= last.x + last.w - 2 && c.x < last.x + last.w + 40;
      const nextLine = (c: ImplNode) => Math.abs(c.x - d.x) <= 8 && c.y > last.y && c.y < last.y + last.h + 80;
      const next = dtexts
        .filter((c) => !dTaken.has(c.i) && c.i !== d.i && (sameLine(c) || nextLine(c)))
        .sort((a, b) => a.y - b.y || a.x - b.x)[0];
      if (!next) break;
      const nk = dKeys.get(next.i)!;
      if (!nk || !rest.startsWith(nk)) break;
      parts.push(next);
      dTaken.add(next.i);
      rest = rest.slice(nk.length).trim();
      last = next;
    }
    if (parts.length < 2) continue;
    splitInto.set(f, parts);
    const box = { x: Math.min(...parts.map((p) => p.x)), y: Math.min(...parts.map((p) => p.y)), r: Math.max(...parts.map((p) => p.x + p.w)), b: Math.max(...parts.map((p) => p.y + p.h)) };
    const joined: ImplNode = { ...d, x: box.x, y: box.y, w: box.r - box.x, h: box.b - box.y, text: { ...d.text!, chars: parts.map((p) => p.text!.chars).join("\n"), lines: parts.reduce((n, p) => n + p.text!.lines, 0) } };
    match.set(f, joined);
  }

  // ── 2. text findings ─────────────────────────────────────────────────────
  const xCands: { f: FNode; d: ImplNode; dx: number; centered: boolean }[] = [];
  for (const f of ordered) {
    const d = match.get(f);
    const t = f.text!;
    if (!d) {
      if (!isPlaceholder(t.chars) && key(t.chars).length >= 3 && !/^[\d.,€$%]+$/.test(norm(t.chars))) {
        const y = Math.max(0, f.y + offsetAt(f.y));
        add({
          rule: "missing-text",
          severity: "high",
          title: `Missing text: “${shortName(f)}”`,
          body: `The design has the text “${norm(t.chars).slice(0, 160)}” (${styleSummary(t)}) at x ${px(f.x)}, but nothing matching it renders on the page near that position.\n\nFigma layer: ${f.name}\nFix: add the element, or check that it is not hidden / conditionally rendered.`,
          expected: norm(t.chars).slice(0, 160),
          actual: "not found",
          figmaId: f.id,
          figmaName: f.name,
          x: f.x,
          y,
          w: f.w,
          h: f.h,
          region: { x: f.x, y, w: f.w, h: f.h },
        });
      }
      continue;
    }
    const kind = matchKind.get(f)!;
    const dt = d.text!;
    const base = { figmaId: f.id, figmaName: f.name, dom: d.i, sel: d.sel, label: d.label, x: d.x, y: d.y, w: d.w, h: d.h, subject: `“${norm(dt.chars).slice(0, 48)}${norm(dt.chars).length > 48 ? "…" : ""}”` };
    const where = `${d.label}`;

    // a placeholder left on the page where the design has real copy
    if (kind === "position" && isPlaceholder(dt.chars) && !isPlaceholder(t.chars)) {
      add({
        ...base,
        rule: "copy",
        severity: "high",
        title: `Placeholder “${norm(dt.chars).slice(0, 30)}” → should read “${norm(t.chars).slice(0, 40)}”`,
        body: `Page (${where}): “${norm(dt.chars)}” — placeholder text\nFigma (${f.name}): “${norm(t.chars)}”\n\nReplace the placeholder with the real copy (or wire up the CMS field).`,
        expected: norm(t.chars).slice(0, 160),
        actual: norm(dt.chars),
      });
    }
    const parts = splitInto.get(f);
    if (parts) {
      add({
        ...base,
        rule: "copy",
        severity: "medium",
        title: `Paragraph split into ${parts.length} elements — the design has one text block`,
        body: `Page (${where}): ${parts.length} separate elements${parts.map((p) => `\n• “${norm(p.text!.chars).slice(0, 70)}…”`).join("")}\nFigma (${f.name}): one text layer\n\nRender it as one element (line breaks inside), so spacing and wrapping follow the design.`,
        expected: "1 text block",
        actual: `${parts.length} elements`,
      });
    }
    // copy (separators and numbers are not copy)
    if (kind !== "position" && /\p{L}/u.test(t.chars) && !parts) {
      const fn = norm(t.chars);
      const dn = norm(dt.chars);
      const fcase = t.case === "UPPER" ? fn.toUpperCase() : t.case === "LOWER" ? fn.toLowerCase() : fn;
      const dcase = dt.transform === "uppercase" ? dn.toUpperCase() : dt.transform === "lowercase" ? dn.toLowerCase() : dn;
      if (fcase !== dcase) {
        const stripPunct = (s: string) => s.replace(/[.,:;!?…]+$/g, "").trim();
        if (fcase.toLowerCase() === dcase.toLowerCase()) {
          add({
            ...base,
            rule: "copy-case",
            severity: "low",
            title: `Capitalisation: “${dn.slice(0, 40)}” → “${fcase.slice(0, 40)}”`,
            body: `Page (${where}): “${dn}”\nFigma: “${fcase}”\n\nOnly the letter case differs. ${t.case === "UPPER" ? "The design uses uppercase — prefer text-transform: uppercase over hard-coded caps." : "Match the design's casing in the copy (or drop the text-transform)."}`,
            expected: fcase,
            actual: dn,
          });
        } else if (stripPunct(fcase) === stripPunct(dcase)) {
          const fEnd = fcase.slice(stripPunct(fcase).length);
          const dEnd = dcase.slice(stripPunct(dcase).length);
          add({
            ...base,
            rule: "copy-punctuation",
            severity: "low",
            title: fEnd && !dEnd ? `Missing “${fEnd}” at the end of “${stripPunct(dn).slice(0, 36)}…”` : !fEnd && dEnd ? `Extra “${dEnd}” at the end of “${stripPunct(dn).slice(0, 36)}…”` : `Punctuation differs: “${dEnd}” → “${fEnd}”`,
            body: `Page (${where}): “${dn}”\nFigma: “${fcase}”\n\nOnly the trailing punctuation differs.`,
            expected: fcase,
            actual: dn,
          });
        } else {
          add({
            ...base,
            rule: "copy",
            severity: "medium",
            title: `Copy differs: “${dn.slice(0, 44)}${dn.length > 44 ? "…" : ""}”`,
            body: `Page (${where}):\n“${dn}”\n\nFigma (${f.name}):\n“${fcase}”\n\nUpdate the copy to match the design (or confirm the change with content).`,
            expected: fcase,
            actual: dn,
          });
        }
      }
    }

    // typography — skip runs the design itself styles inconsistently
    const mixed = !!t.segments && t.segments.length > 1;
    if (t.size && Math.abs(dt.size - t.size) > tol.font) {
      add({
        ...base,
        rule: "font-size",
        severity: "medium",
        title: `Font size ${px(dt.size)} → should be ${px(t.size)}`,
        body: `Page (${where}): font-size ${px(dt.size)} on “${norm(dt.chars).slice(0, 60)}”\nFigma: ${px(t.size)} (${styleSummary(t)})\n\nSet font-size: ${px(t.size)}${mixed ? " (the layer mixes sizes — check the segment)" : ""}.`,
        expected: px(t.size),
        actual: px(dt.size),
      });
    }
    if (t.weight && !mixed && Math.abs(dt.weight - t.weight) >= 100) {
      add({
        ...base,
        rule: "font-weight",
        severity: "medium",
        title: `Font weight ${dt.weight} → should be ${t.weight}${t.style ? ` (${t.style})` : ""}`,
        body: `Page (${where}): font-weight ${dt.weight} on “${norm(dt.chars).slice(0, 60)}”\nFigma: ${t.weight}${t.style ? ` — ${t.family} ${t.style}` : ""}\n\nSet font-weight: ${t.weight}.`,
        expected: String(t.weight),
        actual: String(dt.weight),
      });
    }
    if (t.family && famKey(t.family) && famKey(dt.family) && !famKey(dt.family).startsWith(famKey(t.family)) && !famKey(t.family).startsWith(famKey(dt.family))) {
      add({
        ...base,
        rule: "font-family",
        severity: "high",
        title: `Font family “${dt.family}” → should be “${t.family}”`,
        body: `Page (${where}): font-family ${dt.family}\nFigma: ${t.family}${t.style ? ` ${t.style}` : ""}\n\nLoad and apply “${t.family}” for this text.`,
        expected: t.family,
        actual: dt.family,
      });
    }
    const flh = lhPx(t);
    if (flh && t.size && Number.isFinite(dt.lineHeight) && dt.lineHeight > 0) {
      const fr = flh / t.size;
      const dr = dt.lineHeight / dt.size;
      if (Math.abs(fr - dr) > 0.06 && Math.abs(dt.lineHeight - (dt.size * flh) / t.size) > 1.2) {
        add({
          ...base,
          rule: "line-height",
          severity: "low",
          title: `Line height ${r1(dr * 100)}% → should be ${r1(fr * 100)}%`,
          body: `Page (${where}): line-height ${px(dt.lineHeight)} at ${px(dt.size)} (${r1(dr * 100)}%)\nFigma: ${t.lineHeight} → ${px(flh)} at ${px(t.size)}\n\nSet line-height: ${r1(fr * 100)}% (${px((dt.size * flh) / t.size)} at the current size).`,
          expected: `${r1(fr * 100)}%`,
          actual: `${r1(dr * 100)}%`,
        });
      }
    }
    const fls = lsPx(t);
    if (t.size && Math.abs(fls - dt.letterSpacing) > 0.25 && Math.abs(fls / t.size - dt.letterSpacing / dt.size) > 0.008) {
      add({
        ...base,
        rule: "letter-spacing",
        severity: "low",
        title: `Letter spacing ${px(dt.letterSpacing)} → should be ${px(fls)}`,
        body: `Page (${where}): letter-spacing ${px(dt.letterSpacing)}\nFigma: ${t.letterSpacing ?? 0}${typeof t.letterSpacing === "number" ? "px" : ""} (${px(fls)} at ${px(t.size)})\n\nSet letter-spacing: ${px(fls)}.`,
        expected: px(fls),
        actual: px(dt.letterSpacing),
      });
    }
    if (t.color && !mixed && hexRgb(dt.color) && !colorClose(t.color, dt.color)) {
      add({
        ...base,
        rule: "text-color",
        severity: "medium",
        title: `Text colour ${dt.color} → should be ${t.color}`,
        body: `Page (${where}): color ${dt.color} on “${norm(dt.chars).slice(0, 60)}”\nFigma: ${t.color}\n\nSet color: ${t.color}.`,
        expected: t.color,
        actual: dt.color,
      });
    }
    if (t.case && t.case !== "ORIGINAL" && t.case !== "MIXED") {
      const want = t.case === "UPPER" ? "uppercase" : t.case === "LOWER" ? "lowercase" : t.case === "TITLE" ? "capitalize" : null;
      const isAlready = t.case === "UPPER" ? norm(dt.chars) === norm(dt.chars).toUpperCase() : t.case === "LOWER" ? norm(dt.chars) === norm(dt.chars).toLowerCase() : false;
      if (want && dt.transform !== want && !isAlready) {
        add({
          ...base,
          rule: "text-transform",
          severity: "low",
          title: `Text should be ${want}`,
          body: `Page (${where}): text-transform ${dt.transform}\nFigma: ${t.case}\n\nSet text-transform: ${want}.`,
          expected: want,
          actual: dt.transform,
        });
      }
    }
    if (t.decoration === "UNDERLINE" && !/underline/.test(dt.decoration)) {
      add({
        ...base,
        rule: "text-decoration",
        severity: "low",
        title: "Text should be underlined",
        body: `Page (${where}): text-decoration ${dt.decoration || "none"}\nFigma: UNDERLINE\n\nSet text-decoration: underline.`,
        expected: "underline",
        actual: dt.decoration || "none",
      });
    }
    // alignment matters when the block wraps
    if (t.align && dt.lines > 1 && f.w > 200) {
      const want = t.align === "CENTER" ? "center" : t.align === "RIGHT" ? "right" : t.align === "JUSTIFIED" ? "justify" : "left";
      const have = dt.align === "start" ? "left" : dt.align === "end" ? "right" : dt.align;
      if (want !== have) {
        add({
          ...base,
          rule: "text-align",
          severity: "low",
          title: `Text alignment ${have} → should be ${want}`,
          body: `Page (${where}): text-align ${have}\nFigma: ${t.align}\n\nSet text-align: ${want}.`,
          expected: want,
          actual: have,
        });
      }
    }
    // horizontal position — the layouts share a width, so x is directly comparable
    // (reported after the layout pass, once per shifted block rather than per line)
    const dxLeft = d.x - f.x;
    const dxCenter = d.x + d.w / 2 - (f.x + f.w / 2);
    const centered = t.align === "CENTER" && (dt.align === "center" || Math.abs(dxCenter) < Math.abs(dxLeft));
    const dx = centered ? dxCenter : dxLeft;
    if (Math.abs(dx) > tol.position + 1 + xSlack && kind !== "position") xCands.push({ f, d, dx, centered });
    // fixed-width text boxes (wrapping copy) should keep their width
    if (t.autoResize && t.autoResize !== "WIDTH_AND_HEIGHT" && dt.lines > 1 && Math.abs(d.w - f.w) > Math.max(tol.size, f.w * 0.04)) {
      add({
        ...base,
        rule: "width",
        severity: "low",
        title: `Text column ${px(d.w)} wide → should be ${px(f.w)}`,
        body: `Page (${where}): ${px(d.w)} wide (${dt.lines} lines)\nFigma: ${px(f.w)} wide\n\nMatch the max-width / column width so the copy wraps like the design.`,
        expected: px(f.w),
        actual: px(d.w),
      });
    }
  }

  // ── 3. images & icons ────────────────────────────────────────────────────
  const fImgs = fnodes.filter((f) => (f.image || f.icon || (/(^|\W)(image|img|photo|picture|placeholder image)(\W|$)/i.test(f.name) && (f.type === "RECTANGLE" || f.type === "FRAME"))) && f.w > 0 && f.h > 0 && f.type !== "TEXT");
  const dImgs = nodes.filter((n) => n.img && n.w > 0 && n.h > 0 && !dTaken.has(n.i));
  const dImgTaken = new Set<number>();
  const imgMatch = new Map<FNode, ImplNode>();
  for (const f of fImgs.slice().sort((a, b) => b.w * b.h - a.w * a.h)) {
    const fy = f.y + offsetAt(f.y);
    const fb = { x: f.x, y: fy, w: f.w, h: f.h };
    let best: { d: ImplNode; s: number } | null = null;
    for (const d of dImgs) {
      if (dImgTaken.has(d.i)) continue;
      const ov = iou(fb, d);
      const cd = Math.hypot(d.x + d.w / 2 - (fb.x + fb.w / 2), d.y + d.h / 2 - (fb.y + fb.h / 2));
      const small = f.w <= 64 && f.h <= 64;
      const s = small ? (cd <= 40 ? 1 - cd / 40 : 0) : ov;
      if (s <= 0.15) continue;
      if (!best || s > best.s) best = { d, s };
    }
    if (best) {
      imgMatch.set(f, best.d);
      dImgTaken.add(best.d.i);
    }
  }
  // images the browser could not load (broken src, or lazy-loading that never fired)
  for (const d of dImgs) {
    if (d.img?.kind !== "img" || d.img.natW !== 0 || d.img.pending || d.w < 24 || d.h < 24) continue;
    const src = d.img.src.replace(/^.*\//, "");
    add({
      rule: "missing-image",
      severity: "high",
      title: `Image not loading${src ? `: ${src.slice(0, 50)}` : ""}`,
      body: `Page (${d.label}): the <img> renders at ${Math.round(d.w)}×${Math.round(d.h)}px but has no pixels (naturalWidth 0)${d.img.src ? `\nsrc: …${d.img.src.slice(-80)}` : ""}\n\nCheck the file exists and the URL / CDN path is right; if it is lazy-loaded, make sure it loads once scrolled into view.`,
      expected: "a loaded image",
      actual: "empty (naturalWidth 0)",
      figmaId: "page#img:" + (d.sel || d.i),
      figmaName: "",
      dom: d.i,
      sel: d.sel,
      label: d.label,
      x: d.x,
      y: d.y,
      w: d.w,
      h: d.h,
      region: { x: d.x, y: d.y, w: d.w, h: d.h },
    });
  }
  for (const f of fImgs) {
    const d = imgMatch.get(f);
    const isIcon = f.icon || (f.w <= 64 && f.h <= 64);
    if (!d) {
      if (isIcon || f.w < 24 || f.h < 24) continue;
      const y = f.y + offsetAt(f.y);
      add({
        rule: "missing-image",
        severity: "high",
        title: `Image missing or misplaced: “${f.name}” (${Math.round(f.w)}×${Math.round(f.h)})`,
        body: `The design places an image “${f.name}” ${Math.round(f.w)}×${Math.round(f.h)}px at x ${px(f.x)}; no image renders there on the page.\n\nFix: add the image, or check its src / lazy-loading; if it is elsewhere on the page, move it to match the layout.`,
        expected: `${Math.round(f.w)}×${Math.round(f.h)} at x ${px(f.x)}`,
        actual: "not found",
        figmaId: f.id,
        figmaName: f.name,
        x: f.x,
        y,
        w: f.w,
        h: f.h,
        region: { x: f.x, y, w: f.w, h: f.h },
      });
      continue;
    }
    const base = { figmaId: f.id, figmaName: f.name, dom: d.i, sel: d.sel, label: d.label, x: d.x, y: d.y, w: d.w, h: d.h, subject: `${isIcon ? "icon" : "image"} ${Math.round(d.w)}×${Math.round(d.h)} (${d.label})` };
    const dw = d.w - f.w;
    const dh = d.h - f.h;
    if (Math.abs(dw) > Math.max(tol.size, f.w * 0.03) || Math.abs(dh) > Math.max(tol.size, f.h * 0.03)) {
      add({
        ...base,
        rule: "image-size",
        severity: Math.abs(dw) > 20 || Math.abs(dh) > 20 ? "medium" : "low",
        title: `${isIcon ? "Icon" : "Image"} ${Math.round(d.w)}×${Math.round(d.h)} → should be ${Math.round(f.w)}×${Math.round(f.h)}`,
        body: `Page (${d.label}): ${Math.round(d.w)}×${Math.round(d.h)}px${d.img?.natW ? ` (source ${d.img.natW}×${d.img.natH})` : ""}\nFigma (${f.name}): ${Math.round(f.w)}×${Math.round(f.h)}px${f.radius ? `, radius ${f.radius}px` : ""}\n\nSet width/height (or aspect-ratio) to match; check object-fit.`,
        expected: `${Math.round(f.w)}×${Math.round(f.h)}`,
        actual: `${Math.round(d.w)}×${Math.round(d.h)}`,
      });
    }
    if (!isIcon && Math.abs(d.x - f.x) > tol.position + 1 + xSlack) {
      add({
        ...base,
        rule: "image-position",
        severity: "low",
        title: `Image sits ${px(Math.abs(d.x - f.x))} too far ${d.x > f.x ? "right" : "left"}`,
        body: `Page (${d.label}): left edge at x ${px(d.x)}\nFigma (${f.name}): x ${px(f.x)}\n\nShift by ${px(f.x - d.x)}.`,
        expected: px(f.x),
        actual: px(d.x),
      });
    }
    if (f.radius != null && !isIcon && Math.abs((f.radius || 0) - d.radius) > 1.5) {
      add({
        ...base,
        rule: "radius",
        severity: "low",
        title: `Corner radius ${px(d.radius)} → should be ${px(f.radius || 0)}`,
        body: `Page (${d.label}): border-radius ${px(d.radius)}\nFigma (${f.name}): ${px(f.radius || 0)}\n\nSet border-radius: ${px(f.radius || 0)}.`,
        expected: px(f.radius || 0),
        actual: px(d.radius),
      });
    }
  }

  // ── 4. geometry between neighbours: gaps and paddings ────────────────────
  // representative boxes: union of matched descendants on both sides
  type Box = { x: number; y: number; w: number; h: number };
  const union = (boxes: Box[]): Box | null => {
    if (!boxes.length) return null;
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    const r = Math.max(...boxes.map((b) => b.x + b.w));
    const bt = Math.max(...boxes.map((b) => b.y + b.h));
    return { x, y, w: r - x, h: bt - y };
  };
  const allMatches = new Map<FNode, ImplNode>([...match, ...imgMatch]);
  const repCache = new Map<FNode, { f: Box; d: Box; n: number } | null>();
  const rep = (n: FNode): { f: Box; d: Box; n: number } | null => {
    if (repCache.has(n)) return repCache.get(n)!;
    const fb: Box[] = [];
    const db: Box[] = [];
    const walk = (m: SpecNode) => {
      const fm = byId.get(m.id);
      const dm = fm ? allMatches.get(fm) : undefined;
      if (fm && dm && (fm.type === "TEXT" ? matchKind.get(fm) !== "position" : true)) {
        fb.push({ x: fm.x, y: fm.y, w: fm.w, h: fm.h });
        db.push({ x: dm.x, y: dm.y, w: dm.w, h: dm.h });
      }
      m.children?.forEach(walk);
    };
    walk(n);
    const out = fb.length ? { f: union(fb)!, d: union(db)!, n: fb.length } : null;
    repCache.set(n, out);
    return out;
  };
  // ── 3b. horizontal shifts, once per block ────────────────────────────────
  // a line that sits too far left usually does so because its whole column
  // does: climb to the outermost ancestor shifted by the same amount and report
  // that block once
  {
    const blocks = new Map<FNode, { dx: number; items: { f: FNode; d: ImplNode }[]; centered: boolean }>();
    for (const c of xCands) {
      let top: FNode = c.f;
      for (let p = c.f.parent; p; p = p.parent) {
        const r = rep(p);
        if (!r) break;
        const pdx = c.centered ? r.d.x + r.d.w / 2 - (r.f.x + r.f.w / 2) : r.d.x - r.f.x;
        if (Math.abs(pdx - c.dx) > 2.5) break;
        // wrappers around a single element are passed through; a block needs content of its own
        if (r.n >= 2) top = p;
      }
      const cur = blocks.get(top);
      if (cur) cur.items.push({ f: c.f, d: c.d });
      else blocks.set(top, { dx: c.dx, items: [{ f: c.f, d: c.d }], centered: c.centered });
    }
    for (const [blk, b] of blocks) {
      const first = b.items[0];
      const r = rep(blk);
      const box = blk.type === "TEXT" || !r ? first.d : r.d;
      const many = b.items.length > 1 || blk !== first.f;
      const edge = b.centered ? "centre" : "left edge";
      const have = b.centered ? box.x + box.w / 2 : box.x;
      const want = have - b.dx;
      add({
        rule: "position-x",
        severity: Math.abs(b.dx) > 8 ? "medium" : "low",
        title: many ? `Block “${blk.name}” (${b.items.length} element${b.items.length === 1 ? "" : "s"}, e.g. “${shortName(first.f)}”) sits ${px(Math.abs(b.dx))} too far ${b.dx > 0 ? "right" : "left"}` : `“${shortName(blk)}” sits ${px(Math.abs(b.dx))} too far ${b.dx > 0 ? "right" : "left"}`,
        body: `Page (${first.d.label}): ${edge} at x ${px(have)}\nFigma (${blk.name}): x ${px(want)}${many ? `\nAffects ${b.items.length} element${b.items.length === 1 ? "" : "s"} in this block, e.g. ${b.items.slice(0, 4).map((i) => `“${shortName(i.f)}”`).join(", ")}` : ""}\n\nShift by ${px(-b.dx)} (check the container's width, padding or margin).`,
        expected: px(want),
        actual: px(have),
        figmaId: blk.id + "#x",
        figmaName: blk.name,
        dom: first.d.i,
        sel: first.d.sel,
        label: first.d.label,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        region: { x: box.x, y: box.y, w: box.w, h: box.h },
      });
    }
  }

  // ── 3c. space between sections ───────────────────────────────────────────
  // measured between the sections' text (a full-bleed image can run past the copy on
  // either side; the copy is what a designer measures to)
  const repText = (n: FNode): { f: Box; d: Box; n: number } | null => {
    const fb: Box[] = [];
    const db: Box[] = [];
    const walk = (m: SpecNode) => {
      const fm = byId.get(m.id);
      const dm = fm ? match.get(fm) : undefined;
      if (fm && dm && matchKind.get(fm) !== "position") {
        fb.push({ x: fm.x, y: fm.y, w: fm.w, h: fm.h });
        db.push({ x: dm.x, y: dm.y, w: dm.w, h: dm.h });
      }
      m.children?.forEach(walk);
    };
    walk(n);
    return fb.length ? { f: union(fb)!, d: union(db)!, n: fb.length } : rep(n);
  };
  // the page section = smallest ancestor spanning the section's text and the full width
  // (the outermost such ancestor that is still section-sized: the <section> with its padding, not an inner wrapper)
  const sectionBox = (s: FNode, r: { f: Box; d: Box }): ImplNode | null => {
    const anyDom = allMatches.get([...allMatches.keys()].find((k) => k.section === s.section) as FNode);
    if (!anyDom) return null;
    let best: ImplNode | null = null;
    for (let c = anyDom.i; c >= 0; c = parentOf(c)) {
      const n = nodes[c];
      if (n.h > s.h * 1.6 + 120) break;
      if (n.y <= r.d.y + 1 && n.y + n.h >= r.d.y + r.d.h - 1 && n.w >= impl.width * 0.9) best = n;
    }
    return best;
  };
  {
    const secs = fnodes.filter((f) => f.depth === 0).map((s) => ({ s, r: repText(s) })).filter((x) => x.r && x.r.n >= 2);
    // the space above and below a section's copy, against its own container
    for (const { s, r } of secs) {
      const box = sectionBox(s, r!);
      if (!box) continue;
      const checks = [
        { side: "top", want: r!.f.y - s.y, have: r!.d.y - box.y },
        { side: "bottom", want: s.y + s.h - (r!.f.y + r!.f.h), have: box.y + box.h - (r!.d.y + r!.d.h) },
      ];
      for (const c of checks) {
        if (c.want < 0 || c.have < 0 || Math.abs(c.have - c.want) <= Math.max(tol.gap, 3)) continue;
        const region = c.side === "top" ? { x: r!.d.x, y: box.y, w: r!.d.w, h: Math.max(1, c.have) } : { x: r!.d.x, y: r!.d.y + r!.d.h, w: r!.d.w, h: Math.max(1, c.have) };
        add({
          rule: "padding",
          severity: Math.abs(c.have - c.want) >= 16 ? "medium" : "low",
          title: `Section “${s.name}”: ${px(c.have)} above${c.side === "bottom" ? "/below" : ""} the content → design ${px(c.want)} (${c.side})`.replace(" above/below", " below"),
          body: `Page (${box.label}): ${px(c.have)} from the section's ${c.side} edge to its ${c.side === "top" ? "first" : "last"} text\nFigma (${s.name}): ${px(c.want)}\n\nAdjust the section's padding-${c.side} by ${px(c.want - c.have)}.`,
          expected: px(c.want),
          actual: px(c.have),
          figmaId: s.id + `#${c.side}`,
          figmaName: s.name,
          dom: box.i,
          sel: box.sel,
          label: box.label,
          x: region.x,
          y: region.y,
          w: region.w,
          h: region.h,
          region,
        });
      }
    }
    for (let i = 0; i + 1 < secs.length; i++) {
      const a = secs[i];
      const b = secs[i + 1];
      // with a container on both sides the paddings above say it; without, measure copy to copy
      if (sectionBox(a.s, a.r!) && sectionBox(b.s, b.r!)) continue;
      const fGap = b.r!.f.y - (a.r!.f.y + a.r!.f.h);
      const dGap = b.r!.d.y - (a.r!.d.y + a.r!.d.h);
      if (fGap < 0 || dGap < -20) continue;
      const delta = dGap - fGap;
      if (Math.abs(delta) <= Math.max(tol.gap, 3)) continue;
      const bd = allMatches.get([...allMatches.keys()].find((k) => k.section === b.s.section) as FNode);
      const region = { x: Math.min(a.r!.d.x, b.r!.d.x), y: a.r!.d.y + a.r!.d.h, w: Math.max(a.r!.d.w, b.r!.d.w), h: Math.max(1, dGap) };
      add({
        rule: "section-spacing",
        severity: Math.abs(delta) >= 16 ? "medium" : "low",
        title: `Space between sections “${a.s.name}” and “${b.s.name}” is ${px(dGap)} → design ${px(fGap)}`,
        body: `Page: ${px(dGap)} from the last content of “${a.s.name}” to the first content of “${b.s.name}”\nFigma: ${px(fGap)}\n\n${delta > 0 ? "Reduce" : "Increase"} the section padding / margin by ${px(Math.abs(delta))}.`,
        expected: px(fGap),
        actual: px(dGap),
        figmaId: b.s.id + "#space",
        figmaName: b.s.name,
        dom: bd?.i,
        sel: bd?.sel,
        label: bd?.label,
        x: region.x,
        y: region.y,
        w: region.w,
        h: region.h,
        region,
      });
    }
  }

  // the page element standing in for a design frame: the element itself when the
  // frame is a text / image, otherwise the lowest ancestor holding everything
  // that matched inside it
  const chain = (i: number) => {
    const out: number[] = [];
    for (let c = i; c >= 0; c = parentOf(c)) out.push(c);
    return out;
  };
  const lcaOf = (idx: number[]): number | null => {
    if (!idx.length) return null;
    const first = chain(idx[0]);
    const chains = idx.slice(1).map((j) => new Set(chain(j)));
    for (const c of first) if (chains.every((cs) => cs.has(c))) return c;
    return null;
  };
  const pageBoxCache = new Map<FNode, ImplNode | null>();
  const pageBox = (k: FNode): ImplNode | null => {
    if (pageBoxCache.has(k)) return pageBoxCache.get(k)!;
    let out: ImplNode | null = null;
    const own = allMatches.get(k);
    if (own && (k.type !== "TEXT" || matchKind.get(k) !== "position")) out = own;
    else {
      const idx: number[] = [];
      const walk = (m: SpecNode) => {
        const fm = byId.get(m.id);
        const dm = fm ? allMatches.get(fm) : undefined;
        if (fm && dm && (fm.type === "TEXT" ? matchKind.get(fm) !== "position" : true)) idx.push(dm.i);
        m.children?.forEach(walk);
      };
      walk(k);
      // a frame that matched through one element alone has no container of its own on the page
      const l = idx.length >= 2 ? lcaOf(idx) : null;
      out = l == null ? null : nodes[l];
    }
    pageBoxCache.set(k, out);
    return out;
  };
  const isAncestor = (a: number, b: number) => a !== b && chain(b).includes(a);

  for (const f of fnodes) {
    if (!f.children) continue;
    let kids = f.children.filter((c) => c.v !== false && !/^filler$/i.test(c.name) && c.w > 0 && c.h > 0).map((c) => byId.get(c.id)!).filter(Boolean);
    if (kids.length < 2) continue;
    let horizontal: boolean;
    if (f.layout) horizontal = f.layout.mode === "HORIZONTAL";
    else {
      // a free-form frame whose children still sit in a row or a column is measured the same way
      const byY = kids.slice().sort((a, b) => a.y - b.y);
      const byX = kids.slice().sort((a, b) => a.x - b.x);
      const stacked = byY.every((k, i) => i === 0 || k.y >= byY[i - 1].y + byY[i - 1].h - 2);
      const rowed = byX.every((k, i) => i === 0 || k.x >= byX[i - 1].x + byX[i - 1].w - 2);
      if (stacked) {
        horizontal = false;
        kids = byY;
      } else if (rowed) {
        horizontal = true;
        kids = byX;
      } else continue;
    }
    const reps = kids.map((k) => ({ k, r: rep(k) })).filter((x) => x.r);
    for (let i = 0; i + 1 < reps.length; i++) {
      const a = reps[i];
      const b = reps[i + 1];
      // measure from a frame's box to the page container standing in for it (what a
      // designer measures) where the page has one; from the content otherwise
      const sane = (p: ImplNode, k: FNode) => p.w <= k.w * 1.5 + 40 && p.h <= k.h * 1.5 + 40;
      let pa = pageBox(a.k);
      let pb = pageBox(b.k);
      if (pa && !sane(pa, a.k)) pa = null;
      if (pb && !sane(pb, b.k)) pb = null;
      // the container only stands in for the frame when it hugs its content the same way
      // on the edge being measured (a page box with trailing space inside is not the frame)
      const hugs = (p: ImplNode, k: FNode, r: { f: Box; d: Box }, edge: "right" | "bottom" | "left" | "top") => {
        const fi = edge === "right" ? k.x + k.w - (r.f.x + r.f.w) : edge === "bottom" ? k.y + k.h - (r.f.y + r.f.h) : edge === "left" ? r.f.x - k.x : r.f.y - k.y;
        const di = edge === "right" ? p.x + p.w - (r.d.x + r.d.w) : edge === "bottom" ? p.y + p.h - (r.d.y + r.d.h) : edge === "left" ? r.d.x - p.x : r.d.y - p.y;
        return Math.abs(fi - di) <= 4;
      };
      if (pa && !hugs(pa, a.k, a.r!, horizontal ? "right" : "bottom")) pa = null;
      if (pb && !hugs(pb, b.k, b.r!, horizontal ? "left" : "top")) pb = null;
      if (pa && pb && (pa.i === pb.i || isAncestor(pa.i, pb.i) || isAncestor(pb.i, pa.i))) pa = pb = null;
      const fa: Box = pa ? a.k : a.r!.f;
      const da: Box = pa ?? a.r!.d;
      const fb: Box = pb ? b.k : b.r!.f;
      const db: Box = pb ?? b.r!.d;
      const fGap = horizontal ? fb.x - (fa.x + fa.w) : fb.y - (fa.y + fa.h);
      const dGap = horizontal ? db.x - (da.x + da.w) : db.y - (da.y + da.h);
      if (opts.debugGap && opts.debugGap.test(f.name)) console.error("GAP", f.name, "|", a.k.name, pa ? `page#${pa.i}` : "rep", JSON.stringify(da), "|", b.k.name, pb ? `page#${pb.i}` : "rep", JSON.stringify(db), "| f", fGap, "d", dGap);
      if (fGap < -1 || dGap < -60) continue; // overlapping / different structure
      const delta = dGap - fGap;
      if (Math.abs(delta) <= tol.gap) continue;
      // wrapped rows (children broke onto another line) are structural, not spacing
      if (horizontal && Math.abs(db.y - da.y) > Math.max(da.h, db.h)) continue;
      const nameA = shortName(a.k);
      const nameB = shortName(b.k);
      const region = horizontal ? { x: da.x + da.w, y: Math.min(da.y, db.y), w: Math.max(1, dGap), h: Math.max(da.h, db.h) } : { x: Math.min(da.x, db.x), y: da.y + da.h, w: Math.max(da.w, db.w), h: Math.max(1, dGap) };
      const domB = allMatches.get(b.k) ?? [...allMatches.entries()].find(([k]) => k.parent === b.k || k.parent?.parent === b.k)?.[1];
      add({
        rule: "gap",
        severity: Math.abs(delta) >= 8 ? "medium" : "low",
        title: `${horizontal ? "Horizontal" : "Vertical"} gap ${px(dGap)} → should be ${px(fGap)} (between “${nameA}” and “${nameB}”)`,
        body: `Page: ${px(dGap)} between “${nameA}” and “${nameB}”\nFigma (${f.name}${f.layout?.gap ? `, gap ${f.layout.gap}px` : ""}): ${px(fGap)}\n\n${delta > 0 ? "Reduce" : "Increase"} the spacing by ${px(Math.abs(delta))} (margin / gap / padding on the ${horizontal ? "row" : "stack"}).`,
        expected: px(fGap),
        actual: px(dGap),
        figmaId: f.id + (i ? `#${i}` : ""),
        figmaName: f.name,
        dom: domB?.i,
        sel: domB?.sel,
        label: domB?.label,
        x: region.x,
        y: region.y,
        w: region.w,
        h: region.h,
        region,
      });
    }
    // paddings: figma frame edge → first/last child, compared with the page container that holds the same children
    const r = rep(f);
    if (!r || r.n < 2) continue;
    const domIdx = kids.flatMap((k) => {
      const dm = allMatches.get(k);
      return dm ? [dm.i] : [];
    });
    if (domIdx.length < 2) continue;
    // lowest common ancestor on the page
    const lca = lcaOf(domIdx);
    if (lca == null) continue;
    const box = nodes[lca];
    // only when the container corresponds in width to the frame
    if (Math.abs(box.w - f.w) > Math.max(12, f.w * 0.05)) continue;
    // left and top edges are dependable; right/bottom depend on how far content runs, which
    // the page decides (block widths, real copy) — only when the content boxes agree in size
    const checks: { side: "left" | "right" | "top" | "bottom"; want: number; have: number }[] = [{ side: "left", want: r.f.x - f.x, have: r.d.x - box.x }];
    if (Math.abs(r.f.w - r.d.w) <= 4) checks.push({ side: "right", want: f.x + f.w - (r.f.x + r.f.w), have: box.x + box.w - (r.d.x + r.d.w) });
    if (Math.abs(box.h - f.h) <= Math.max(12, f.h * 0.05)) {
      checks.push({ side: "top", want: r.f.y - f.y, have: r.d.y - box.y });
      if (Math.abs(r.f.h - r.d.h) <= 4) checks.push({ side: "bottom", want: f.y + f.h - (r.f.y + r.f.h), have: box.y + box.h - (r.d.y + r.d.h) });
    }
    for (const c of checks) {
      if (Math.abs(c.have - c.want) <= tol.gap + 1) continue;
      add({
        rule: "padding",
        severity: Math.abs(c.have - c.want) >= 8 ? "medium" : "low",
        title: `${c.side[0].toUpperCase() + c.side.slice(1)} inset ${px(c.have)} → should be ${px(c.want)} in “${f.name}”`,
        body: `Page (${box.label}): ${px(c.have)} from the container's ${c.side} edge to its content\nFigma (${f.name}): ${px(c.want)}\n\nAdjust padding-${c.side} (or the child's margin) by ${px(c.want - c.have)}.`,
        expected: px(c.want),
        actual: px(c.have),
        figmaId: f.id + `#${c.side}`,
        figmaName: f.name,
        dom: lca,
        sel: box.sel,
        label: box.label,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        region: c.side === "left" ? { x: box.x, y: r.d.y, w: Math.max(1, c.have), h: r.d.h } : c.side === "right" ? { x: r.d.x + r.d.w, y: r.d.y, w: Math.max(1, c.have), h: r.d.h } : c.side === "top" ? { x: r.d.x, y: box.y, w: r.d.w, h: Math.max(1, c.have) } : { x: r.d.x, y: r.d.y + r.d.h, w: r.d.w, h: Math.max(1, c.have) },
      });
    }
  }

  // ── 5. sections: height & background ─────────────────────────────────────
  for (const s of fnodes.filter((f) => f.depth === 0)) {
    const r = repText(s);
    if (!r || r.n < 2) continue;
    const node = sectionBox(s, r);
    if (!node) continue;
    if (Math.abs(node.h - s.h) > Math.max(8, s.h * 0.03) && s.h > 100) {
      add({
        rule: "section-height",
        severity: "low",
        title: `Section “${s.name}” is ${px(node.h)} tall → design ${px(s.h)}`,
        body: `Page (${node.label}): ${px(node.h)} tall\nFigma (${s.name}): ${px(s.h)}\n\nUsually a result of the spacing / padding differences listed for this section; content height can differ with real copy.`,
        expected: px(s.h),
        actual: px(node.h),
        figmaId: s.id + "#h",
        figmaName: s.name,
        dom: node.i,
        sel: node.sel,
        label: node.label,
        x: node.x,
        y: node.y,
        w: node.w,
        h: node.h,
      });
    }
    const want = s.fill && s.fill.toLowerCase() !== "#ffffff" ? s.fill : null;
    let have: string | null = null;
    for (let c = node.i; c >= 0; c = parentOf(c)) {
      if (nodes[c].bg) {
        have = nodes[c].bg!;
        break;
      }
    }
    if (want && !colorClose(want, have ?? "#ffffff")) {
      add({
        rule: "background",
        severity: "medium",
        title: `Section background ${have ?? "#ffffff"} → should be ${want}`,
        body: `Page (${node.label}): background ${have ?? "none (white)"}\nFigma (${s.name}): ${want}\n\nSet background-color: ${want}.`,
        expected: want,
        actual: have ?? "#ffffff",
        figmaId: s.id + "#bg",
        figmaName: s.name,
        dom: node.i,
        sel: node.sel,
        label: node.label,
        x: node.x,
        y: node.y,
        w: node.w,
        h: node.h,
      });
    }
  }

  // ── 6. buttons: box, fill, border, radius ────────────────────────────────
  for (const f of fnodes.filter((n) => /button/i.test(n.name) || /button/i.test(n.comp ?? "")).filter((n) => n.type === "INSTANCE" || n.type === "FRAME")) {
    const textChild = fnodes.find((t) => t.type === "TEXT" && match.has(t) && isInside(t, f));
    if (!textChild) continue;
    const dText = match.get(textChild)!;
    let ctl: ImplNode | null = null;
    for (let c = dText.i, k = 0; c >= 0 && k < 4; c = parentOf(c), k++) {
      if (nodes[c].ctl || nodes[c].bg || nodes[c].border) {
        ctl = nodes[c];
        break;
      }
    }
    if (!ctl) continue;
    const base = { figmaId: f.id, figmaName: f.name, dom: ctl.i, sel: ctl.sel, label: ctl.label, x: ctl.x, y: ctl.y, w: ctl.w, h: ctl.h };
    // a text link's box is its type: the font-size / line-height findings already cover it
    const textOnly = !f.fill && !f.stroke && !ctl.bg && !ctl.border;
    if (!textOnly && (Math.abs(ctl.w - f.w) > 2 || Math.abs(ctl.h - f.h) > 2)) {
      add({
        ...base,
        rule: "height",
        severity: "medium",
        title: `Button ${Math.round(ctl.w)}×${Math.round(ctl.h)} → should be ${Math.round(f.w)}×${Math.round(f.h)}`,
        body: `Page (${ctl.label}): ${Math.round(ctl.w)}×${Math.round(ctl.h)}px\nFigma (${f.name}): ${Math.round(f.w)}×${Math.round(f.h)}px${f.layout ? ` (padding ${f.layout.pt}/${f.layout.pr}/${f.layout.pb}/${f.layout.pl})` : ""}\n\nMatch the width / height (padding + line-height).`,
        expected: `${Math.round(f.w)}×${Math.round(f.h)}`,
        actual: `${Math.round(ctl.w)}×${Math.round(ctl.h)}`,
      });
    }
    if (f.fill && !colorClose(f.fill, ctl.bg ?? "#ffffff")) {
      add({
        ...base,
        rule: "background",
        severity: "medium",
        title: `Button background ${ctl.bg ?? "none"} → should be ${f.fill}`,
        body: `Page (${ctl.label}): background ${ctl.bg ?? "none"}\nFigma (${f.name}): ${f.fill}\n\nSet background-color: ${f.fill}.`,
        expected: f.fill,
        actual: ctl.bg ?? "none",
      });
    }
    if (f.stroke && (!ctl.border || !colorClose(f.stroke.hex, ctl.border.color) || Math.abs(ctl.border.w - f.stroke.w) > 0.5)) {
      add({
        ...base,
        rule: "border",
        severity: "low",
        title: `Button border → ${f.stroke.w}px ${f.stroke.hex}`,
        body: `Page (${ctl.label}): border ${ctl.border ? `${px(ctl.border.w)} ${ctl.border.color}` : "none"}\nFigma (${f.name}): ${f.stroke.w}px ${f.stroke.hex}\n\nSet border: ${f.stroke.w}px solid ${f.stroke.hex}.`,
        expected: `${f.stroke.w}px ${f.stroke.hex}`,
        actual: ctl.border ? `${px(ctl.border.w)} ${ctl.border.color}` : "none",
      });
    }
    if (f.radius != null && Math.abs((f.radius || 0) - ctl.radius) > 1.5) {
      add({
        ...base,
        rule: "radius",
        severity: "low",
        title: `Button radius ${px(ctl.radius)} → should be ${px(f.radius || 0)}`,
        body: `Page (${ctl.label}): border-radius ${px(ctl.radius)}\nFigma (${f.name}): ${px(f.radius || 0)}\n\nSet border-radius: ${px(f.radius || 0)}.`,
        expected: px(f.radius || 0),
        actual: px(ctl.radius),
      });
    }
  }

  // ── 6b. one term, several spellings ──────────────────────────────────────
  // "Hearts & Arrows" here, "Heart & Arrow" there: the same name should read the
  // same everywhere on the page
  {
    const variants = new Map<string, Map<string, ImplNode[]>>();
    const singular = (w: string) => w.replace(/(ies)$/i, "y").replace(/(s)$/i, "");
    for (const d of dtexts) {
      const text = norm(d.text!.chars);
      for (const m of text.matchAll(/\b([A-Z][a-z]+(?:s)?)\s*&\s*([A-Z][a-z]+(?:s)?)\b/g)) {
        const raw = `${m[1]} & ${m[2]}`;
        const k = `${singular(m[1])} & ${singular(m[2])}`.toLowerCase();
        if (!variants.has(k)) variants.set(k, new Map());
        const v = variants.get(k)!;
        if (!v.has(raw)) v.set(raw, []);
        v.get(raw)!.push(d);
      }
    }
    for (const [k, v] of variants) {
      if (v.size < 2) continue;
      const list = [...v.entries()].sort((a, b) => b[1].length - a[1].length);
      const first = list[0][1][0];
      const inDesign = new Set(ftexts.map((f) => norm(f.text!.chars)).filter((t) => list.some(([raw]) => t.includes(raw))).flatMap((t) => list.filter(([raw]) => t.includes(raw)).map(([raw]) => raw)));
      add({
        rule: "copy",
        severity: "low",
        title: `“${k.replace(/\b\w/g, (c) => c.toUpperCase())}” is spelt ${v.size} ways on the page: ${list.map(([raw, ds]) => `“${raw}” (×${ds.length})`).join(", ")}`,
        body: `The same term appears as:\n${list.map(([raw, ds]) => `• “${raw}” — ${ds.length}× e.g. “${norm(ds[0].text!.chars).slice(0, 60)}” (${ds[0].label})`).join("\n")}\n\nPick one spelling and use it everywhere.${inDesign.size > 1 ? " The design itself mixes them — agree the spelling with the designer." : inDesign.size === 1 ? ` The design uses “${[...inDesign][0]}”.` : ""}`,
        expected: inDesign.size === 1 ? [...inDesign][0] : "one spelling",
        actual: list.map(([raw]) => raw).join(" / "),
        figmaId: spec.id + "#term:" + k,
        figmaName: spec.name,
        dom: first.i,
        sel: first.sel,
        label: first.label,
        x: first.x,
        y: first.y,
        w: first.w,
        h: first.h,
      });
    }
  }

  // ── 7. text on the page that the design does not have ────────────────────
  const extras = dtexts.filter((d) => !dTaken.has(d.i) && key(d.text!.chars).length >= 12 && d.y < (spec.h + 200) * 1.2);
  if (extras.length) {
    const list = extras.slice(0, 10).map((d) => `• “${norm(d.text!.chars).slice(0, 70)}” (${d.label})`).join("\n");
    const first = extras[0];
    add({
      rule: "extra-text",
      severity: "low",
      title: `${extras.length} text element${extras.length === 1 ? "" : "s"} on the page not in the design`,
      body: `These texts render on the page but have no counterpart in the Figma frame (often CMS content or a newer copy deck — verify they are intended):\n${list}${extras.length > 10 ? `\n…and ${extras.length - 10} more` : ""}`,
      expected: "—",
      actual: `${extras.length} extra`,
      figmaId: spec.id + "#extra",
      figmaName: spec.name,
      dom: first.i,
      sel: first.sel,
      label: first.label,
      x: first.x,
      y: first.y,
      w: first.w,
      h: first.h,
    });
  }

  // an x offset that a horizontal gap error to its left already explains is not a second finding
  const hgaps = findings.filter((f) => f.rule === "gap" && f.region && f.region.w > 0 && f.region.h > 0 && /^Horizontal/.test(f.title));
  const explained = (f: Finding): boolean => {
    if (f.rule !== "position-x" && f.rule !== "image-position") return false;
    const dx = parseFloat(f.actual) - parseFloat(f.expected);
    return hgaps.some((g) => {
      const gd = parseFloat(g.actual) - parseFloat(g.expected);
      const bandOverlap = Math.min(f.y + f.h, g.region!.y + g.region!.h) - Math.max(f.y, g.region!.y);
      return g.region!.x <= f.x && bandOverlap > 0 && Math.abs(gd - dx) <= 1.5;
    });
  };
  const kept = findings.filter((f) => !explained(f));
  const order: Record<Finding["severity"], number> = { high: 0, medium: 1, low: 2 };
  const sorted = kept.sort((a, b) => a.y - b.y || order[a.severity] - order[b.severity]);
  const sectionOf = (f: Finding) => byId.get(f.figmaId.replace(/#.*$/, ""))?.section ?? -1;
  return (opts.group === false ? sorted : groupFindings(sorted, sectionOf)).slice(0, limit);
}

const GROUPABLE = new Set<Rule>(["font-size", "font-weight", "font-family", "line-height", "letter-spacing", "text-color", "text-transform", "text-decoration", "text-align", "copy-case", "image-size", "image-position", "height", "gap", "width", "radius", "border"]);

/**
 * The same deviation on many elements of a section is one thing to fix —
 * one finding, pinned to the first element, listing the others.
 */
function groupFindings(findings: Finding[], sectionOf: (f: Finding) => number): Finding[] {
  const groups = new Map<string, Finding[]>();
  const out: (Finding | null)[] = [];
  for (const f of findings) {
    if (!GROUPABLE.has(f.rule)) {
      out.push(f);
      continue;
    }
    const k = `${f.rule}|${f.expected}|${f.actual}|${sectionOf(f)}`;
    const g = groups.get(k);
    if (g) {
      g.push(f);
      out.push(null);
    } else {
      groups.set(k, [f]);
      out.push(f);
    }
  }
  const merged = new Map<Finding, Finding>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const first = g[0];
    const others = g.slice(1);
    const where = (f: Finding) => `• ${f.subject ?? f.label ?? f.figmaName}${f.subject && f.label ? ` (${f.label})` : ""}`;
    merged.set(first, {
      ...first,
      title: `${first.title} (×${g.length})`,
      body: `${first.body}\n\nThe same on ${others.length} more element${others.length === 1 ? "" : "s"} in this section:\n${others.slice(0, 12).map(where).join("\n")}${others.length > 12 ? `\n…and ${others.length - 12} more` : ""}`,
      fingerprint: `${first.rule}|${first.expected}|${first.actual}|s${sectionOf(first)}|${g.length}`,
    });
  }
  return out.filter((f): f is Finding => !!f).map((f) => merged.get(f) ?? f);
}

function isInside(t: FNode, f: FNode): boolean {
  for (let p: FNode | null = t; p; p = p.parent) if (p === f) return true;
  return false;
}

/** How the run went, for the toast and the report comment. */
export function summarize(findings: Finding[]): string {
  const by = new Map<string, number>();
  for (const f of findings) by.set(f.rule, (by.get(f.rule) || 0) + 1);
  return [...by.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([r, n]) => `${n} ${r}`)
    .join(", ");
}
