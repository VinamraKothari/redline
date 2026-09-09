/**
 * Redline bridge — injected as the first script of every proxied page.
 * Runs inside the iframe (same origin as the host app). Keeps the page
 * well-behaved inside the review canvas and reports navigation intents.
 *
 * Built to /public/bridge.js by `npm run build:bridge` (esbuild, IIFE).
 */
(() => {
  const w = window as Window & { __redline?: unknown };
  if (w.__redline) return;

  const script = document.currentScript as HTMLScriptElement | null;
  const originalUrl = script?.dataset.redlineUrl || "";
  const finalUrl = script?.dataset.redlineFinal || originalUrl;
  w.__redline = { originalUrl, finalUrl, version: 1 };

  const post = (msg: Record<string, unknown>) => {
    try {
      window.parent.postMessage({ __redline: true, ...msg }, "*");
    } catch {
      /* ignore */
    }
  };

  // ── Keep the page from escaping or hijacking the host origin ─────────────
  try {
    if ("serviceWorker" in navigator) {
      Object.defineProperty(navigator.serviceWorker, "register", {
        value: () => Promise.reject(new Error("blocked by Redline")),
        configurable: true,
      });
    }
  } catch {
    /* ignore */
  }
  // Blocking dialogs would freeze the review canvas.
  window.alert = (m?: unknown) => console.log("[page alert]", m);
  window.confirm = () => false;
  window.prompt = () => null;
  window.open = (url?: string | URL) => {
    if (url) post({ type: "navigate", url: new URL(String(url), finalUrl).toString(), popup: true });
    return null;
  };
  window.print = () => {};

  // Frame-busting: many scripts do `if (top !== self) top.location = self.location`.
  // The iframe sandbox blocks top navigation; we just swallow the resulting errors.
  window.addEventListener("error", (e) => {
    if (/top\.location|parent\.location/.test(String(e.message))) e.preventDefault();
  });

  // ── Navigation intents ───────────────────────────────────────────────────
  document.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("href") || "";
      if (!href || href.startsWith("#") || /^(javascript|mailto|tel):/i.test(href)) return;
      let abs: string;
      try {
        abs = new URL(href, finalUrl).toString();
      } catch {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      post({ type: "navigate", url: abs, newTab: a.target === "_blank" });
    },
    true,
  );

  document.addEventListener(
    "submit",
    (e) => {
      const form = e.target as HTMLFormElement;
      const method = (form.getAttribute("method") || "get").toLowerCase();
      if (method === "get") {
        e.preventDefault();
        const action = form.getAttribute("action") || finalUrl;
        const url = new URL(action, finalUrl);
        const fd = new FormData(form);
        fd.forEach((v, k) => url.searchParams.set(k, String(v)));
        post({ type: "navigate", url: url.toString() });
      } else {
        e.preventDefault();
        post({ type: "blocked-submit" });
      }
    },
    true,
  );

  // ── Crash detection ──────────────────────────────────────────────────────
  // Client-side frameworks (Next.js App Router in particular) may throw after
  // hydration because the location is our proxy URL, then replace the whole
  // document with a "This page couldn't load" screen. The server-rendered
  // markup was fine, so the host reloads the page with scripts stripped.
  let reported = false;
  const root0 = document.documentElement;
  const check = () => {
    if (reported) return;
    const root = document.documentElement;
    const replaced = root !== root0 || !root.hasAttribute("data-redline");
    const nextError = root.id === "__next_error__" || !!document.getElementById("__next_error__");
    if (replaced || nextError) {
      reported = true;
      post({ type: "crashed", reason: nextError ? "next-error" : "document-replaced" });
    }
  };
  const start = Date.now();
  const timer = window.setInterval(() => {
    check();
    if (reported || Date.now() - start > 20_000) window.clearInterval(timer);
  }, 250);

  // Let the host know we're alive as early as possible, and again when ready.
  post({ type: "bridge-hello", url: originalUrl, finalUrl });
  window.addEventListener("DOMContentLoaded", () => post({ type: "dom-ready", title: document.title }));
  window.addEventListener("load", () => {
    post({ type: "load", title: document.title });
    check();
  });
})();
