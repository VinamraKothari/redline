import type { Review, Role } from "./types";

/** What the browser gets: the review plus the caller's role in its project. */
export type PublicReview = Omit<Review, "owner_key"> & { role: Role; is_owner: boolean };

/** Strip the legacy secret; attach the caller's role. */
export function publicReview(r: Review, role: Role, userId?: string | null): PublicReview {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { owner_key, ...rest } = r;
  return { ...rest, role, is_owner: role === "admin" || (Boolean(userId) && r.created_by_id === userId) };
}
