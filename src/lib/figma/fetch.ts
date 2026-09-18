import { fromRest, type FigmaSpec } from "./spec";

/**
 * Reads one node of a Figma file through the REST API. Needs a personal
 * access token in FIGMA_TOKEN (Figma → Settings → Security → Personal access
 * tokens; read-only "File content" scope is enough). FIGMA_API_BASE lets
 * tests point at a fixture server.
 */
export function figmaConfigured(): boolean {
  return Boolean(process.env.FIGMA_TOKEN);
}

export class FigmaError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function fetchFigmaSpec(fileKey: string, nodeId: string): Promise<FigmaSpec> {
  const token = process.env.FIGMA_TOKEN;
  if (!token) throw new FigmaError(501, "Figma is not connected on this server: set FIGMA_TOKEN (a Figma personal access token) in the hosting environment.");
  const base = (process.env.FIGMA_API_BASE || "https://api.figma.com").replace(/\/$/, "");
  const url = `${base}/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}`;
  const res = await fetch(url, { headers: { "X-Figma-Token": token }, cache: "no-store" });
  if (res.status === 403) throw new FigmaError(403, "Figma refused the request — the token is invalid, or the account it belongs to cannot open this file.");
  if (res.status === 404) throw new FigmaError(404, "Figma could not find that file or frame — check the link (it needs the node-id of the page frame).");
  if (res.status === 429) throw new FigmaError(429, "Figma is rate-limiting requests — try again in a minute.");
  if (!res.ok) throw new FigmaError(502, `Figma answered ${res.status}.`);
  const data = (await res.json()) as { nodes?: Record<string, { document?: Parameters<typeof fromRest>[0] } | null> };
  const entry = data.nodes?.[nodeId] ?? Object.values(data.nodes ?? {})[0];
  if (!entry?.document) throw new FigmaError(404, "That node is not in the file (or the link points at a page, not a frame).");
  const doc = entry.document;
  if (!doc.absoluteBoundingBox) throw new FigmaError(400, "That node has no size — pick the page frame (the 1440px-wide artboard).");
  return fromRest(doc);
}
