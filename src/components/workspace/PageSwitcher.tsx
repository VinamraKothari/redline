"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, FolderKanban, Plus } from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import type { PublicReview } from "@/lib/review";
import type { Project } from "@/lib/types";
import { useStore } from "@/lib/store";
import { hostOf } from "@/lib/util";

/**
 * The review title doubles as a menu of the other pages in the same project,
 * so switching between the pages you're reviewing together is one click.
 */
export function PageSwitcher() {
  const review = useStore((s) => s.review);
  const [data, setData] = useState<{ project: Project; reviews: PublicReview[] } | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (!review?.project_id || data || loading) return;
    setLoading(true);
    try {
      const d = await api.loadProject(review.project_id);
      setData({ project: d.project, reviews: d.reviews });
    } catch {
      /* the menu still shows the current page */
    } finally {
      setLoading(false);
    }
  }

  if (!review) return null;
  return (
    <Menu onOpenChange={(o) => o && load()}>
      <MenuTrigger asChild>
        <button
          type="button"
          className="flex h-8 min-w-0 items-center gap-1 rounded-md px-1.5 text-left hover:bg-hover"
          title="Pages in this project"
          aria-label="Pages in this project"
        >
          <span className="truncate text-[13px] font-semibold text-ink">{review.title}</span>
          <ChevronDown size={13} className="shrink-0 text-ink-3" />
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-[300px]">
        <MenuLabel>
          <span className="inline-flex items-center gap-1.5">
            <FolderKanban size={12} /> {data?.project.name ?? "Pages in this project"}
          </span>
        </MenuLabel>
        {data ? (
          data.reviews.map((r) => (
            <MenuItem key={r.id} asChild>
              <Link href={`/r/${r.id}`} className="flex items-center gap-2">
                <span className="w-3 shrink-0 text-blue">{r.id === review.id ? <Check size={12} /> : null}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink">{r.title}</span>
                  <span className="block truncate text-[11px] text-ink-3">{r.url.startsWith("upload://") ? "Uploaded file" : hostOf(r.url)}</span>
                </span>
              </Link>
            </MenuItem>
          ))
        ) : (
          <div className="px-2 py-1.5 text-[12px] text-ink-3">{loading ? "Loading…" : review.title}</div>
        )}
        <MenuSeparator />
        <MenuItem asChild>
          <Link href={`/p/${review.project_id}`} className="flex items-center gap-2">
            <Plus size={13} /> Add a page / manage project
          </Link>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
