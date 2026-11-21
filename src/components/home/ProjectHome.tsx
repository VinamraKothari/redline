"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppWindow, ArrowRight, ChevronLeft, CornerUpLeft, FileCode2, Folder as FolderIcon, FolderInput, FolderPlus, Monitor, Pencil, Smartphone, SquareDashedMousePointer, Tablet, Trash2, Users } from "lucide-react";
import { api } from "@/lib/api";
import { FOLDER_NAME_MAX } from "@/lib/folders";
import type { PublicReview } from "@/lib/review";
import { VIEWPORTS, type Folder, type OpenThreadCount, type Project, type ProjectInvite, type ProjectMember, type Role } from "@/lib/types";
import { cn, normalizeUrl } from "@/lib/util";
import { Logo } from "@/components/Logo";
import { Button, ContextMenu, IconButton, Input, MenuItem, MenuSeparator, Tip, TooltipProvider } from "@/components/ui/primitives";
import { AccountMenu, useMe } from "./AccountMenu";
import { hasReviewDrag, setReviewDrag, useReviewDropTarget } from "./dnd";
import { FolderTile } from "./FolderTile";
import { MembersDialog } from "./MembersDialog";
import { MoveToFolderDialog, MoveToProjectDialog, PageTile } from "./PageTile";
import { BottomDock, DeletePagesDialog, DragStack, SelectionBar } from "./SelectionBar";
import { bandSelect, clickSelect, forEachPage, intersects, pagesLabel, sameSet, type Box, type Modifiers, type Point } from "./selection";
import { sumOpenThreads } from "./ThreadBadges";

/** An open rubber band, kept in a ref: pointer moves and the auto-scroll loop update it without a render each. */
interface Band {
  pointerId: number;
  /** where it started, in the scroll container's content coordinates (so it stays put while the page scrolls) */
  x0: number;
  y0: number;
  /** the pointer now, in viewport coordinates */
  clientX: number;
  clientY: number;
  /** the selection when the band started; Ctrl/Cmd toggles the hits within it */
  base: ReadonlySet<string>;
  toggle: boolean;
  /** past the 4px that tell a drag from a click */
  moved: boolean;
  raf: number;
}

/** Pointer-downs here never start a rubber band (and right-clicks here keep the browser's menu). */
const NOT_BACKGROUND = "a, button, input, textarea, select, label, [data-tile], [data-no-marquee], [role=dialog], [role=menu]";
/** How close to the top or bottom edge a rubber band starts scrolling the page, and by how much per frame. */
const EDGE = 32;
const SCROLL_STEP = 12;

interface Loaded {
  project: Project & { role: Role };
  reviews: PublicReview[];
  folders: Folder[];
  counts: Record<string, OpenThreadCount>;
  members: ProjectMember[];
  invites: ProjectInvite[];
}

/**
 * The project page. At the root it lists the project's folders first, then
 * the pages that are in no folder; with `folderId` it shows that folder's
 * pages only (route /p/[id]/f/[fid]). Pages are created where you stand.
 */
export function ProjectHome({ id, folderId }: { id: string; folderId?: string }) {
  const router = useRouter();
  const me = useMe();
  const [data, setData] = useState<Loaded | null>(null);
  const [url, setUrl] = useState("");
  const [viewport, setViewport] = useState(1440);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileDrag, setFileDrag] = useState(false);
  // the pages being dragged right now (one card, or the whole selection)
  const [dragIds, setDragIds] = useState<string[] | null>(null);
  const [members, setMembers] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const dragImage = useRef<HTMLDivElement>(null);
  // Selected page ids — only ever pages in view: whatever leaves the view (moved, deleted) is pruned below.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  // the card a Shift-click measures its range from
  const anchor = useRef<string | null>(null);
  const bandRef = useRef<Band | null>(null);
  const [band, setBand] = useState<Box | null>(null);
  const [menu, setMenu] = useState<{ at: Point; kind: "selection" | "background" } | null>(null);
  const [bulk, setBulk] = useState<"folder" | "project" | "delete" | null>(null);
  // what went wrong in a bulk action, shown next to the selection bar
  const [notice, setNotice] = useState<string | null>(null);
  // Every load and every local change bumps this; a load that started before
  // a later change is stale when it lands (it would snap a just-moved page back).
  const version = useRef(0);

  const reload = useCallback(() => {
    const mine = ++version.current;
    api
      .loadProject(id)
      .then((d) => {
        if (mine !== version.current) return;
        setData(d);
        setName(d.project.name);
      })
      .catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(reload, [reload]);

  const role = data?.project.role ?? "view";
  const canEdit = role !== "view";
  const admin = role === "admin";
  const folder = folderId ? data?.folders.find((f) => f.id === folderId) : undefined;

  // the folder was deleted while this page was open: its pages are at the root now
  useEffect(() => {
    if (data && folderId && !folder) router.replace(`/p/${id}`);
  }, [data, folderId, folder, id, router]);

  const { shown, folderSizes, folderCounts, rootSize } = useMemo(() => {
    const reviews = data?.reviews ?? [];
    const sizes: Record<string, number> = {};
    const perFolder: Record<string, PublicReview[]> = {};
    for (const r of reviews) {
      if (!r.folder_id) continue;
      sizes[r.folder_id] = (sizes[r.folder_id] ?? 0) + 1;
      (perFolder[r.folder_id] ??= []).push(r);
    }
    const counts: Record<string, OpenThreadCount> = {};
    for (const f of data?.folders ?? []) counts[f.id] = sumOpenThreads((perFolder[f.id] ?? []).map((r) => data?.counts[r.id]));
    const root = reviews.filter((r) => !r.folder_id);
    return { shown: folderId ? (perFolder[folderId] ?? []) : root, folderSizes: sizes, folderCounts: counts, rootSize: root.length };
  }, [data, folderId]);

  // Prune the selection whenever the view changes, so a page that left it (moved
  // to a folder, deleted) doesn't come back selected when it reappears later.
  // Adjusted during render rather than in an effect, so no frame shows the stale state.
  const [prunedFor, setPrunedFor] = useState(shown);
  if (prunedFor !== shown) {
    setPrunedFor(shown);
    const inView = new Set(shown.map((r) => r.id));
    if ([...selected].some((x) => !inView.has(x))) setSelected(new Set([...selected].filter((x) => inView.has(x))));
  }

  // the selection in visual order
  const picked = useMemo(() => shown.filter((r) => selected.has(r.id)), [shown, selected]);
  const sel = useMemo(() => new Set(picked.map((r) => r.id)), [picked]);
  const deletable = picked.filter((r) => admin || r.created_by_id === me?.id);
  const canMoveToFolder = (data?.folders.length ?? 0) > 0 || Boolean(folderId);
  // The cards are memoised and get stable callbacks (a rubber band re-renders this
  // page on every pointer move); those callbacks read the current view from here.
  const view = useRef({ data, shown, sel, picked });
  useLayoutEffect(() => {
    view.current = { data, shown, sel, picked };
  });

  async function start(e?: React.FormEvent) {
    e?.preventDefault();
    const n = normalizeUrl(url);
    if (!n) {
      setError("Enter a web address, like stripe.com or https://example.com/pricing");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { review } = await api.createReview({ project_id: id, folder_id: folderId, url: n, viewport });
      router.push(`/r/${review.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function upload(file: File) {
    if (!/\.html?$/i.test(file.name) && file.type !== "text/html") {
      setError("Drop an .html file.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const html = await file.text();
      const { review } = await api.createReview({ project_id: id, folder_id: folderId, mode: "upload", html, title: file.name.replace(/\.html?$/i, ""), viewport });
      router.push(`/r/${review.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n || !data) return;
    try {
      if (folder) await api.renameFolder(id, folder.id, n);
      else await api.renameProject(id, n);
      // the tab title was set by the server page; keep it in step
      document.title = folder ? `${n} · ${data.project.name} — Redline` : `${n} — Redline`;
      setRenaming(false);
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function createFolder(e: React.FormEvent) {
    e.preventDefault();
    const n = (newFolder ?? "").trim();
    if (!n) {
      setNewFolder(null);
      return;
    }
    try {
      const { folder: f } = await api.createFolder(id, n);
      setNewFolder(null);
      // show it at once; the reload confirms
      setData((d) => (d ? { ...d, folders: [...d.folders, f] } : d));
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  /** Put pages in a folder (null = root): one optimistic update, then the server's word; on failure the reload reverts what didn't move. */
  const movePages = useCallback(
    async (reviewIds: string[], target: string | null) => {
      // the dragged tiles may unmount right here (they leave this view), so their dragend never bubbles up: end the drag state ourselves
      setDragIds(null);
      const moving = reviewIds.filter((rid) => {
        const r = view.current.data?.reviews.find((x) => x.id === rid);
        return r && (r.folder_id ?? null) !== target;
      });
      if (!moving.length) return;
      setNotice(null);
      version.current++;
      const ids = new Set(moving);
      setData((d) => (d ? { ...d, reviews: d.reviews.map((x) => (ids.has(x.id) ? { ...x, folder_id: target } : x)) } : d));
      setSelected(new Set());
      const failed = await forEachPage(moving, (rid) => api.moveToFolder(rid, target), "move");
      if (failed) setNotice(failed);
      reload();
    },
    [reload],
  );

  /** Delete pages (already confirmed): gone from the grid at once, then the server's word. */
  const deletePages = useCallback(
    async (reviewIds: string[]) => {
      setNotice(null);
      version.current++;
      const ids = new Set(reviewIds);
      setData((d) => (d ? { ...d, reviews: d.reviews.filter((x) => !ids.has(x.id)) } : d));
      setSelected(new Set());
      const failed = await forEachPage(reviewIds, (rid) => api.deleteReview(rid), "delete");
      if (failed) setNotice(failed);
      reload();
    },
    [reload],
  );

  /** After a move through one of the dialogs: the pages have left the view. */
  const afterBulkMove = useCallback(() => {
    setSelected(new Set());
    reload();
  }, [reload]);

  function openInNewTabs(reviewIds: string[]) {
    // browsers may hold back all but the first as pop-ups; the address bar then offers to allow them
    for (const rid of reviewIds) window.open(`/r/${rid}`, "_blank", "noopener");
  }

  /* ─── selection ───────────────────────────────────────────────────────── */

  const pick = useCallback((reviewId: string, mods: Modifiers) => {
    const { sel, shown } = view.current;
    const next = clickSelect(sel, shown.map((r) => r.id), anchor.current, reviewId, mods);
    anchor.current = next.anchor;
    setSelected(next.selected);
  }, []);

  /** A right-click on a card: part of a selection of several → the selection's menu; otherwise the card alone is selected and shows its own. */
  const tileMenu = useCallback((reviewId: string, at: Point): boolean => {
    const { sel } = view.current;
    if (sel.has(reviewId) && sel.size > 1) {
      setMenu({ at, kind: "selection" });
      return true;
    }
    anchor.current = reviewId;
    setSelected(new Set([reviewId]));
    return false;
  }, []);

  /** A card starts to move: it takes the selection along when it is part of one, else it goes alone (and becomes the selection). */
  const tileDragStart = useCallback((e: DragEvent<HTMLElement>, reviewId: string) => {
    const { sel, picked } = view.current;
    const ids = sel.has(reviewId) && sel.size > 1 ? picked.map((r) => r.id) : [reviewId];
    if (ids.length === 1) {
      anchor.current = reviewId;
      setSelected(new Set(ids));
    }
    setReviewDrag(e.dataTransfer, ids);
    // a single card is its own drag image; several get the stack with the count
    if (ids.length > 1 && dragImage.current) e.dataTransfer.setDragImage(dragImage.current, 40, 36);
    setDragIds(ids);
  }, []);

  /** Is this pointer target empty background, where a rubber band (or the background's menu) may start? */
  function isBackground(main: HTMLElement, target: EventTarget | null): boolean {
    // events from portals (dialogs, menus) bubble through React to here, but aren't on the page
    return target instanceof Element && main.contains(target) && !target.closest(NOT_BACKGROUND);
  }

  /** Viewport → the scroll container's content coordinates, clamped to the content. */
  function toContent(main: HTMLElement, clientX: number, clientY: number) {
    const r = main.getBoundingClientRect();
    return {
      x: Math.min(Math.max(clientX - r.left + main.scrollLeft, 0), main.clientWidth),
      y: Math.min(Math.max(clientY - r.top + main.scrollTop, 0), main.scrollHeight),
    };
  }

  function updateBand() {
    const b = bandRef.current;
    const main = mainRef.current;
    if (!b || !main) return;
    const p = toContent(main, b.clientX, b.clientY);
    if (!b.moved && Math.hypot(p.x - b.x0, p.y - b.y0) < 4) return;
    b.moved = true;
    const box = { left: Math.min(b.x0, p.x), top: Math.min(b.y0, p.y), right: Math.max(b.x0, p.x), bottom: Math.max(b.y0, p.y) };
    setBand(box);
    const r = main.getBoundingClientRect();
    const hits: string[] = [];
    for (const el of main.querySelectorAll<HTMLElement>('[data-tile="page"]')) {
      const t = el.getBoundingClientRect();
      const dx = main.scrollLeft - r.left;
      const dy = main.scrollTop - r.top;
      if (intersects(box, { left: t.left + dx, top: t.top + dy, right: t.right + dx, bottom: t.bottom + dy }) && el.dataset.reviewId) hits.push(el.dataset.reviewId);
    }
    const next = bandSelect(b.base, hits, b.toggle);
    setSelected((prev) => (sameSet(prev, next) ? prev : next));
  }

  /** While a band is open: scroll when the pointer is near (or past) the top or bottom edge, so a band can reach cards out of view. */
  function autoScroll() {
    const b = bandRef.current;
    const main = mainRef.current;
    if (!b || !main) return;
    const r = main.getBoundingClientRect();
    const step = b.clientY < r.top + EDGE ? -SCROLL_STEP : b.clientY > r.bottom - EDGE ? SCROLL_STEP : 0;
    if (step && b.moved) {
      const before = main.scrollTop;
      main.scrollTop += step;
      if (main.scrollTop !== before) updateBand();
    }
    b.raf = requestAnimationFrame(autoScroll);
  }

  const preventSelectStart = useCallback((e: Event) => e.preventDefault(), []);

  function startBand(e: ReactPointerEvent<HTMLElement>) {
    const main = e.currentTarget;
    // primary button with a mouse or pen only: a finger on a phone scrolls the page instead
    if (e.button !== 0 || e.pointerType === "touch" || !data || !isBackground(main, e.target)) return;
    // the scroll bar of <main> is part of <main> too
    if (e.clientX - main.getBoundingClientRect().left >= main.clientWidth) return;
    // no text selection, no focus change: the band owns this press
    e.preventDefault();
    document.addEventListener("selectstart", preventSelectStart);
    if (document.activeElement instanceof HTMLElement && main.contains(document.activeElement)) document.activeElement.blur();
    main.setPointerCapture(e.pointerId);
    const p = toContent(main, e.clientX, e.clientY);
    bandRef.current = { pointerId: e.pointerId, x0: p.x, y0: p.y, clientX: e.clientX, clientY: e.clientY, base: sel, toggle: e.ctrlKey || e.metaKey, moved: false, raf: 0 };
    bandRef.current.raf = requestAnimationFrame(autoScroll);
  }

  /** Ends the band: `click` when the button came up (a press that never moved clears the selection, as in Explorer); `revert` for Esc. */
  function endBand(how: "click" | "cancel" | "revert") {
    const b = bandRef.current;
    if (!b) return;
    bandRef.current = null;
    cancelAnimationFrame(b.raf);
    document.removeEventListener("selectstart", preventSelectStart);
    const main = mainRef.current;
    if (main?.hasPointerCapture(b.pointerId)) main.releasePointerCapture(b.pointerId);
    setBand(null);
    if (how === "revert") setSelected(b.base);
    else if (how === "click" && !b.moved && !b.toggle) setSelected(new Set());
  }

  // Keyboard, Explorer style: Esc clears, Ctrl/Cmd+A selects every page in view, Delete asks to delete the selection.
  // Not while typing, and not inside a dialog or menu, which handle their own keys. The listener is
  // added once; it calls the handler of the latest render through this ref.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  useLayoutEffect(() => {
    onKey.current = (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('input, textarea, select, [contenteditable="true"], [role=dialog], [role=menu]')) return;
      if (e.key === "Escape") {
        if (bandRef.current) endBand("revert");
        else if (sel.size) setSelected(new Set());
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "a") {
        // never the browser's select-all of the page text here, even when there is no page to select
        e.preventDefault();
        if (shown.length) setSelected(new Set(shown.map((r) => r.id)));
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && sel.size && deletable.length) {
        e.preventDefault();
        setBulk("delete");
      }
    };
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  // a band never outlives the page
  useEffect(() => () => document.removeEventListener("selectstart", preventSelectStart), [preventSelectStart]);

  async function removeProject() {
    if (!data) return;
    if (!confirm(`Delete the project "${data.project.name}" with all ${data.reviews.length} page(s)? This can't be undone.`)) return;
    try {
      await api.deleteProject(id);
      router.push("/");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const title = folder ? folder.name : data?.project.name;
  const canRename = folder ? canEdit : admin;
  // New folder (editors, at the root), Select all (when there are pages), Back to project (in a folder)
  const bgMenuHasItems = (canEdit && !folderId) || shown.length > 0 || Boolean(folderId);

  return (
    <TooltipProvider>
      <main
        ref={mainRef}
        className={cn("relative h-full overflow-y-auto overflow-x-hidden", band && "select-none")}
        onPointerDown={startBand}
        onPointerMove={(e) => {
          const b = bandRef.current;
          if (!b || e.pointerId !== b.pointerId) return;
          b.clientX = e.clientX;
          b.clientY = e.clientY;
          updateBand();
        }}
        onPointerUp={() => endBand("click")}
        onPointerCancel={() => endBand("cancel")}
        onLostPointerCapture={() => endBand("cancel")}
        onContextMenu={(e) => {
          // the background's own menu; cards stop their right-clicks before they get here
          if (!data || !isBackground(e.currentTarget, e.target)) return;
          // as in Explorer, a right-click on empty space lets go of the selection (Ctrl/Cmd keeps it)
          if (!e.ctrlKey && !e.metaKey) setSelected(new Set());
          if (!bgMenuHasItems) return;
          e.preventDefault();
          setMenu({ at: { x: e.clientX, y: e.clientY }, kind: "background" });
        }}
        onDragEnd={() => setDragIds(null)}
        onDragOver={(e) => {
          // a page tile on its way to a folder is not a file drop
          if (!canEdit || hasReviewDrag(e.dataTransfer)) return;
          e.preventDefault();
          setFileDrag(true);
        }}
        onDragLeave={() => setFileDrag(false)}
        onDrop={(e) => {
          if (!canEdit || hasReviewDrag(e.dataTransfer)) return;
          e.preventDefault();
          setFileDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) upload(f);
        }}
      >
        <div className="pointer-events-none absolute inset-0 canvas-grid opacity-60" />
        {band && (
          <div
            aria-hidden
            data-testid="marquee"
            className="pointer-events-none absolute z-[5] border border-blue bg-blue/10"
            style={{ left: band.left, top: band.top, width: band.right - band.left, height: band.bottom - band.top }}
          />
        )}
        {/* room under the last row for the selection bar */}
        <div className={cn("relative mx-auto flex min-h-full max-w-[880px] flex-col px-6 pt-8", sel.size ? "pb-28" : "pb-10")}>
          <header data-no-marquee className="flex items-center justify-between">
            <Logo />
            <AccountMenu />
          </header>

          <nav data-no-marquee aria-label="Breadcrumb" className="mt-10 flex min-w-0 items-center gap-1 text-[12.5px] text-ink-3">
            <Link href="/" className="inline-flex shrink-0 items-center gap-1 hover:text-ink">
              <ChevronLeft size={13} /> Projects
            </Link>
            {folderId && (
              <>
                <span aria-hidden>/</span>
                <ProjectCrumb id={id} name={data?.project.name ?? "…"} canDrop={canEdit} dragging={dragIds?.length ?? 0} onDropPages={(ids) => movePages(ids, null)} />
                <span aria-hidden>/</span>
                <span className="truncate text-ink" aria-current="page">
                  {folder?.name ?? "…"}
                </span>
              </>
            )}
          </nav>

          {/* the title, the add-page box and their text are for reading and typing, not for starting a rubber band */}
          <section data-no-marquee className="mt-2">
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
              {/* title and pencil stay together; a long name wraps beside the pencil, aligned to its first line */}
              <div className="flex min-w-0 flex-1 items-start gap-3">
                {renaming ? (
                  <form onSubmit={rename} className="flex min-w-0 items-center gap-2">
                    <input
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
                      maxLength={folder ? FOLDER_NAME_MAX : 80}
                      aria-label={folder ? "Folder name" : "Project name"}
                      className="h-10 min-w-0 rounded-md bg-panel px-3 text-[24px] font-semibold tracking-[-0.02em] text-ink hairline outline-none"
                    />
                    <Button type="submit" variant="primary" size="sm">
                      Save
                    </Button>
                  </form>
                ) : (
                  <h1 className="flex min-w-0 items-start gap-2.5 break-words text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">
                    {folder && <FolderIcon size={22} className="mt-1.5 shrink-0 text-ink-3" strokeWidth={1.75} />}
                    <span className="min-w-0">{title ?? "…"}</span>
                  </h1>
                )}
                {canRename && !renaming && (
                  <Tip label={folder ? "Rename folder" : "Rename project"} side="bottom">
                    <IconButton
                      size="sm"
                      className="mt-1"
                      onClick={() => {
                        setName(title ?? "");
                        setRenaming(true);
                      }}
                      aria-label={folder ? "Rename folder" : "Rename project"}
                    >
                      <Pencil size={13} />
                    </IconButton>
                  </Tip>
                )}
              </div>
              {/* on a phone the members pill goes under the title instead of squeezing it into a column of words */}
              <span aria-hidden className="basis-full sm:hidden" />
              {data && (
                <button
                  type="button"
                  onClick={() => setMembers(true)}
                  className="flex shrink-0 items-center gap-2 rounded-lg bg-panel px-2.5 py-1.5 text-[12.5px] text-ink hairline hover:bg-hover sm:mt-0.5"
                >
                  <div className="flex -space-x-1.5">
                    {data.members.slice(0, 4).map((m) => (
                      <span key={m.user_id} className="rounded-full ring-2 ring-panel">
                        <AvatarSmall m={m} />
                      </span>
                    ))}
                  </div>
                  <Users size={13} className="text-ink-2" />
                  {data.members.length} member{data.members.length === 1 ? "" : "s"}
                  {data.invites.length > 0 && <span className="text-ink-3">· {data.invites.length} invited</span>}
                </button>
              )}
            </div>
            <p className="mt-1.5 min-h-[18px] text-[12.5px] text-ink-3">
              {!data
                ? ""
                : folder
                  ? `A folder in ${data.project.name} · ${shown.length} page${shown.length === 1 ? "" : "s"} · every member of the project sees it`
                  : `You are ${role === "admin" ? "an admin — you can manage members and pages" : role === "edit" ? "an editor — you can comment, draw and add pages" : "a viewer — you can read and present"} · every member sees all pages in this project`}
            </p>

            {canEdit && (
              <form onSubmit={start} className="mt-7">
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-xl bg-panel p-1.5 shadow-pop transition-shadow",
                    "focus-within:shadow-[0_0_0_2px_var(--blue),var(--shadow-pop)]",
                    fileDrag && "shadow-[0_0_0_2px_var(--red),var(--shadow-pop)]",
                  )}
                >
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={folder ? "Add a page to this folder — paste a URL, e.g. staging.yoursite.com/pricing" : "Add a page — paste a URL, e.g. staging.yoursite.com/pricing"}
                    spellCheck={false}
                    className="h-11 min-w-0 flex-1 bg-transparent px-3 text-[15px] text-ink placeholder:text-ink-3 outline-none"
                  />
                  <div className="hidden items-center gap-0.5 rounded-lg bg-hover p-0.5 sm:flex">
                    {[
                      { w: 1440, Icon: Monitor, t: "Desktop 1440" },
                      { w: 1024, Icon: Tablet, t: "Tablet 1024" },
                      { w: 390, Icon: Smartphone, t: "Phone 390" },
                    ].map(({ w, Icon, t }) => (
                      <button
                        key={w}
                        type="button"
                        title={t}
                        onClick={() => setViewport(w)}
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                          viewport === w ? "bg-panel text-ink shadow-sm" : "text-ink-3 hover:text-ink",
                        )}
                      >
                        <Icon size={15} />
                      </button>
                    ))}
                  </div>
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-ink px-4 text-[13px] font-medium text-white transition-colors hover:bg-black disabled:opacity-60"
                  >
                    {busy ? "Opening…" : "Review"}
                    {!busy && <ArrowRight size={14} />}
                  </button>
                </div>
                <div className="mt-3 flex items-center gap-4 text-[12.5px] text-ink-3">
                  <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 hover:text-ink">
                    <FileCode2 size={13} /> or drop an .html file anywhere
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".html,.htm,text/html"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
                  />
                  <span className="hidden sm:inline">
                    Viewport: <span className="mono text-ink-2">{VIEWPORTS.find((v) => v.width === viewport)?.label.replace(" · ", " ")}</span>
                  </span>
                </div>
              </form>
            )}
            {error && <p className="mt-3 text-[13px] text-red-ink">{error}</p>}
          </section>

          <section className="mt-10">
            <div className="mb-3 flex min-h-[28px] items-center justify-between gap-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                {/* on a phone only the counts fit beside the New-folder button */}
                <span className="max-sm:hidden">{sectionHeading(data, folder ? shown.length : null)}</span>
                <span className="sm:hidden">{sectionHeading(data, folder ? shown.length : null, true)}</span>
              </h2>
              {canEdit &&
                !folderId &&
                data &&
                (newFolder === null ? (
                  <Button size="sm" onClick={() => setNewFolder("")}>
                    <FolderPlus size={13} /> New folder
                  </Button>
                ) : (
                  <form onSubmit={createFolder} className="flex items-center gap-1.5">
                    <Input
                      autoFocus
                      value={newFolder}
                      onChange={(e) => setNewFolder(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && setNewFolder(null)}
                      onBlur={() => !newFolder.trim() && setNewFolder(null)}
                      placeholder="Folder name"
                      maxLength={FOLDER_NAME_MAX}
                      aria-label="New folder name"
                      className="h-7 w-[180px] text-[12.5px]"
                    />
                    <Button type="submit" variant="primary" size="sm" disabled={!newFolder.trim()}>
                      Create
                    </Button>
                  </form>
                ))}
            </div>
            {!data ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {[0, 1].map((i) => (
                  <div key={i} className="h-[58px] animate-pulse rounded-lg bg-hover" />
                ))}
              </div>
            ) : folderId && shown.length === 0 ? (
              <p className="rounded-lg bg-panel px-4 py-6 text-center text-[13px] text-ink-3 hairline">
                {canEdit ? "This folder is empty — add a page above or drag pages here from the project." : "This folder is empty."}
              </p>
            ) : !folderId && data.folders.length === 0 && shown.length === 0 ? (
              <p className="rounded-lg bg-panel px-4 py-6 text-center text-[13px] text-ink-3 hairline">
                {canEdit ? "No pages yet — paste a URL above to add the first one. A project can hold as many pages as you like." : "No pages in this project yet."}
              </p>
            ) : (
              <ul data-testid="tile-grid" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {!folderId &&
                  data.folders.map((f) => (
                    <FolderTile
                      key={f.id}
                      folder={f}
                      pages={data.reviews.filter((r) => r.folder_id === f.id)}
                      counts={folderCounts[f.id]}
                      canEdit={canEdit}
                      onChanged={reload}
                      onError={setError}
                      onDropPage={movePages}
                    />
                  ))}
                {shown.map((r) => (
                  <PageTile
                    key={r.id}
                    r={r}
                    counts={data.counts[r.id]}
                    folders={data.folders}
                    folderSizes={folderSizes}
                    rootSize={rootSize}
                    canEdit={canEdit}
                    canDelete={admin || r.created_by_id === me?.id}
                    selected={sel.has(r.id)}
                    dragging={Boolean(dragIds?.includes(r.id))}
                    onPick={pick}
                    onMenu={tileMenu}
                    onDragStart={tileDragStart}
                    onDelete={deletePages}
                    onChanged={reload}
                    onError={setError}
                  />
                ))}
              </ul>
            )}
          </section>

          {admin && !folderId && (
            <section className="mt-16 border-t border-line pt-6">
              <button type="button" onClick={removeProject} className="text-[12px] text-ink-3 hover:text-red">
                Delete this project…
              </button>
            </section>
          )}
        </div>

        <BottomDock notice={notice} onDismiss={() => setNotice(null)}>
          {sel.size > 0 && (
            <SelectionBar
              count={sel.size}
              canMoveToFolder={canMoveToFolder}
              canMove={canEdit}
              canDelete={deletable.length > 0}
              onMoveToFolder={() => setBulk("folder")}
              onMoveToProject={() => setBulk("project")}
              onDelete={() => setBulk("delete")}
              onClear={() => setSelected(new Set())}
            />
          )}
        </BottomDock>
        {picked.length > 1 && <DragStack ref={dragImage} lead={picked[0]} count={picked.length} />}

        <ContextMenu at={menu?.at ?? null} onClose={() => setMenu(null)} label={menu?.kind === "selection" ? `Actions for ${pagesLabel(sel.size)}` : folderId ? "Folder actions" : "Project actions"}>
          {menu?.kind === "selection" ? (
            <>
              <MenuItem onSelect={() => openInNewTabs(picked.map((r) => r.id))}>
                <AppWindow size={13} /> Open all in new tabs
              </MenuItem>
              {canEdit && canMoveToFolder && (
                <MenuItem onSelect={() => setBulk("folder")}>
                  <FolderIcon size={13} /> Move {pagesLabel(sel.size)} to folder…
                </MenuItem>
              )}
              {canEdit && (
                <MenuItem onSelect={() => setBulk("project")}>
                  <FolderInput size={13} /> Move {pagesLabel(sel.size)} to project…
                </MenuItem>
              )}
              {deletable.length > 0 && (
                <>
                  <MenuSeparator />
                  <MenuItem danger onSelect={() => setBulk("delete")}>
                    <Trash2 size={13} /> Delete {pagesLabel(sel.size)}…
                  </MenuItem>
                </>
              )}
            </>
          ) : (
            <>
              {canEdit && !folderId && (
                <MenuItem onSelect={() => setNewFolder("")}>
                  <FolderPlus size={13} /> New folder
                </MenuItem>
              )}
              {shown.length > 0 && (
                <MenuItem onSelect={() => setSelected(new Set(shown.map((r) => r.id)))}>
                  <SquareDashedMousePointer size={13} /> Select all
                  <span className="ml-auto pl-4 text-[11px] text-ink-3">{isMac() ? "⌘A" : "Ctrl+A"}</span>
                </MenuItem>
              )}
              {folderId && (
                <MenuItem asChild>
                  <Link href={`/p/${id}`}>
                    <CornerUpLeft size={13} /> Back to project
                  </Link>
                </MenuItem>
              )}
            </>
          )}
        </ContextMenu>

        {data && bulk === "folder" && (
          <MoveToFolderDialog reviews={picked} folders={data.folders} folderSizes={folderSizes} rootSize={rootSize} onClose={() => setBulk(null)} onMoved={afterBulkMove} onError={setNotice} />
        )}
        {bulk === "project" && <MoveToProjectDialog reviews={picked} onClose={() => setBulk(null)} onMoved={afterBulkMove} onError={setNotice} />}
        {bulk === "delete" && <DeletePagesDialog selected={picked.length} deletable={deletable} onClose={() => setBulk(null)} onDelete={deletePages} />}

        {data && me && (
          <MembersDialog
            open={members}
            onOpenChange={setMembers}
            projectId={id}
            myId={me.id}
            myRole={role}
            members={data.members}
            invites={data.invites}
            onChange={reload}
          />
        )}
      </main>
    </TooltipProvider>
  );
}

/** "Pages in this project · 6 pages · 3 folders" — the grid mixes both kinds at the root, so both are counted; `short` drops the prefix. */
function sectionHeading(data: Loaded | null, inFolder: number | null, short = false): string {
  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const prefix = (text: string) => (short ? "" : `${text} · `);
  if (inFolder !== null) return `${prefix("Pages in this folder")}${short ? n(inFolder, "page") : inFolder}`;
  if (!data) return short ? "Pages" : "Pages in this project";
  if (!data.folders.length) return `${prefix("Pages in this project")}${short ? n(data.reviews.length, "page") : data.reviews.length}`;
  return `${prefix("Pages in this project")}${n(data.reviews.length, "page")} · ${n(data.folders.length, "folder")}`;
}

/** For the shortcut hint in a menu. */
function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

/**
 * The project's name in the breadcrumb of a folder page. While page tiles are
 * being dragged it doubles as the way back to the root: drop them here.
 */
function ProjectCrumb({ id, name, canDrop, dragging, onDropPages }: { id: string; name: string; canDrop: boolean; dragging: number; onDropPages: (reviewIds: string[]) => void }) {
  const { over, props } = useReviewDropTarget(onDropPages, canDrop);
  return (
    <Link
      href={`/p/${id}`}
      {...props}
      data-testid="project-crumb"
      data-drop-over={over || undefined}
      title={dragging ? `Drop here to move ${dragging === 1 ? "the page" : `the ${dragging} pages`} back to the project` : undefined}
      className={cn(
        "min-w-0 truncate rounded-md px-1.5 py-0.5 transition-[box-shadow,background-color,color] hover:text-ink",
        dragging > 0 && "bg-blue-soft text-blue",
        over && "shadow-[0_0_0_2px_var(--blue)]",
      )}
    >
      {name}
    </Link>
  );
}

function AvatarSmall({ m }: { m: ProjectMember }) {
  const p = m.profile;
  if (p?.avatar_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={p.avatar_url} alt={p.name} referrerPolicy="no-referrer" className="h-5 w-5 rounded-full object-cover" />;
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white" style={{ background: p?.color || "#999" }}>
      {(p?.name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}
