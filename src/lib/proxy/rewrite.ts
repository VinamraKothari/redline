import * as cheerio from "cheerio";

/**
 * HTML / CSS rewriting for the same-origin proxy.
 *
 * Goals:
 *  - relative URLs keep resolving against the original site (<base>)
 *  - stylesheets + everything they reference (fonts, images) come through the
 *    proxy so CORS-restricted assets still load under our origin
 *  - frame-blocking and CSP directives are removed
 *  - a small bridge script is injected first so it runs before page scripts
 */

/**
 * Absolute URL back into the proxy. Must be absolute: the injected <base href>
 * would otherwise make a root-relative "/api/proxy" resolve against the
 * original site.
 */
export function proxyUrl(absolute: string, appOrigin: string): string {
  return `${appOrigin}/api/proxy?url=${encodeURIComponent(absolute)}`;
}

function resolve(base: string, ref: string): string | null {
  const r = ref.trim();
  if (!r || /^(data|blob|about|javascript|mailto|tel|#)/i.test(r)) return null;
  try {
    return new URL(r, base).toString();
  } catch {
    return null;
  }
}

/** Rewrite url(...) and @import in a CSS string so they go through the proxy. */
export function rewriteCss(css: string, cssUrl: string, appOrigin: string): string {
  // @import "x" / @import 'x'  (url() form handled by the url() regex)
  let out = css.replace(/@import\s+(['"])([^'"]+)\1/g, (m, q, ref) => {
    const abs = resolve(cssUrl, ref);
    return abs ? `@import ${q}${proxyUrl(abs, appOrigin)}${q}` : m;
  });
  out = out.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, ref) => {
    const abs = resolve(cssUrl, ref);
    return abs ? `url(${q}${proxyUrl(abs, appOrigin)}${q})` : m;
  });
  return out;
}

/** Path (+query) of `abs` when it lives on the reviewed site's origin, else null. */
function sameOriginPath(abs: string, pageUrl: string): string | null {
  try {
    const a = new URL(abs);
    const p = new URL(pageUrl);
    return a.origin === p.origin ? a.pathname + a.search : null;
  } catch {
    return null;
  }
}

const REL_THROUGH_PROXY = new Set(["stylesheet", "preload", "modulepreload", "icon", "shortcut icon", "apple-touch-icon", "manifest"]);

export interface RewriteOptions {
  /** the final URL after redirects; used as <base> */
  finalUrl: string;
  /** original requested URL (shown to the bridge) */
  requestedUrl: string;
  /** origin of the Redline app, e.g. https://redline.vercel.app */
  appOrigin: string;
  /**
   * Static render: drop the page's own scripts. Used when a site's client-side
   * app (Next.js, Nuxt, …) crashes inside the reviewer and replaces the
   * server-rendered document with an error screen.
   */
  stripScripts?: boolean;
}

export function rewriteHtml(html: string, opts: RewriteOptions): string {
  const $ = cheerio.load(html);
  const base = opts.finalUrl;
  const origin = opts.appOrigin;

  // 0. Static mode: remove scripts, script preloads and inline handlers;
  //    surface <noscript> fallbacks (lazy images, etc.) as real content.
  if (opts.stripScripts) {
    $("script").remove();
    $("link[rel='modulepreload'], link[rel='preload'][as='script'], link[rel='prefetch']").remove();
    $("noscript").each((_, el) => {
      $(el).replaceWith($(el).text());
    });
    $("*").each((_, el) => {
      const attrs = (el as { attribs?: Record<string, string> }).attribs;
      if (!attrs) return;
      for (const name of Object.keys(attrs)) if (name.startsWith("on")) $(el).removeAttr(name);
    });
    $("html").attr("data-redline-static", "1");
  }

  // 1. Remove things that would break framing or block our injected assets.
  $("meta[http-equiv]").each((_, el) => {
    const v = ($(el).attr("http-equiv") || "").toLowerCase();
    if (v === "content-security-policy" || v === "x-frame-options") $(el).remove();
  });
  // Our same-origin asset routing (src/proxy.ts) relies on the Referer.
  $("meta[name='referrer']").remove();
  $("[referrerpolicy]").removeAttr("referrerpolicy");
  $("base").remove();
  const head = $("head").length ? $("head") : $("html").prepend("<head></head>").find("head");

  // 2. No <base>: URLs are made absolute here instead, so that root-relative
  //    script paths keep resolving on *this* origin (see step 5).
  const absolutize = (selector: string, attr: string) => {
    $(selector).each((_, el) => {
      const v = $(el).attr(attr);
      if (!v) return;
      const abs = resolve(base, v);
      if (abs && abs !== v) $(el).attr(attr, abs);
    });
  };
  const absolutizeSrcset = (selector: string) => {
    $(selector).each((_, el) => {
      const v = $(el).attr("srcset");
      if (!v) return;
      $(el).attr(
        "srcset",
        v
          .split(",")
          .map((part) => {
            const [u, ...rest] = part.trim().split(/\s+/);
            const abs = u ? resolve(base, u) : null;
            return [abs || u, ...rest].join(" ");
          })
          .join(", "),
      );
    });
  };
  absolutize("a[href], area[href]", "href");
  absolutize("img[src], source[src], video[src], audio[src], track[src], iframe[src], embed[src], input[type='image'][src]", "src");
  absolutize("video[poster]", "poster");
  absolutize("object[data]", "data");
  absolutize("form[action]", "action");
  absolutize("use[href], image[href]", "href");
  absolutizeSrcset("img[srcset], source[srcset]");

  // 3. Stylesheets / preloads / icons through the proxy (CSS gets rewritten
  //    so fonts and images referenced from it load under our origin too).
  $("link[href]").each((_, el) => {
    const rel = ($(el).attr("rel") || "").toLowerCase().trim();
    const as = ($(el).attr("as") || "").toLowerCase();
    const abs = resolve(base, $(el).attr("href")!);
    if (!abs) return;
    if (REL_THROUGH_PROXY.has(rel) || (rel === "preload" && (as === "font" || as === "style" || as === "fetch"))) {
      $(el).attr("href", proxyUrl(abs, origin));
      $(el).removeAttr("integrity");
      $(el).removeAttr("crossorigin");
    } else if (rel === "preload" || rel === "modulepreload") {
      // script preloads: keep them same-origin like the scripts themselves
      $(el).attr("href", sameOriginPath(abs, base) ?? abs);
      $(el).removeAttr("integrity");
      $(el).removeAttr("crossorigin");
    } else {
      $(el).attr("href", abs);
    }
  });

  // 4. Inline <style> blocks and style="" attributes.
  $("style").each((_, el) => {
    const css = $(el).html();
    if (css) $(el).html(rewriteCss(css, base, origin));
  });
  $("[style]").each((_, el) => {
    const s = $(el).attr("style")!;
    if (s.includes("url(")) $(el).attr("style", rewriteCss(s, base, origin));
  });

  // 5. Scripts: the site's own scripts keep a ROOT-RELATIVE src, which now
  //    resolves on this origin and is routed to the proxy by src/proxy.ts.
  //    That keeps them same-origin (readable errors, no CORS) while leaving
  //    the `src` attribute exactly as bundlers expect — Turbopack identifies
  //    each chunk by the literal "/_next/…" attribute and silently never
  //    starts the app if it's changed. Third-party scripts stay where they are.
  if (!opts.stripScripts) {
    $("script[src]").each((_, el) => {
      const abs = resolve(base, $(el).attr("src")!);
      if (!abs || !/^https?:/i.test(abs)) return;
      $(el).attr("src", sameOriginPath(abs, base) ?? abs);
      $(el).removeAttr("integrity");
      $(el).removeAttr("crossorigin");
    });
  }
  $("script[integrity], link[integrity]").removeAttr("integrity");
  $("img[crossorigin], script[crossorigin], video[crossorigin], audio[crossorigin]").removeAttr("crossorigin");

  // 6. Consent managers in "auto-blocking" mode hold back scripts they don't
  //    recognise until consent is given — on a domain they have never scanned
  //    (ours) that includes the page's own inline framework payloads, so
  //    Next.js/React can't hydrate ("missing bootstrap script"). Keep the
  //    banner, drop the blocking.
  $("script[data-blockingmode]").attr("data-blockingmode", "manual");
  $("script[src]").each((_, el) => {
    const src = ($(el).attr("src") || "").toLowerCase();
    if (/otautoblock|\/privacy-proxy\b|smart-data-protector|autoblock(ing)?\.js/.test(src)) $(el).remove();
  });

  // 7. Neutralise frame busting via target.
  $("a[target='_top'], a[target='_parent'], form[target='_top'], form[target='_parent']").removeAttr("target");

  // 8. Inject the bridge first thing in <head>.
  head.prepend(
    `<script src="${origin}/bridge.js" data-redline-url="${opts.requestedUrl.replace(/"/g, "&quot;")}" data-redline-final="${base.replace(/"/g, "&quot;")}"></script>`,
  );
  // Mark the document so the host can recognise a proxied page.
  $("html").attr("data-redline", "1");

  return $.html();
}

/** Pick the charset from a Content-Type header or a <meta> tag in the first bytes. */
export function detectCharset(contentType: string | null, bytes: Uint8Array): string {
  const m = contentType?.match(/charset=["']?([\w-]+)/i);
  if (m) return m[1].toLowerCase();
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  const meta = head.match(/<meta[^>]+charset=["']?([\w-]+)/i);
  return meta ? meta[1].toLowerCase() : "utf-8";
}

export function decodeBody(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
