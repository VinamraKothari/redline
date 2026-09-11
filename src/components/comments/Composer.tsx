"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, SendHorizontal, Smile, X } from "lucide-react";
import { Avatar, IconButton, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/primitives";
import { useStore } from "@/lib/store";
import type { Attachment } from "@/lib/types";
import { cn, colorFor } from "@/lib/util";
import { KIND_LABEL, KIND_ORDER, kindOf, rangeForKinds, type ViewportKind } from "@/lib/viewports";

export const EMOJIS = ["👍", "👎", "❤️", "🔥", "👀", "✅", "❌", "🎉", "😂", "🤔", "💡", "⚠️", "🙏", "💯", "😍", "🚀", "🐛", "✨", "👏", "🤷"];

/**
 * Shrinks an image to ≤1400px on its long edge, uploads it and returns an
 * attachment with a storage URL. If the upload fails the image is kept inline
 * (data URL) so the comment can still be sent.
 */
export async function fileToAttachment(file: File): Promise<Attachment | null> {
  if (!file.type.startsWith("image/")) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const max = 1400;
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * s);
    c.height = Math.round(img.height * s);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const isPng = file.type === "image/png" && file.size < 600_000;
    const type = isPng ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, type, 0.85));
    const reviewId = useStore.getState().review?.id;
    if (blob && reviewId) {
      try {
        const r = await fetch(`/api/reviews/${reviewId}/attachments`, { method: "POST", headers: { "content-type": type }, body: blob, credentials: "same-origin" });
        if (r.ok) {
          const { id, url } = (await r.json()) as { id: string; url: string };
          return { id, name: file.name, url, w: c.width, h: c.height };
        }
      } catch {
        /* fall back to inline below */
      }
    }
    const data = c.toDataURL(type, 0.85);
    return { id: Math.random().toString(36).slice(2, 10), name: file.name, url: data, w: c.width, h: c.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function Composer({
  placeholder = "Write a comment…",
  autoFocus,
  onSubmit,
  onCancel,
  onDirty,
  initial = "",
  submitLabel,
  compact,
  participants = [],
  withTitle,
}: {
  placeholder?: string;
  autoFocus?: boolean;
  onSubmit: (body: string, attachments: Attachment[], title: string, viewports: { min: number; max: number } | null) => Promise<void> | void;
  onCancel?: () => void;
  onDirty?: (dirty: boolean) => void;
  initial?: string;
  submitLabel?: string;
  compact?: boolean;
  participants?: string[];
  /** new threads: an optional title that becomes the Jira summary */
  withTitle?: boolean;
}) {
  const viewer = useStore((s) => s.viewer);
  const viewers = useStore((s) => s.viewers);
  const viewport = useStore((s) => s.viewport);
  const [text, setText] = useState(initial);
  // which viewports a new thread applies to — the current one unless widened
  const [kinds, setKinds] = useState<ViewportKind[]>(() => [kindOf(viewport)]);
  const [title, setTitle] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState<{ q: string; at: number } | null>(null);
  const [mIdx, setMIdx] = useState(0);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onDirty?.(text.trim().length > 0 || attachments.length > 0 || title.trim().length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, attachments.length, title]);

  useEffect(() => {
    if (autoFocus) setTimeout(() => ta.current?.focus(), 30);
  }, [autoFocus]);

  // autosize
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(220, el.scrollHeight) + "px";
  }, [text]);

  const candidates = useMemo(() => {
    const names = new Set<string>(participants);
    viewers.forEach((v) => v.name && names.add(v.name));
    names.delete(viewer.name);
    const list = Array.from(names);
    if (!mention) return [];
    const q = mention.q.toLowerCase();
    return list.filter((n) => n.toLowerCase().includes(q)).slice(0, 6);
  }, [participants, viewers, viewer.name, mention]);

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setText(v);
    const caret = e.target.selectionStart ?? v.length;
    const before = v.slice(0, caret);
    const m = before.match(/(?:^|\s)@([\w .-]{0,30})$/);
    if (m) {
      setMention({ q: m[1], at: caret - m[1].length - 1 });
      setMIdx(0);
    } else setMention(null);
  }

  function pickMention(n: string) {
    if (!mention) return;
    const caret = ta.current?.selectionStart ?? text.length;
    const next = text.slice(0, mention.at) + `@[${n}] ` + text.slice(caret);
    setText(next);
    setMention(null);
    setTimeout(() => {
      ta.current?.focus();
      const pos = mention.at + n.length + 4;
      ta.current?.setSelectionRange(pos, pos);
    }, 0);
  }

  function insertEmoji(e: string) {
    const caret = ta.current?.selectionStart ?? text.length;
    setText(text.slice(0, caret) + e + text.slice(caret));
    setTimeout(() => ta.current?.focus(), 0);
  }

  async function addFiles(files: FileList | File[]) {
    const list: Attachment[] = [];
    for (const f of Array.from(files).slice(0, 4)) {
      const a = await fileToAttachment(f);
      if (a) list.push(a);
    }
    setAttachments((cur) => [...cur, ...list].slice(0, 6));
  }

  async function submit() {
    const body = text.trim();
    if (!body && !attachments.length) return;
    // Clear right away so the box feels instant; put everything back if the send fails.
    const draft = { text, title, attachments };
    // a range only when more than the current viewport's band was picked
    const viewports = withTitle && !(kinds.length === 1 && kinds[0] === kindOf(viewport)) ? rangeForKinds(kinds) : null;
    setBusy(true);
    setText("");
    setTitle("");
    setAttachments([]);
    try {
      await onSubmit(body, draft.attachments, draft.title.trim(), viewports);
    } catch (e) {
      setText(draft.text);
      setTitle(draft.title);
      setAttachments(draft.attachments);
      useStore.getState().toast((e as Error).message || "Couldn't send that — try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && candidates.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMIdx((i) => (i + 1) % candidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMIdx((i) => (i - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(candidates[mIdx]);
        return;
      }
      if (e.key === "Escape") {
        setMention(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") onCancel?.();
  }

  return (
    <div
      className={cn("relative", compact ? "" : "")}
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.files || []);
        if (files.length) {
          e.preventDefault();
          addFiles(files);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
      }}
      onDragOver={(e) => e.preventDefault()}
    >
      <div className="flex items-start gap-2">
        {!compact && <Avatar name={viewer.name || "?"} color={viewer.color} src={viewer.avatar_url} size={24} className="mt-1" />}
        <div className="min-w-0 flex-1 rounded-lg bg-paper hairline focus-within:shadow-[0_0_0_2px_var(--blue)] transition-shadow">
          {withTitle && (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional — becomes the Jira summary)"
              maxLength={140}
              aria-label="Comment title"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  ta.current?.focus();
                }
                if (e.key === "Escape") onCancel?.();
              }}
              className="block w-full border-b border-line bg-transparent px-2.5 pb-1.5 pt-2 text-[12.5px] font-semibold text-ink placeholder:font-normal placeholder:text-ink-3 outline-none"
            />
          )}
          <textarea
            ref={ta}
            value={text}
            onChange={onChange}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={1}
            className="block w-full resize-none bg-transparent px-2.5 pt-2 text-[13px] leading-[1.45] text-ink placeholder:text-ink-3 outline-none"
          />
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-2 pb-1">
              {attachments.map((a) => (
                <div key={a.id} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.url} alt={a.name} className="h-14 w-14 rounded-md object-cover hairline" />
                  <button
                    type="button"
                    onClick={() => setAttachments((cur) => cur.filter((x) => x.id !== a.id))}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-ink text-white"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {withTitle && (
            <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5 pt-0.5" role="group" aria-label="Applies to viewports">
              <span className="mr-0.5 text-[10.5px] text-ink-3">Applies to</span>
              {KIND_ORDER.map((k) => {
                const on = kinds.includes(k);
                const current = k === kindOf(viewport);
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    title={current ? `${KIND_LABEL[k]} — the viewport you're on` : `Also show this thread on ${KIND_LABEL[k].toLowerCase()} sizes`}
                    onClick={() => {
                      setKinds((cur) => {
                        const next = on ? cur.filter((x) => x !== k) : [...cur, k];
                        return next.length ? next : [k];
                      });
                      setTimeout(() => ta.current?.focus(), 0);
                    }}
                    className={cn(
                      "press h-5 rounded-full px-2 text-[10.5px] font-medium transition-colors",
                      on ? "bg-ink text-white" : "bg-hover text-ink-2 hover:text-ink",
                    )}
                  >
                    {KIND_LABEL[k]}
                  </button>
                );
              })}
              {kinds.includes("desktop") && kinds.includes("mobile") && !kinds.includes("tablet") && (
                <span className="text-[10.5px] text-ink-3">· tablet sizes in between are included</span>
              )}
            </div>
          )}
          <div className="flex items-center gap-0.5 px-1 pb-1">
            <Popover>
              <PopoverTrigger asChild>
                <IconButton size="sm" title="Emoji">
                  <Smile size={14} />
                </IconButton>
              </PopoverTrigger>
              <PopoverContent className="grid w-[232px] grid-cols-8 gap-0.5 p-1.5" side="top">
                {EMOJIS.map((e) => (
                  <button key={e} type="button" onClick={() => insertEmoji(e)} className="rounded p-1 text-[16px] hover:bg-hover">
                    {e}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <IconButton size="sm" title="Attach image" onClick={() => fileRef.current?.click()}>
              <ImagePlus size={14} />
            </IconButton>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
            <span className="ml-1 hidden text-[11px] text-ink-3 sm:inline">@ to mention</span>
            <div className="flex-1" />
            {onCancel && (
              <button type="button" onClick={onCancel} className="rounded px-2 py-1 text-[12px] text-ink-2 hover:bg-hover">
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={busy || (!text.trim() && !attachments.length)}
              className="flex h-7 items-center gap-1 rounded-md bg-ink px-2.5 text-[12px] font-medium text-white disabled:opacity-35"
              title="Send (Enter)"
            >
              {submitLabel ?? <SendHorizontal size={13} />}
            </button>
          </div>
        </div>
      </div>

      {mention && candidates.length > 0 && (
        <div className="absolute left-8 z-10 mt-1 w-[220px] rounded-lg bg-panel p-1 shadow-pop hairline">
          {candidates.map((n, i) => (
            <button
              key={n}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickMention(n)}
              className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px]", i === mIdx ? "bg-hover" : "")}
            >
              <Avatar name={n} color={colorFor(n)} size={18} />
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
