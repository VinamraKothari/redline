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

  // ── Same-origin routing ──────────────────────────────────────────────────
  // The document runs on the Redline origin (no <base>), so the site's own
  // scripts resolve relative URLs against us and absolute site URLs would hit
  // CORS. Route GET fetch()/XHR aimed at the site through the proxy. Scripts,
  // images and other elements are handled by the proxy rewrite + src/proxy.ts.
  const appOrigin = location.origin;
  let siteOrigin = "";
  try {
    siteOrigin = new URL(finalUrl).origin;
  } catch {
    /* ignore */
  }
  const proxied = (u: string): string => `${appOrigin}/api/proxy?url=${encodeURIComponent(u)}`;
  /** Absolute site URL for a request, or null if it should be left alone. */
  const siteUrlFor = (raw: string): string | null => {
    let u: URL;
    try {
      u = new URL(raw, document.baseURI);
    } catch {
      return null;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.origin === appOrigin) {
      // our own endpoints stay ours; anything else was meant for the site
      if (u.pathname.startsWith("/api/proxy") || u.pathname === "/bridge.js") return null;
      return siteOrigin ? siteOrigin + u.pathname + u.search : null;
    }
    return u.toString();
  };

  if (siteOrigin) {
    // Every method: sites search, add to cart and talk GraphQL with POST as
    // much as they GET; the proxy forwards method, body and headers.
    const nativeFetch = window.fetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      try {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const target = siteUrlFor(raw);
        if (target) {
          const req = input instanceof Request ? new Request(proxied(target), input) : proxied(target);
          // the site's own cookies never travel anyway; drop credential modes that would trip CORS logic
          const next: RequestInit = { ...(init || {}) };
          if (next.credentials === "include") next.credentials = "same-origin";
          if (next.mode === "no-cors") delete next.mode;
          return nativeFetch.call(window, req, next);
        }
      } catch {
        /* fall through */
      }
      return nativeFetch.call(window, input, init);
    };

    const xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      let u: string | URL = url;
      try {
        const target = siteUrlFor(String(url));
        if (target) u = proxied(target);
      } catch {
        /* ignore */
      }
      return (xhrOpen as unknown as (...a: unknown[]) => void).apply(this, [method, u, ...rest]);
    } as typeof XMLHttpRequest.prototype.open;

    if (navigator.sendBeacon) {
      const beacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
        try {
          const target = siteUrlFor(String(url));
          return beacon(target ? proxied(target) : url, data);
        } catch {
          return beacon(url, data);
        }
      };
    }

  }

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
  // If a client-side framework still throws after hydration and replaces the
  // whole document with an error screen (Next.js: <html id="__next_error__">),
  // the server-rendered markup was fine — the host reloads with scripts
  // stripped so the reviewer at least gets the static render.
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
