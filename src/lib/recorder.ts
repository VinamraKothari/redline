"use client";

import { useStore, type Mode } from "./store";
import type { Attachment } from "./types";

/**
 * Screen recordings for comments. Records this tab (the browser's picker
 * opens on the current tab) with MediaRecorder, uploads the clip straight to
 * storage and hands it to the composer it was started from as a video
 * attachment. Two minutes max, ~2 Mbit/s — a clip stays a few MB.
 */

export const MAX_SECONDS = 120;

export interface RecordingTarget {
  /** "draft" for a new thread, otherwise the thread id being replied to */
  target: string;
}

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let restore: { mode: Mode } | null = null;

export function canRecord(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== "undefined";
}

function pickMime(): string {
  const prefs = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
  return prefs.find((m) => MediaRecorder.isTypeSupported(m)) || "";
}

/** Ask for the screen and start recording for the given composer. */
export async function startRecording(target: string): Promise<void> {
  const st = useStore.getState();
  if (st.recording) return;
  if (!canRecord()) {
    st.toast("Screen recording isn't available in this browser — try Chrome or Edge.", "error");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 30 } },
      audio: false,
      // Chrome: open the picker on this tab, keep the dialog short
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      surfaceSwitching: "exclude",
      monitorTypeSurfaces: "include",
    } as DisplayMediaStreamOptions);
  } catch {
    // the user dismissed the picker
    return;
  }
  chunks = [];
  const mimeType = pickMime();
  try {
    recorder = new MediaRecorder(stream, { mimeType: mimeType || undefined, videoBitsPerSecond: 2_200_000 });
  } catch {
    recorder = new MediaRecorder(stream);
  }
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => void finish(target);
  // the browser's own "Stop sharing" ends the track
  stream.getVideoTracks()[0].addEventListener("ended", () => stopRecording());
  recorder.start(1000);
  // browse while recording: clicks reach the page instead of dropping pins
  restore = { mode: st.mode };
  useStore.setState({ recording: { target, startedAt: Date.now() }, mode: st.mode === "comment" ? "browse" : st.mode, hover: null });
  timer = setTimeout(() => stopRecording(), MAX_SECONDS * 1000);
}

export function stopRecording(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (recorder && recorder.state !== "inactive") recorder.stop();
  else cleanup();
}

/** Throw the clip away (Esc / cancel). */
export function cancelRecording(): void {
  if (recorder) recorder.onstop = () => cleanup();
  stopRecording();
  useStore.getState().toast("Recording discarded.");
}

function cleanup() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  recorder = null;
  chunks = [];
  const mode = restore?.mode;
  restore = null;
  useStore.setState((s) => ({ recording: null, mode: mode && s.mode === "browse" ? mode : s.mode }));
}

async function finish(target: string) {
  const st = useStore.getState();
  const startedAt = st.recording?.startedAt ?? Date.now();
  const duration = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  const settings = stream?.getVideoTracks()[0]?.getSettings();
  const type = (recorder?.mimeType || chunks[0]?.type || "video/webm").split(";")[0];
  const blob = new Blob(chunks, { type });
  cleanup();
  if (!blob.size) return st.toast("The recording came out empty — try again.", "error");
  const reviewId = st.review?.id;
  if (!reviewId) return;
  useStore.setState({ uploading: { target, progress: 0 } });
  try {
    const res = await fetch(`/api/reviews/${reviewId}/recordings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, size: blob.size }),
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Couldn't prepare the upload.");
    const { id, uploadUrl, headers, url } = (await res.json()) as { id: string; uploadUrl: string; headers: Record<string, string>; url: string };
    await putWithProgress(uploadUrl, headers, blob, (p) => useStore.setState({ uploading: { target, progress: p } }));
    const attachment: Attachment = {
      id,
      name: `recording-${new Date(startedAt).toISOString().slice(0, 19).replace(/[T:]/g, "-")}.${type.includes("mp4") ? "mp4" : "webm"}`,
      url,
      kind: "video",
      duration,
      size: blob.size,
      w: settings?.width,
      h: settings?.height,
    };
    useStore.setState({ uploading: null, pendingRecording: { target, attachment } });
  } catch (e) {
    useStore.setState({ uploading: null });
    st.toast((e as Error).message || "Couldn't upload the recording.", "error");
  }
}

function putWithProgress(url: string, headers: Record<string, string>, blob: Blob, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    if (url.startsWith("/")) xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error("Upload failed — check your connection and try again."));
    xhr.send(blob);
  });
}

/** Elapsed seconds as m:ss. */
export function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
