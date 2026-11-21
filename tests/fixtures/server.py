#!/usr/bin/env python3
"""
Fixture site for the end-to-end tests. Standard library only.

Serves this directory exactly like `python3 -m http.server <port>` does (same
root, same directory listings, same content types), so every static fixture
keeps working — and adds a small site behind a login, the way real sites
build them:

  GET  /account        302 → /login?next=/account without a session, else
                       200 "Welcome back, Priya"
  GET  /login          classic <form method="post"> (email + password); sets a
                       csrf cookie the POST must echo
  POST /login          password "secret" → fx_session cookie + 302 /account;
                       anything else → 401 with the form and "Wrong password"
  GET  /login-js       the same login as a script-driven form: preventDefault,
                       fetch("/api/login") and then
                       window.location.href = "<absolute>/account" — what
                       NextAuth does
  POST /api/login      JSON {email, password} → sets the cookie, answers {url}
  GET  /forbidden      403 with a bare HTML body (no login form)
  GET  /whoami         {"session": true|false} — what the server sees
  GET  /headers        {"headers": {...}} — the request headers as received
  GET  /prevent-default-form
                       a form whose page handler calls preventDefault() and
                       never submits — the bridge must leave it alone
  GET  /account/overview
                       a page under a prefix Redline also uses (no login): an
                       <img>, a CSS-masked icon and a stylesheet, both in the
                       HTML and added by script with root-relative URLs, plus
                       a /_next/static chunk in the HTML and one loaded later —
                       the way a hydrated Next.js page has them
  GET  /pricing        the images and icons, at exactly one of Redline's own
                       routes; with ?self=1 the page moves its address onto
                       /pricing with history.replaceState (what Next.js does
                       when it restores its canonical URL)
  GET  /account/style.css, /account/js-style.css, /images/pic.png,
  GET  /images/ui/icon.svg, /_next/static/chunks/fixture-{main,lazy}.js
                       the assets those pages use

Usage: python3 server.py [port]   (default 3999)
"""
import json
import secrets
import struct
import sys
import zlib
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

PASSWORD = "secret"
SESSION_COOKIE = "fx_session"
CSRF_COOKIE = "fx_csrf"

PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{title}</title>
<style>body{{font:16px/1.5 system-ui,sans-serif;margin:0;padding:48px;color:#1c1b18}}
form{{display:grid;gap:12px;max-width:320px}}label{{display:grid;gap:4px;font-size:13px}}
input{{font:inherit;padding:8px 10px;border:1px solid #c9c5bb;border-radius:6px}}
button{{font:inherit;padding:9px 14px;border:0;border-radius:6px;background:#1c1b18;color:#fff}}
.err{{color:#c0392b;font-weight:600}}</style></head><body>{body}</body></html>"""


def solid_png(w, h, rgb):
    """A w×h PNG in one colour (stdlib only)."""
    row = b"\x00" + bytes(rgb) * w
    chunk = lambda kind, data: struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(row * h)) + chunk(b"IEND", b"")


PIC_PNG = solid_png(48, 32, (37, 99, 235))
ICON_SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9"/></svg>'
ACCOUNT_CSS = b"h1{color:rgb(5, 120, 85)}.css-bg{width:48px;height:32px;background:url(/images/pic.png)}"
ACCOUNT_JS_CSS = b".js-bg{width:48px;height:32px;background:url(/images/pic.png)}"
MASK = "center / contain no-repeat"


def asset_page(heading, self_path=None, next_app=False):
    """Product image, mask icon and stylesheet: once in the HTML, once added by script."""
    move = f'history.replaceState(null, "", "{self_path}");' if self_path else ""
    return (
        '<link rel="stylesheet" href="/account/style.css">'
        "<style>.icon{display:inline-block;width:20px;height:20px;background:#000}</style>"
        f"<h1>{heading}</h1>"
        '<p><img id="static-img" src="/images/pic.png" alt="Static product" width="48" height="32"> '
        f'<span id="static-icon" class="icon" style="mask: url(\'/images/ui/icon.svg\') {MASK}"></span></p>'
        '<div id="static-bg" class="css-bg"></div>'
        '<div id="app"></div>'
        + ('<script src="/_next/static/chunks/fixture-main.js"></script>' if next_app else "")
        + "<script>"
        f"{move}"
        'const app = document.getElementById("app");'
        'const img = document.createElement("img"); img.id = "js-img"; img.alt = "Sample diamond"; img.width = 48; img.height = 32; img.src = "/images/pic.png"; app.append(img);'
        'const icon = document.createElement("span"); icon.id = "js-icon"; icon.className = "icon";'
        f' icon.style.mask = \'url("/images/ui/icon.svg") {MASK}\'; app.append(icon);'
        + (
            # what a framework loads after start-up: a stylesheet under /account/… and a lazy chunk
            'const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "/account/js-style.css"; document.head.append(link);'
            'const bg = document.createElement("div"); bg.id = "js-bg"; bg.className = "js-bg"; app.append(bg);'
            'const s = document.createElement("script"); s.src = "/_next/static/chunks/fixture-lazy.js"; document.head.append(s);'
            if next_app
            else ""
        )
        + "</script>"
    )


def login_form(action, error="", js=False, csrf=None):
    err = f'<p class="err" data-testid="login-error">{error}</p>' if error else ""
    attrs = "" if js else f'method="post" action="{action}"'
    hidden = f'<input type="hidden" name="csrf" value="{csrf}">' if csrf else ""
    return (
        f"<h1>Sign in</h1>{err}"
        f'<form id="login" {attrs}>{hidden}'
        '<label>E-mail <input name="email" type="email" value="priya@example.test"></label>'
        '<label>Password <input name="password" type="password"></label>'
        '<button type="submit">Sign in</button></form>'
    )


class Handler(SimpleHTTPRequestHandler):
    """Static files as http.server serves them; a few dynamic routes on top."""

    server_version = "RedlineFixture/1"

    # ── helpers ───────────────────────────────────────────────────────────
    def cookies(self):
        c = SimpleCookie()
        c.load(self.headers.get("Cookie", ""))
        return {k: v.value for k, v in c.items()}

    def signed_in(self):
        return self.cookies().get(SESSION_COOKIE) == "ok"

    def send_page(self, status, body, title="Fixture", extra_headers=()):
        data = PAGE.format(title=title, body=body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in extra_headers:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, status, obj, extra_headers=()):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in extra_headers:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def send_bytes(self, data, content_type):
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def redirect(self, location, extra_headers=()):
        self.send_response(HTTPStatus.FOUND)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        for k, v in extra_headers:
            self.send_header(k, v)
        self.end_headers()

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def absolute(self, path):
        # the Host the client used, so the JS login redirects to an absolute URL on this origin
        return f"http://{self.headers.get('Host') or 'localhost:3999'}{path}"

    def csrf_cookie(self):
        token = secrets.token_hex(8)
        return token, (f"{CSRF_COOKIE}={token}; Path=/; SameSite=Lax")

    @staticmethod
    def session_cookie():
        return f"{SESSION_COOKIE}=ok; Path=/; HttpOnly"

    # ── routes ────────────────────────────────────────────────────────────
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/account":
            if not self.signed_in():
                return self.redirect("/login?next=/account")
            return self.send_page(HTTPStatus.OK, "<h1>Account</h1><p data-testid=\"welcome\">Welcome back, Priya</p>", "Account")
        if path == "/login":
            token, set_cookie = self.csrf_cookie()
            return self.send_page(HTTPStatus.OK, login_form("/login", csrf=token), "Sign in", [("Set-Cookie", set_cookie)])
        if path == "/login-js":
            token, set_cookie = self.csrf_cookie()
            body = login_form("", js=True) + (
                "<script>"
                'document.getElementById("login").addEventListener("submit", async (e) => {'
                "  e.preventDefault();"
                "  const f = new FormData(e.target);"
                '  const res = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json", "x-csrf": %r },'
                '    body: JSON.stringify({ email: f.get("email"), password: f.get("password") }) });'
                "  const data = await res.json();"
                '  if (!res.ok) { document.querySelector("h1").insertAdjacentHTML("afterend", \'<p class="err" data-testid="login-error">\' + data.error + "</p>"); return; }'
                "  window.location.href = data.url;"
                "});"
                "</script>"
            ) % token
            return self.send_page(HTTPStatus.OK, body, "Sign in", [("Set-Cookie", set_cookie)])
        if path == "/prevent-default-form":
            body = (
                '<h1>Search</h1><form id="search"><input name="q" value="hello"><button type="submit">Go</button></form>'
                '<p data-testid="result"></p>'
                '<script>document.getElementById("search").addEventListener("submit", (e) => { e.preventDefault();'
                ' document.querySelector("[data-testid=result]").textContent = "handled by the page: " + new FormData(e.target).get("q"); });</script>'
            )
            return self.send_page(HTTPStatus.OK, body, "Search")
        if path == "/account/overview":
            return self.send_page(HTTPStatus.OK, asset_page("Account overview", next_app=True), "Account overview")
        if path == "/pricing":
            moves = parse_qs(urlsplit(self.path).query).get("self") == ["1"]
            return self.send_page(HTTPStatus.OK, asset_page("Pricing", "/pricing" if moves else None), "Pricing")
        if path in ("/_next/static/chunks/fixture-main.js", "/_next/static/chunks/fixture-lazy.js"):
            key = "main" if path.endswith("main.js") else "lazy"
            return self.send_bytes(f'document.documentElement.dataset.{key} = "1";'.encode(), "application/javascript")
        if path == "/account/style.css":
            return self.send_bytes(ACCOUNT_CSS, "text/css")
        if path == "/account/js-style.css":
            return self.send_bytes(ACCOUNT_JS_CSS, "text/css")
        if path == "/images/pic.png":
            return self.send_bytes(PIC_PNG, "image/png")
        if path == "/images/ui/icon.svg":
            return self.send_bytes(ICON_SVG, "image/svg+xml")
        if path == "/forbidden":
            # a bare refusal without a login form — the proxy shows its own explanation for these
            return self.send_page(HTTPStatus.FORBIDDEN, "<h1>Forbidden</h1>", "Forbidden")
        if path == "/whoami":
            return self.send_json(HTTPStatus.OK, {"session": self.signed_in()})
        if path == "/headers":
            # what the site sees — the proxy must never pass Redline's hop-by-hop headers or cookies on
            return self.send_json(HTTPStatus.OK, {"headers": {k.lower(): v for k, v in self.headers.items()}})
        return super().do_GET()

    def do_POST(self):
        path = urlsplit(self.path).path
        raw = self.body()
        if path == "/login":
            fields = {k: v[0] for k, v in parse_qs(raw.decode(errors="replace")).items()}
            token, set_cookie = self.csrf_cookie()
            if fields.get("csrf") != self.cookies().get(CSRF_COOKIE):
                return self.send_page(HTTPStatus.FORBIDDEN, login_form("/login", "Session expired — try again", csrf=token), "Sign in", [("Set-Cookie", set_cookie)])
            if fields.get("password") != PASSWORD:
                return self.send_page(HTTPStatus.UNAUTHORIZED, login_form("/login", "Wrong password", csrf=token), "Sign in", [("Set-Cookie", set_cookie)])
            next_path = parse_qs(urlsplit(self.path).query).get("next", ["/account"])[0]
            return self.redirect(next_path if next_path.startswith("/") else "/account", [("Set-Cookie", self.session_cookie())])
        if path == "/api/login":
            try:
                data = json.loads(raw or b"{}")
            except ValueError:
                data = {}
            if self.headers.get("x-csrf") != self.cookies().get(CSRF_COOKIE):
                return self.send_json(HTTPStatus.FORBIDDEN, {"error": "Session expired — try again"})
            if data.get("password") != PASSWORD:
                return self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Wrong password"})
            return self.send_json(HTTPStatus.OK, {"url": self.absolute("/account")}, [("Set-Cookie", self.session_cookie())])
        # everything else: what http.server answers when it has no do_POST (fixtures rely on the 501)
        self.send_error(HTTPStatus.NOT_IMPLEMENTED, "Unsupported method ('POST')")

    def log_message(self, fmt, *args):
        # same format as http.server, but never a cookie value
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3999
    with ThreadingHTTPServer(("", port), Handler) as httpd:
        print(f"Serving fixtures on port {port} (http.server + login flow)", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
