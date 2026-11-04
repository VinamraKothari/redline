import type { DbAdapter } from "./db/adapter";
import type { Folder } from "./types";

/** Longest folder name the API accepts. */
export const FOLDER_NAME_MAX = 60;

/** A folder's name as typed, trimmed and bounded; null when unusable. */
export function folderName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const n = raw.trim().slice(0, FOLDER_NAME_MAX);
  return n || null;
}

/**
 * The folder `folderId` of project `projectId`, or null when it doesn't exist
 * or belongs to another project — the one check every folder route and every
 * "put this page in that folder" needs.
 */
export async function folderInProject(d: DbAdapter, projectId: string, folderId: string): Promise<Folder | null> {
  const f = await d.getFolder(folderId);
  return f && f.project_id === projectId ? f : null;
}

/**
 * Why `folderId` can't take a page of `projectId`: it belongs to another
 * project, or there is no such folder. Null when it's fine.
 */
export async function folderRefusal(d: DbAdapter, projectId: string, folderId: string): Promise<string | null> {
  const f = await d.getFolder(folderId);
  if (!f) return "That folder doesn't exist in this project.";
  if (f.project_id !== projectId) return "That folder is in another project.";
  return null;
}
