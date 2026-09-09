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
  // The document runs on the Redline origin, so the site's own scripts see a
  // foreign origin: relative API calls hit us, absolute ones hit CORS, and
  // framework chunk loaders fall over. Route GET traffic aimed at the site
  // (absolute, or relative to our origin) through the proxy instead.
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
    const nativeFetch = window.fetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      try {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
        if (method === "GET" || method === "HEAD") {
          const target = siteUrlFor(raw);
          if (target) {
            const req = input instanceof Request ? new Request(proxied(target), input) : proxied(target);
            return nativeFetch.call(window, req, init);
          }
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
        if (/^(GET|HEAD)$/i.test(method)) {
          const target = siteUrlFor(String(url));
          if (target) u = proxied(target);
        }
      } catch {
        /* ignore */
      }
      return (xhrOpen as unknown as (...a: unknown[]) => void).apply(this, [method, u, ...rest]);
    } as typeof XMLHttpRequest.prototype.open;

    // Dynamically inserted <script src> / <link href> (webpack/vite chunk loaders).
    const hookUrlProp = (proto: object, prop: string) => {
      const desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (!desc?.set || !desc.get) return;
      Object.defineProperty(proto, prop, {
        configurable: true,
        get() {
          return desc.get!.call(this);
        },
        set(v: string) {
          try {
            const target = siteUrlFor(String(v));
            if (target) v = proxied(target);
          } catch {
            /* ignore */
          }
          desc.set!.call(this, v);
        },
      });
    };
    hookUrlProp(HTMLScriptElement.prototype, "src");
    hookUrlProp(HTMLLinkElement.prototype, "href");
    const setAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name: string, value: string) {
      try {
        const n = name.toLowerCase();
        if ((n === "src" && this instanceof HTMLScriptElement) || (n === "href" && this instanceof HTMLLinkElement)) {
          const target = siteUrlFor(String(value));
          if (target) value = proxied(target);
        }
      } catch {
        /* ignore */
      }
      return setAttr.call(this, name, value);
    };
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
