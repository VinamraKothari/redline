"use client";

import { call, type BillingStatus } from "./api";
import type { Profile } from "./types";

/**
 * The account page's own endpoints: edit the profile, leave a project,
 * redeem a code, delete the account. Kept apart from lib/api.ts so the
 * account hub can grow without touching the client every screen imports.
 * Every call goes through `call`, so a 401 still sends people to sign in.
 */
export const accountApi = {
  updateProfile(patch: { name?: string; color?: string }) {
    return call<{ user: Profile }>("/api/me", { method: "PATCH", body: JSON.stringify(patch) });
  },
  deleteAccount() {
    return call<{ ok: true }>("/api/me", { method: "DELETE" });
  },
  leaveProject(projectId: string) {
    return call<{ ok: true }>(`/api/projects/${projectId}/members/me`, { method: "DELETE" });
  },
  /** Mirrors `api.billing.redeem`; a server without the redeem endpoint says so instead of "not found". */
  async redeemCode(code: string): Promise<BillingStatus> {
    const res = await fetch("/api/billing/redeem", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
    const data = (await res.json().catch(() => ({}))) as BillingStatus & { error?: string };
    if (res.status === 404 && !data.error) throw new Error("Codes can't be redeemed on this server yet.");
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  },
};
