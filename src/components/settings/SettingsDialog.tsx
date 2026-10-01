"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Check, CreditCard, GitCompareArrows, UserRound } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/primitives";
import { DEV_CATEGORIES, DEV_CATEGORY_IDS, DEV_SEVERITIES, type DevSeverity } from "@/lib/figma/categories";
import { applySettings, ensureSettingsLoaded, saveSettings } from "@/lib/settings";
import { useStore } from "@/lib/store";
import type { UserSettings } from "@/lib/types";
import { cn } from "@/lib/util";

const ALL_SEVERITIES = DEV_SEVERITIES.map((s) => s.id);

/** Opens the settings dialog from anywhere (menus, shortcuts, other dialogs). */
export function openSettings() {
  window.dispatchEvent(new CustomEvent("redline:settings"));
}

/*
 * Exactly one dialog per page. Pages that stay mounted through full-screen
 * mode (Workspace, Projects) render the primary host; the account menu carries
 * a fallback for any other page, which steps aside as soon as a primary exists —
 * otherwise a shortcut would open two dialogs.
 */
let primaries = 0;
const watchers = new Set<() => void>();
const subscribe = (cb: () => void) => {
  watchers.add(cb);
  return () => watchers.delete(cb);
};
const primaryCount = () => primaries;
function setPrimaries(n: number) {
  primaries = n;
  watchers.forEach((cb) => cb());
}

/**
 * Listens for `redline:settings`, loads the account's preferences and renders
 * the dialog. `fallback` hosts only render while no primary host is mounted.
 */
export function SettingsDialogHost({ fallback }: { fallback?: boolean }) {
  const [open, setOpen] = useState(false);
  const hasPrimary = useSyncExternalStore(subscribe, primaryCount, () => 0) > 0;
  const active = !fallback || !hasPrimary;
  useEffect(() => {
    if (fallback) return;
    setPrimaries(primaries + 1);
    return () => setPrimaries(primaries - 1);
  }, [fallback]);
  useEffect(() => {
    if (!active) return;
    ensureSettingsLoaded();
    const toggle = () => setOpen((o) => !o);
    window.addEventListener("redline:settings", toggle);
    return () => window.removeEventListener("redline:settings", toggle);
  }, [active]);
  if (!active) return null;
  return <SettingsDialog open={open} onOpenChange={setOpen} />;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const settings = useStore((s) => s.settings);
  const me = useStore((s) => s.me);
  const toast = useStore((s) => s.toast);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  // only the newest request may write back; an older answer would undo a later click
  const seq = useRef(0);

  const categories = settings.devCategories ?? DEV_CATEGORY_IDS;
  const severities = settings.devSeverities ?? ALL_SEVERITIES;

  /**
   * Optimistic: the store and the cache change at once, the server follows.
   * A full selection is stored as "no restriction" so categories added in a
   * later release show up by default instead of staying hidden.
   */
  function update(next: UserSettings) {
    const prev = settings;
    const normalised: UserSettings = { ...next };
    if (normalised.devCategories && DEV_CATEGORY_IDS.every((id) => normalised.devCategories!.includes(id))) delete normalised.devCategories;
    if (normalised.devSeverities && ALL_SEVERITIES.every((id) => normalised.devSeverities!.includes(id))) delete normalised.devSeverities;
    applySettings(normalised);
    const mine = ++seq.current;
    setSaveState("saving");
    saveSettings(normalised)
      .then((stored) => {
        if (mine !== seq.current) return;
        applySettings(stored);
        setSaveState("saved");
      })
      .catch((e: Error) => {
        if (mine !== seq.current) return;
        applySettings(prev);
        setSaveState("error");
        toast(`Couldn't save your settings: ${e.message}`, "error");
      });
  }

  const setCategories = (ids: string[]) => update({ ...settings, devCategories: DEV_CATEGORY_IDS.filter((id) => ids.includes(id)) });
  const setSeverities = (ids: DevSeverity[]) => update({ ...settings, devSeverities: ALL_SEVERITIES.filter((id) => ids.includes(id)) });

  // the "Saved" note fades out on its own
  useEffect(() => {
    if (saveState !== "saved") return;
    const t = setTimeout(() => setSaveState("idle"), 2000);
    return () => clearTimeout(t);
  }, [saveState]);

  const hiddenCategories = DEV_CATEGORY_IDS.length - categories.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Settings"
        description="Your preferences, kept with your account on every page you review."
        width={520}
        className="max-h-[calc(100vh-32px)] overflow-y-auto"
      >
        <div className="flex flex-col gap-4">
          <section aria-labelledby="settings-figma">
            <div className="flex items-center gap-2">
              <GitCompareArrows size={13} className="text-[#7c3aed]" />
              <h3 id="settings-figma" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                Compare with Figma
              </h3>
              <span
                aria-live="polite"
                className={cn(
                  "ml-auto inline-flex items-center gap-1 text-[11px] transition-opacity",
                  saveState === "idle" ? "opacity-0" : "opacity-100",
                  saveState === "error" ? "text-red-ink" : "text-ink-3",
                )}
              >
                {saveState === "saving" && "Saving…"}
                {saveState === "saved" && (
                  <>
                    <Check size={11} className="text-green" /> Saved
                  </>
                )}
                {saveState === "error" && "Not saved"}
              </span>
            </div>

            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">
              When you compare a page with its Figma frame, every difference becomes a developer comment. Choose which kinds you see:
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[12.5px] font-medium text-ink">Developer comments to show</span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setCategories(DEV_CATEGORY_IDS)}
                disabled={hiddenCategories === 0}
                className="whitespace-nowrap rounded px-1.5 py-0.5 text-[11.5px] text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => setCategories([])}
                disabled={categories.length === 0}
                className="whitespace-nowrap rounded px-1.5 py-0.5 text-[11.5px] text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40"
              >
                Unselect all
              </button>
            </div>
            <div className="mt-1.5 flex flex-col gap-px rounded-lg bg-paper p-1 hairline">
              {DEV_CATEGORIES.map((c) => {
                const on = categories.includes(c.id);
                return (
                  <label key={c.id} className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover">
                    <input
                      type="checkbox"
                      className="mt-[3px] accent-[#7c3aed]"
                      checked={on}
                      onChange={(e) => setCategories(e.target.checked ? [...categories, c.id] : categories.filter((id) => id !== c.id))}
                      aria-describedby={`settings-cat-${c.id}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-[12.5px] font-medium", on ? "text-ink" : "text-ink-2")}>{c.label}</span>
                      <span id={`settings-cat-${c.id}`} className="block text-[11.5px] leading-snug text-ink-3">
                        {c.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-[12.5px] font-medium text-ink">Severity</span>
              {DEV_SEVERITIES.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink" title={s.description}>
                  <input
                    type="checkbox"
                    className="accent-[#7c3aed]"
                    checked={severities.includes(s.id)}
                    onChange={(e) => setSeverities(e.target.checked ? [...severities, s.id] : severities.filter((id) => id !== s.id))}
                  />
                  {s.label}
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
              Findings you untick stay on the page for everyone else and come back when you tick them again — nothing is deleted.
            </p>
          </section>

          <section aria-labelledby="settings-account">
            <div className="flex items-center gap-2">
              <UserRound size={13} className="text-ink-3" />
              <h3 id="settings-account" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                Account
              </h3>
            </div>
            <div className="mt-2 flex items-center gap-3 rounded-lg bg-paper px-3 py-2 hairline">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium text-ink">{me?.name ?? "—"}</div>
                <div className="truncate text-[11.5px] text-ink-3">{me?.email ?? "Signed in with Google"}</div>
              </div>
              <Link
                href="/account/billing"
                onClick={() => onOpenChange(false)}
                className="press inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-panel px-2.5 text-[12px] font-medium text-ink hairline hover:bg-hover"
              >
                <CreditCard size={12} /> Billing &amp; plan
              </Link>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
