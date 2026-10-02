"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Pencil } from "lucide-react";
import { accountApi } from "@/lib/account-api";
import { setMe } from "@/lib/store";
import { AUTHOR_COLORS, type Profile } from "@/lib/types";
import { cn } from "@/lib/util";
import { Avatar, Button, IconButton, Input } from "@/components/ui/primitives";
import { formatDay } from "@/components/billing/plan-source";

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Who you are in Redline: picture and e-mail come from Google and stay that
 * way; the name and the colour of your pins are yours to change. Edits are
 * optimistic — the store (and so the account menu) changes at once, and is
 * put back if the server disagrees.
 */
export function ProfileCard({ me }: { me: Profile }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(me.name);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const input = useRef<HTMLInputElement>(null);
  // only the newest request may write back; an older answer would undo a later click
  const seq = useRef(0);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  useEffect(() => {
    if (saveState !== "saved") return;
    const t = setTimeout(() => setSaveState("idle"), 2000);
    return () => clearTimeout(t);
  }, [saveState]);

  // arrow keys through the swatches change the colour at once but save only after a pause
  const colourTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const persistedColour = useRef(me.color);
  useEffect(() => () => clearTimeout(colourTimer.current), []);

  /** `prev` is what to show again if the server says no — by default what is shown now. */
  async function save(patch: { name?: string; color?: string }, prev: Profile = me) {
    const mine = ++seq.current;
    setError(null);
    setSaveState("saving");
    setMe({ ...me, ...patch });
    try {
      const { user } = await accountApi.updateProfile(patch);
      if (mine !== seq.current) return;
      // merge, not replace: the store's profile may carry fields the PATCH response doesn't (admin flags)
      setMe({ ...me, ...user });
      setSaveState("saved");
    } catch (e) {
      if (mine !== seq.current) return;
      setMe(prev);
      setSaveState("error");
      setError((e as Error).message);
    }
  }

  /** Arrow keys select the previous/next swatch (and focus it); Home/End jump to the ends. */
  function moveSwatch(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step === undefined && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = AUTHOR_COLORS.indexOf(me.color);
    const next = e.key === "Home" ? 0 : e.key === "End" ? AUTHOR_COLORS.length - 1 : (i + (step as number) + AUTHOR_COLORS.length) % AUTHOR_COLORS.length;
    const colour = AUTHOR_COLORS[next];
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-color="${colour}"]`)?.focus();
    if (colour === me.color) return;
    // show it now, save it once the keys stop (a revert goes back to the last colour the server had)
    const persisted = colourTimer.current ? persistedColour.current : me.color;
    persistedColour.current = persisted;
    clearTimeout(colourTimer.current);
    setMe({ ...me, color: colour });
    colourTimer.current = setTimeout(() => {
      colourTimer.current = undefined;
      void save({ color: colour }, { ...me, color: persisted });
    }, 300);
  }

  function submitName(e: React.FormEvent) {
    e.preventDefault();
    const name = draft.trim().replace(/\s+/g, " ");
    if (!name) {
      setError("Enter a name between 1 and 80 characters.");
      return;
    }
    setEditing(false);
    if (name !== me.name) void save({ name });
  }

  return (
    <div className="rounded-xl bg-panel p-5 hairline">
      <div className="flex items-start gap-4">
        <Avatar name={me.name} color={me.color} src={me.avatar_url} size={56} />
        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={submitName} className="flex flex-wrap items-center gap-2">
              <Input
                ref={input}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setEditing(false);
                    setDraft(me.name);
                    setError(null);
                  }
                }}
                maxLength={80}
                aria-label="Your name"
                className="h-8 max-w-[320px] text-[14px]"
              />
              <Button type="submit" variant="primary" size="sm">
                Save
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setDraft(me.name);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-1.5">
              <h3 data-testid="profile-name" className="truncate text-[18px] font-semibold tracking-[-0.01em] text-ink">
                {me.name}
              </h3>
              <IconButton
                size="sm"
                aria-label="Edit name"
                onClick={() => {
                  setDraft(me.name);
                  setEditing(true);
                }}
              >
                <Pencil size={13} />
              </IconButton>
              <SaveNote state={saveState} />
            </div>
          )}
          <div className="mt-0.5 text-[13px] text-ink-2">
            <span className="break-all">{me.email}</span>
            <span className="block text-ink-3 sm:inline">
              <span className="hidden sm:inline"> · </span>from your Google account
            </span>
          </div>
          <div className="mt-0.5 text-[12.5px] text-ink-3">Member since {formatDay(me.created_at)}</div>
          {error && (
            <p role="alert" className="mt-2 text-[12.5px] text-red-ink">
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-[12.5px] font-medium text-ink">Your colour</div>
            <p className="mt-0.5 text-[12px] text-ink-3">The colour of your pins, cursor and initials in every review.</p>
          </div>
        </div>
        <div role="radiogroup" aria-label="Your colour" className="mt-3 flex flex-wrap gap-2" onKeyDown={moveSwatch}>
          {AUTHOR_COLORS.map((c) => {
            const on = c === me.color;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={`Colour ${c}`}
                data-color={c}
                // one tab stop for the group; arrow keys walk the swatches like a native radio group
                tabIndex={on ? 0 : -1}
                onClick={() => !on && save({ color: c })}
                style={{ background: c }}
                className={cn("press flex h-7 w-7 items-center justify-center rounded-full text-white transition-shadow", on ? "shadow-[0_0_0_2px_var(--panel),0_0_0_4px_var(--ink)]" : "hover:shadow-[0_0_0_2px_var(--panel),0_0_0_4px_var(--line-strong)]")}
              >
                {on && <Check size={14} strokeWidth={3} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SaveNote({ state }: { state: SaveState }) {
  return (
    <span aria-live="polite" className={cn("ml-1 inline-flex items-center gap-1 text-[11.5px] transition-opacity", state === "idle" ? "opacity-0" : "opacity-100", state === "error" ? "text-red-ink" : "text-ink-3")}>
      {state === "saving" && "Saving…"}
      {state === "saved" && (
        <>
          <Check size={11} className="text-green" /> Saved
        </>
      )}
      {state === "error" && "Not saved"}
    </span>
  );
}
