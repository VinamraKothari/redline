import type { Comment } from "@/lib/types";

/** Developer comments are the ones "Compare with Figma" writes: no author, a fixed name and colour. */
export const DEV_AUTHOR = "Figma compare";
export const DEV_COLOR = "#7c3aed";

export function isDevComment(c: Pick<Comment, "author_id" | "anchor" | "author_name">): boolean {
  return c.author_id === null && (Boolean(c.anchor?.dev) || c.author_name === DEV_AUTHOR);
}
