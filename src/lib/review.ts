import type { Review } from "./types";

export type PublicReview = Omit<Review, "owner_key"> & { is_owner: boolean };

/** Strip the owner secret before sending a review to a client. */
export function publicReview(r: Review, ownerKey?: string | null): PublicReview {
  const { owner_key, ...rest } = r;
  return { ...rest, is_owner: Boolean(ownerKey && ownerKey === owner_key) };
}
