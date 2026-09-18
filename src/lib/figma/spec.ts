/**
 * A compact, renderer-independent description of a Figma frame — what the
 * comparison engine consumes. Produced from the Figma REST API (`fromRest`)
 * or from a Plugin-API export with the same shape.
 *
 * Coordinates are in px relative to the root frame's top-left corner, which
 * is also how the page is laid out at the same viewport width.
 */

export interface SpecText {
  chars: string;
  family?: string;
  style?: string;
  weight?: number;
  size?: number;
  /** "auto", px number, or "140%" */
  lineHeight?: string | number | null;
  /** px number or "2%" */
  letterSpacing?: string | number | null;
  align?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  case?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE" | "SMALL_CAPS" | "SMALL_CAPS_FORCED" | "MIXED";
  decoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH" | "MIXED";
  color?: string;
  autoResize?: string;
  /** when the node mixes styles: one entry per run */
  segments?: { chars: string; family?: string; style?: string; weight?: number; size?: number; color?: string; case?: string; decoration?: string }[];
}

export interface SpecLayout {
  mode: "HORIZONTAL" | "VERTICAL";
  gap: number;
  pt: number;
  pr: number;
  pb: number;
  pl: number;
  primary?: string;
  counter?: string;
  wrap?: boolean;
}

export interface SpecNode {
  id: string;
  name: string;
  type: string;
  /** visible (Figma "v") */
  v?: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  op?: number;
  text?: SpecText;
  layout?: SpecLayout;
  fill?: string;
  fillA?: number;
  image?: boolean;
  radius?: number;
  stroke?: { hex: string; w: number };
  comp?: string;
  /** a vector-only subtree collapsed into one node (an icon) */
  icon?: boolean;
  shape?: boolean;
  children?: SpecNode[];
}

export interface FigmaSpec {
  id: string;
  name: string;
  w: number;
  h: number;
  fill?: string;
  sections: SpecNode[];
}

/* ── REST → spec ─────────────────────────────────────────────────────────── */

type RestPaint = { type: string; visible?: boolean; opacity?: number; color?: { r: number; g: number; b: number; a?: number } };
interface RestNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  fills?: RestPaint[];
  strokes?: RestPaint[];
  strokeWeight?: number;
  cornerRadius?: number;
  characters?: string;
  style?: {
    fontFamily?: string;
    fontPostScriptName?: string | null;
    fontWeight?: number;
    fontSize?: number;
    textAlignHorizontal?: string;
    letterSpacing?: number;
    lineHeightPx?: number;
    lineHeightPercentFontSize?: number;
    lineHeightUnit?: string;
    textCase?: string;
    textDecoration?: string;
    textAutoResize?: string;
    italic?: boolean;
  };
  characterStyleOverrides?: number[];
  styleOverrideTable?: Record<string, RestNode["style"] & { fills?: RestPaint[] }>;
  layoutMode?: string;
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  layoutWrap?: string;
  componentId?: string;
  children?: RestNode[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const hex = (c: { r: number; g: number; b: number }) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
function solid(paints?: RestPaint[]) {
  const p = paints?.find((p) => p.visible !== false && p.type === "SOLID" && p.color);
  return p ? { hex: hex(p.color!), a: r2((p.opacity ?? 1) * (p.color!.a ?? 1)) } : null;
}
const hasImage = (paints?: RestPaint[]) => !!paints?.some((p) => p.visible !== false && p.type === "IMAGE");
const ICONISH = new Set(["VECTOR", "BOOLEAN_OPERATION", "ELLIPSE", "LINE", "STAR", "POLYGON", "GROUP", "RECTANGLE", "REGULAR_POLYGON"]);
const SHAPES = new Set(["VECTOR", "BOOLEAN_OPERATION", "LINE", "STAR", "POLYGON", "REGULAR_POLYGON"]);

function styleToText(chars: string, st: NonNullable<RestNode["style"]>, fills?: RestPaint[]): SpecText {
  const t: SpecText = { chars };
  if (st.fontFamily) t.family = st.fontFamily;
  if (st.fontPostScriptName) t.style = st.fontPostScriptName.split("-")[1] || undefined;
  if (st.fontWeight) t.weight = st.fontWeight;
  if (st.fontSize) t.size = r2(st.fontSize);
  if (st.lineHeightUnit === "INTRINSIC_%" || st.lineHeightUnit === "AUTO") t.lineHeight = "auto";
  else if (st.lineHeightUnit === "FONT_SIZE_%" && st.lineHeightPercentFontSize != null) t.lineHeight = `${r2(st.lineHeightPercentFontSize)}%`;
  else if (st.lineHeightPx != null) t.lineHeight = r2(st.lineHeightPx);
  if (st.letterSpacing != null) t.letterSpacing = r2(st.letterSpacing);
  t.align = st.textAlignHorizontal as SpecText["align"];
  t.case = (st.textCase as SpecText["case"]) || "ORIGINAL";
  t.decoration = (st.textDecoration as SpecText["decoration"]) || "NONE";
  const f = solid(fills);
  if (f) t.color = f.hex;
  t.autoResize = st.textAutoResize;
  return t;
}

function isIconTree(n: RestNode): boolean {
  if (!n.children?.length) return false;
  const bb = n.absoluteBoundingBox;
  if (!bb || bb.width > 120 || bb.height > 120) return false;
  let count = 0;
  const walk = (m: RestNode): boolean => {
    count++;
    if (m.type === "TEXT" || !ICONISH.has(m.type) && m !== n && m.type !== "FRAME" && m.type !== "INSTANCE") return false;
    if (m !== n && (m.type === "FRAME" || m.type === "INSTANCE")) return false;
    return (m.children ?? []).every(walk);
  };
  return walk(n) && count <= 60;
}

function convert(n: RestNode, ox: number, oy: number): SpecNode {
  const bb = n.absoluteBoundingBox;
  const o: SpecNode = { id: n.id, name: n.name, type: n.type, v: n.visible !== false, x: 0, y: 0, w: 0, h: 0 };
  if (bb) {
    o.x = r2(bb.x - ox);
    o.y = r2(bb.y - oy);
    o.w = r2(bb.width);
    o.h = r2(bb.height);
  }
  if (n.opacity != null && n.opacity !== 1) o.op = r2(n.opacity);
  if (n.type === "TEXT" && n.style) {
    o.text = styleToText(n.characters ?? "", n.style, n.fills);
    // mixed runs: rebuild segments from the override table
    const ov = n.characterStyleOverrides;
    if (ov?.length && n.styleOverrideTable) {
      const chars = n.characters ?? "";
      const segs: NonNullable<SpecText["segments"]> = [];
      let cur = -1;
      let buf = "";
      const flush = () => {
        if (!buf) return;
        const st = cur === 0 ? n.style! : { ...n.style!, ...(n.styleOverrideTable![String(cur)] ?? {}) };
        const fills = cur === 0 ? n.fills : (n.styleOverrideTable![String(cur)]?.fills ?? n.fills);
        const tt = styleToText(buf, st, fills);
        segs.push({ chars: buf, family: tt.family, style: tt.style, weight: tt.weight, size: tt.size, color: tt.color, case: tt.case, decoration: tt.decoration });
        buf = "";
      };
      for (let i = 0; i < chars.length; i++) {
        const k = ov[i] ?? 0;
        if (k !== cur) {
          flush();
          cur = k;
        }
        buf += chars[i];
      }
      flush();
      if (segs.length > 1) {
        o.text.segments = segs;
        // the base style is whatever the largest run uses
        const main = segs.slice().sort((a, b) => b.chars.length - a.chars.length)[0];
        if (main.size) o.text.size = main.size;
        if (main.weight) o.text.weight = main.weight;
        if (main.family) o.text.family = main.family;
      }
    }
  }
  if (n.layoutMode && n.layoutMode !== "NONE") {
    o.layout = {
      mode: n.layoutMode as SpecLayout["mode"],
      gap: r2(n.itemSpacing ?? 0),
      pt: r2(n.paddingTop ?? 0),
      pr: r2(n.paddingRight ?? 0),
      pb: r2(n.paddingBottom ?? 0),
      pl: r2(n.paddingLeft ?? 0),
      primary: n.primaryAxisAlignItems ?? "MIN",
      counter: n.counterAxisAlignItems ?? "MIN",
      wrap: n.layoutWrap === "WRAP",
    };
  }
  if (n.type !== "TEXT") {
    const f = solid(n.fills);
    if (f) {
      o.fill = f.hex;
      if (f.a !== 1) o.fillA = f.a;
    }
    if (hasImage(n.fills)) o.image = true;
  }
  if (n.cornerRadius) o.radius = r2(n.cornerRadius);
  const s = solid(n.strokes);
  if (s && n.strokeWeight) o.stroke = { hex: s.hex, w: r2(n.strokeWeight) };
  if (n.type === "INSTANCE" && n.componentId) o.comp = n.componentId;
  if (SHAPES.has(n.type)) {
    o.shape = true;
    return o;
  }
  if (isIconTree(n)) {
    o.icon = true;
    return o;
  }
  if (n.children?.length) o.children = n.children.map((c) => convert(c, ox, oy));
  return o;
}

/** Build a spec from the Figma REST `GET /v1/files/:key/nodes?ids=` response for one node. */
export function fromRest(document: RestNode): FigmaSpec {
  const bb = document.absoluteBoundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
  const rootFill = solid(document.fills);
  return {
    id: document.id,
    name: document.name,
    w: r2(bb.width),
    h: r2(bb.height),
    fill: rootFill?.hex,
    sections: (document.children ?? []).map((c) => convert(c, bb.x, bb.y)),
  };
}

/** Parse a Figma design URL into its file key and node id ("12:34"). */
export function parseFigmaUrl(url: string): { fileKey: string; nodeId: string | null } | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)figma\.com$/.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/(?:design|file|proto)\/([0-9A-Za-z]{10,128})(?:\/branch\/([0-9A-Za-z]{10,128}))?/);
  if (!m) return null;
  const fileKey = m[2] || m[1];
  const raw = u.searchParams.get("node-id");
  const nodeId = raw ? raw.replace(/-/g, ":") : null;
  return { fileKey, nodeId };
}
