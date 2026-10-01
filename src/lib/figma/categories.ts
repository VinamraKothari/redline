import type { Rule } from "./compare";

/**
 * What a "Compare with Figma" comment is about, in the words a reader uses —
 * the categories of the settings panel and the small label on each developer
 * comment. Every rule the engine can produce maps to exactly one category.
 */
export type DevCategoryId = "copy" | "case" | "missing-text" | "typography" | "spacing" | "position" | "text-width" | "images" | "buttons" | "sections";

export interface DevCategory {
  id: DevCategoryId;
  label: string;
  /** one line for the settings panel */
  description: string;
  rules: Rule[];
}

export const DEV_CATEGORIES: DevCategory[] = [
  { id: "copy", label: "Copy", description: "Wording that differs from the design: typos, changed words, placeholders, split paragraphs, a term spelt two ways.", rules: ["copy"] },
  { id: "case", label: "Capitalisation & punctuation", description: "Only the letter case or the end of the sentence differs.", rules: ["copy-case", "copy-punctuation"] },
  { id: "missing-text", label: "Missing & extra text", description: "Text from the design that doesn't render, and text on the page the design doesn't have.", rules: ["missing-text", "extra-text"] },
  { id: "typography", label: "Typography", description: "Font size, weight, family, line height, letter spacing, text colour, case, underline and alignment.", rules: ["text-style", "font-size", "font-weight", "font-family", "line-height", "letter-spacing", "text-color", "text-transform", "text-decoration", "text-align"] },
  { id: "spacing", label: "Spacing", description: "Space between neighbours, section paddings, the padding inside a block, space between sections.", rules: ["gap", "padding", "section-spacing"] },
  { id: "position", label: "Position", description: "An element or block that starts further left or right than in the design.", rules: ["position-x"] },
  { id: "text-width", label: "Text width", description: "A paragraph that wraps at a different width, so its lines break differently.", rules: ["width"] },
  { id: "images", label: "Images & icons", description: "Wrong size or place, missing images, images that don't load, corner radius.", rules: ["image-size", "image-position", "missing-image", "radius"] },
  { id: "buttons", label: "Buttons", description: "Button size, background, border.", rules: ["height", "border"] },
  { id: "sections", label: "Section size & background", description: "A section's height and background colour.", rules: ["section-height", "background"] },
];

export const DEV_CATEGORY_IDS: DevCategoryId[] = DEV_CATEGORIES.map((c) => c.id);

const BY_RULE = new Map<string, DevCategory>();
for (const c of DEV_CATEGORIES) for (const r of c.rules) BY_RULE.set(r, c);

/** The category of a developer comment, from `anchor.dev.rule`. Unknown rules count as "spacing" (the largest bucket). */
export function categoryOf(rule: string | undefined | null): DevCategory {
  return (rule && BY_RULE.get(rule)) || DEV_CATEGORIES[4];
}

export type DevSeverity = "high" | "medium" | "low";
export const DEV_SEVERITIES: { id: DevSeverity; label: string; description: string }[] = [
  { id: "high", label: "High", description: "Missing pieces, wrong copy, wrong font family, images that don't load." },
  { id: "medium", label: "Medium", description: "Wrong size, weight or colour; spacing off by 8px or more." },
  { id: "low", label: "Low", description: "Line height, letter spacing, capitalisation, small spacing and size slips." },
];
