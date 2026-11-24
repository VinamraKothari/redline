import { expect, test } from "@playwright/test";
import { normalizeText, sanitizeChecked, sanitizeInline, safeHref, MAX_HTML } from "../src/lib/text-edits/sanitize";
import { diffInline, renderChangesHtml, sameCopy, type Segment } from "../src/lib/text-edits/diff";
import { handoffAll, handoffText, toJira, toMarkdown } from "../src/lib/text-edits/format";
import { csvCell } from "../src/lib/export";
import type { TextEdit } from "../src/lib/types";

/**
 * The pure parts of copy edits (src/lib/text-edits): sanitizer, diff and
 * hand-off formats. No browser, no server — just imports and assertions.
 */

const clean = sanitizeInline;

test.describe("sanitizeInline", () => {
  test("keeps the allowed marks and maps b/i to strong/em", () => {
    expect(clean("Hello <b>bold</b> and <i>it</i> and <u>under</u>")).toBe("Hello <strong>bold</strong> and <em>it</em> and <u>under</u>");
    expect(clean("<strong>a</strong><em>b</em>")).toBe("<strong>a</strong><em>b</em>");
    expect(clean('<a href="https://x.test/a?b=1&amp;c=2">link</a>')).toBe('<a href="https://x.test/a?b=1&amp;c=2">link</a>');
    expect(clean("one<br>two<br/>three<BR />four")).toBe("one<br>two<br>three<br>four");
  });

  test("keeps the nesting of the source and merges neighbours with the same marks", () => {
    expect(clean("<b><i>x</i></b>")).toBe("<strong><em>x</em></strong>");
    // order can matter to the site's CSS (an inner class wins), so it is kept
    expect(clean("<i><b>x</b></i>")).toBe("<em><strong>x</strong></em>");
    expect(clean("<b>a</b><b>b</b>")).toBe("<strong>ab</strong>");
    expect(clean("<b>a</b><strong>b</strong>")).toBe("<strong>ab</strong>");
    // an open mark stays open around a nested one
    expect(clean("<b>a <i>b</i> c</b>")).toBe("<strong>a <em>b</em> c</strong>");
    expect(clean("<b>a<b>b</b></b>")).toBe("<strong>ab</strong>");
    // a link of the same address merges, a different one does not
    expect(clean('<a href="/a">x</a><a href="/a">y</a><a href="/b">z</a>')).toBe('<a href="/a">xy</a><a href="/b">z</a>');
  });

  test("removes empty marks", () => {
    expect(clean("a<b></b>b<i> </i>c<u><span></span></u>")).toBe("ab<em> </em>c");
    expect(clean('<a href="https://x.test"></a>text')).toBe("text");
    expect(clean("<strong><em></em></strong>")).toBe("");
  });

  test("drops every other tag and every attribute, keeping the text", () => {
    expect(clean('<span style="font-weight: bold">Hi</span> <font color="red" class="x">there</font>')).toBe("Hi there");
    expect(clean('<b style="color:red" onclick="x()" id="i" data-x="y">B</b>')).toBe("<strong>B</strong>");
    expect(clean('<a href="/x" target="_blank" rel="noopener" onclick="evil()" style="color:red" id="l">L</a>')).toBe('<a href="/x">L</a>');
    expect(clean("<code>c</code><small>s</small><mark>m</mark><s>del</s>")).toBe("csmdel");
  });

  test("contentEditable's spans and divs become plain text and line breaks", () => {
    // what Chrome produces for Enter, an empty line and Shift+Enter
    expect(clean("first<div>second</div><div><br></div><div>fourth</div>")).toBe("first<br>second<br><br>fourth");
    expect(clean("<p>one</p><p>two</p>")).toBe("one<br>two");
    expect(clean("<p>one</p>\n  <p>two</p>\n")).toBe("one<br>two");
    expect(clean('<div><span style="font-size: 16px; letter-spacing: 0.2px;">Sign in</span> today</div>')).toBe("Sign in today");
    expect(clean("<h1>Title</h1>")).toBe("Title");
    expect(clean("<ul><li>a</li><li>b</li></ul>")).toBe("a<br>b");
  });

  test("&nbsp; and entities survive as text, encoded safely", () => {
    expect(clean("a&nbsp;b")).toBe("a&nbsp;b");
    expect(clean("a\u00a0 b")).toBe("a&nbsp; b");
    expect(clean("Tom &amp; Jerry &lt;3 &quot;hi&quot; &#39;x&#39; &#x2014; &hellip; &copy;")).toBe("Tom &amp; Jerry &lt;3 \"hi\" 'x' — … ©");
    expect(clean("1 < 2 > 0")).toBe("1 &lt; 2 &gt; 0");
    expect(clean("&unknownentity; &#0; &#xD800;")).toBe("&amp;unknownentity;  \ufffd");
  });

  test("XSS: images, scripts, styles, svg, iframes and event handlers vanish", () => {
    expect(clean('<img src=x onerror="alert(1)">hello')).toBe("hello");
    expect(clean("<script>alert(1)</script>ok")).toBe("ok");
    expect(clean("<script/>alert(1)</script>ok")).toBe("ok");
    expect(clean("<SCRIPT>document.write('<b>x</b>')</SCRIPT>ok")).toBe("ok");
    expect(clean("<style>body{display:none}</style>ok")).toBe("ok");
    expect(clean('<svg onload="alert(1)"><text>svg text</text><script>alert(2)</script></svg>ok')).toBe("ok");
    // an unclosed <svg> swallows the rest, as it does in a browser (text loose in an SVG isn't shown)
    expect(clean("<svg/onload=alert(1)>ok")).toBe("");
    expect(clean("<svg/>ok")).toBe("ok");
    expect(clean('<iframe src="javascript:alert(1)">inner</iframe>ok')).toBe("ok");
    expect(clean("<math><mi>x</mi></math>ok")).toBe("ok");
    expect(clean("<template><b>t</b></template>ok")).toBe("ok");
    expect(clean("<textarea><b>x</b></textarea>ok")).toBe("ok");
    expect(clean('<b onmouseover="alert(1)">x</b>')).toBe("<strong>x</strong>");
    expect(clean("<<b>>x")).toBe("&lt;<strong>&gt;x</strong>");
    expect(clean("<b>unclosed")).toBe("<strong>unclosed</strong>");
    expect(clean('<a href="x" <img src=x onerror=alert(1)>>y</a>')).not.toMatch(/<img|onerror=/);
  });

  test("XSS: comments, CDATA, doctypes and processing instructions are dropped", () => {
    expect(clean("a<!-- <script>alert(1)</script> -->b")).toBe("ab");
    expect(clean("a<!-- unterminated <b>x</b>")).toBe("a");
    // as in a browser, CDATA in HTML is a bogus comment that ends at the first ">": what follows is inert text
    expect(clean("a<![CDATA[<script>alert(1)</script>]]>b")).toBe("aalert(1)]]&gt;b");
    expect(clean("<!DOCTYPE html>a<?xml version='1.0'?>b")).toBe("ab");
  });

  test("XSS: javascript: and other unsafe link addresses lose the link", () => {
    const unsafe = [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "jav&#x09;ascript:alert(1)",
      "&#106;avascript:alert(1)",
      "&#106avascript:alert(1)",
      "&#x6A;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;&#x3A;alert(1)",
      "javascript&colon;alert(1)",
      "\u0001javascript:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
    ];
    for (const href of unsafe) {
      const out = clean(`<a href="${href.replace(/"/g, "&quot;")}">click</a>`);
      expect(out, href).toBe("click");
    }
    expect(clean("<a>no href</a>")).toBe("no href");
    expect(clean('<a href="">empty</a>')).toBe("empty");
  });

  test("safe link addresses are kept: http(s), mailto, tel, relative paths", () => {
    expect(safeHref("https://x.test/a")).toBe("https://x.test/a");
    expect(safeHref("HTTP://x.test")).toBe("HTTP://x.test");
    expect(safeHref("mailto:hi@x.test")).toBe("mailto:hi@x.test");
    expect(safeHref("tel:+49 30 1234")).toBe("tel:+49 30 1234");
    expect(safeHref("/pricing")).toBe("/pricing");
    expect(safeHref("../a/b")).toBe("../a/b");
    expect(safeHref("#faq")).toBe("#faq");
    expect(safeHref("  /trimmed  ")).toBe("/trimmed");
    expect(safeHref("ftp://x.test")).toBeNull();
    expect(clean('<a href=/pricing>Plans</a>')).toBe('<a href="/pricing">Plans</a>');
    expect(clean(`<a href='/a"b'>q</a>`)).toBe('<a href="/a&quot;b">q</a>');
  });

  test("keeps the site's classes on span, a, strong, em and u", () => {
    expect(clean('<span class="text-brand font-semibold">Sign</span> in')).toBe('<span class="text-brand font-semibold">Sign</span> in');
    expect(clean('<b class="x">B</b><i class="y">I</i><u class="z">U</u><a href="/p" class="link">L</a>')).toBe('<strong class="x">B</strong><em class="y">I</em><u class="z">U</u><a href="/p" class="link">L</a>');
    // Tailwind-style tokens pass; anything else in the list is dropped token by token
    expect(clean('<span class="md:text-[18px] hover:underline w-1/2 bg-[#0f9d76] !mt-0 [&amp;>p]:x">x</span>')).toBe('<span class="md:text-[18px] hover:underline w-1/2 bg-[#0f9d76] !mt-0">x</span>');
    expect(clean('<span class="a a  b\tc">x</span>')).toBe('<span class="a b c">x</span>');
    // a span without a (usable) class is unwrapped; so is contentEditable's style span
    expect(clean('<span>x</span><span class="">y</span><span class="&lt;&gt;">z</span>')).toBe("xyz");
    expect(clean('<span style="font-size:16px" id="q" data-a="b">x</span>')).toBe("x");
    // a link without a safe address keeps its styling as a span
    expect(clean('<a href="javascript:x()" class="btn">Go</a>')).toBe('<span class="btn">Go</span>');
    // never more than 20 tokens or 300 characters
    const many = Array.from({ length: 30 }, (_, i) => `c${i}`).join(" ");
    expect(clean(`<span class="${many}">x</span>`)).toBe(`<span class="${many.split(" ").slice(0, 20).join(" ")}">x</span>`);
    const long = Array.from({ length: 10 }, (_, i) => `${"k".repeat(40)}${i}`).join(" ");
    const kept = /class="([^"]*)"/.exec(clean(`<span class="${long}">x</span>`))![1];
    expect(kept.length).toBeLessThanOrEqual(300);
    expect(kept.split(" ")).toHaveLength(7);
    // identical neighbours merge, a different class doesn't
    expect(clean('<span class="a">x</span><span class="a">y</span><span class="b">z</span>')).toBe('<span class="a">xy</span><span class="b">z</span>');
    expect(clean('<span class="a"><b>x</b></span><span class="a">y</span>')).toBe('<span class="a"><strong>x</strong>y</span>');
  });

  test("a class can never leave its attribute", () => {
    const hostile = [
      '<span class="a&quot; onmouseover=&quot;alert(1)">x</span>',
      '<span class=\'a" onclick="alert(1)\'>x</span>',
      "<span class=a\"onclick=alert(1)>x</span>",
      '<span class="a&gt;&lt;img src=x onerror=alert(1)&gt;">x</span>',
      '<span class="x" class="y onclick=z">x</span>',
      '<b class="`${x}` {{y}} <z>">x</b>',
      '<span class="a&#34;b">x</span>',
    ];
    for (const h of hostile) {
      const out = clean(h);
      expect(out, h).not.toMatch(/onclick|onmouseover|onerror|<img|`|\{/);
      expect(out.match(/class="[^"]*"/g)?.every((c) => /^class="[A-Za-z0-9_\-:/[\]#.%()!,= ]*"$/.test(c)) ?? true, h).toBe(true);
      expect(clean(out)).toBe(out);
    }
  });

  test("lone surrogates become U+FFFD", () => {
    expect(clean("a\ud800b\udc00c")).toBe("a�b�c");
    expect(clean("ok 😀")).toBe("ok 😀");
    expect(normalizeText("x\udbff")).toBe("x�");
  });

  test("hostile input stays fast (linear)", () => {
    const worst = [
      " <br>".repeat(4000),
      "<span class=a>x".repeat(3000),
      "</a".repeat(5000),
      "<b>".repeat(6000) + "x" + "</b>".repeat(6000),
      "<b><span class=c>a</span></b>".repeat(800),
      "&amp;".repeat(4000),
      "a ".repeat(10_000),
    ];
    for (const w of worst) {
      const t = performance.now();
      const out = clean(w);
      const ms = performance.now() - t;
      expect(ms, `${w.slice(0, 20)}… took ${ms.toFixed(1)} ms`).toBeLessThan(50);
      expect(out.length).toBeLessThanOrEqual(MAX_HTML);
      expect(clean(out)).toBe(out);
    }
    // the raw limit the API accepts (200 000 characters), cut to 20 000
    for (const w of [" <br>".repeat(40_000), '<span class="w">word</span> '.repeat(7000), "<i>".repeat(66_000)]) {
      const t = performance.now();
      const { html, truncated } = sanitizeChecked(w);
      expect(performance.now() - t).toBeLessThan(400);
      expect(html.length).toBeLessThanOrEqual(MAX_HTML);
      expect(truncated).toBe(w.startsWith("<i>") ? false : true);
    }
  });

  test("is idempotent", () => {
    const inputs = [
      "Hello <b>bold</b> <i>it</i> <u>u</u> <a href='/x'>l</a>",
      "<b><i>x</i></b> y <i><b>z</b></i>",
      "first<div>second</div><div><br></div><div>fourth</div>",
      "a&nbsp;&nbsp;b &amp; &lt;c&gt;",
      "<b>a <i>b</i> c</b><br><u>d</u>",
      "<em>a</em><br><strong>b</strong><br>",
      "  leading <b> </b>and<i> </i> trailing  ",
      '<a href="/a"><b>x</b>y</a><b>z</b>',
      "<p> one </p> <p> two </p>",
      "<script>x</script><img src=x onerror=y><svg><b>s</b></svg>ok",
      "<b>a<br>b</b>",
      "<br><br>x<br><br>",
      '<span class="a"><b class="b">x</b> y</span><i><span class="a">z</span></i>',
      '<a href="/a" class="l"><span class="s">x</span></a><a href="/b">y</a>',
    ];
    for (const x of inputs) {
      const once = clean(x);
      expect(clean(once), x).toBe(once);
    }
  });

  test("caps the length", () => {
    const long = "word ".repeat(10_000);
    const out = clean(long);
    expect(out.length).toBeLessThanOrEqual(MAX_HTML);
    expect(clean(out)).toBe(out);
    const amps = clean("&".repeat(MAX_HTML));
    expect(amps.length).toBeLessThanOrEqual(MAX_HTML);
    expect(amps.length).toBeGreaterThan(MAX_HTML - 5);
  });

  test("normalizeText collapses whitespace and line breaks", () => {
    expect(normalizeText("  Log&nbsp;in <b>to</b>\n view<br>your   orders ")).toBe("Log in to view your orders");
    expect(normalizeText("<script>x</script>")).toBe("");
    expect(normalizeText("a&amp;b")).toBe("a&b");
  });
});

const kinds = (segs: Segment[]) => segs.map((s) => `${s.kind[0]}:${s.text}`);

test.describe("diffInline", () => {
  test("identical copy is all equal", () => {
    expect(diffInline("Log in to view", "Log in to view")).toEqual([{ kind: "equal", text: "Log in to view", marks: [] }]);
    expect(diffInline("<b>a</b> b", "<strong>a</strong> b")).toEqual([
      { kind: "equal", text: "a", marks: ["strong"] },
      { kind: "equal", text: " b", marks: [] },
    ]);
  });

  test("word insert, delete and replace", () => {
    expect(kinds(diffInline("view your orders", "view all your orders"))).toEqual(["e:view ", "i:all ", "e:your orders"]);
    expect(kinds(diffInline("view all your orders", "view your orders"))).toEqual(["e:view ", "d:all ", "e:your orders"]);
    expect(kinds(diffInline("Log in to view your orders", "Sign in to view your orders"))).toEqual(["d:Log", "i:Sign", "e: in to view your orders"]);
    // a lone space between two changes joins them into one replacement
    expect(kinds(diffInline("Log in to view", "Sign up to view"))).toEqual(["d:Log in", "i:Sign up", "e: to view"]);
  });

  test("punctuation is its own token", () => {
    expect(kinds(diffInline("Hello world.", "Hello world!"))).toEqual(["e:Hello world", "d:.", "i:!"]);
    expect(kinds(diffInline("Don't stop", "Don't stop now"))).toEqual(["e:Don't stop", "i: now"]);
  });

  test("a whitespace-only change is no change", () => {
    expect(kinds(diffInline("a  b", "a b"))).toEqual(["e:a b"]);
    expect(kinds(diffInline("a&nbsp;b", "a b"))).toEqual(["e:a b"]);
    expect(kinds(diffInline("a\n   b", "a b"))).toEqual(["e:a b"]);
  });

  test("a formatting-only change is equal with prevMarks", () => {
    const segs = diffInline("Sign in now", "<b>Sign in</b> now");
    expect(segs).toEqual([
      { kind: "equal", text: "Sign in", marks: ["strong"], prevMarks: [] },
      { kind: "equal", text: " now", marks: [] },
    ]);
    const un = diffInline("<i>soon</i>", "soon");
    expect(un).toEqual([{ kind: "equal", text: "soon", marks: [], prevMarks: ["em"] }]);
  });

  test("a link added or changed is a formatting change", () => {
    expect(diffInline("See plans", 'See <a href="/pricing">plans</a>')).toEqual([
      { kind: "equal", text: "See ", marks: [] },
      { kind: "equal", text: "plans", marks: [{ a: "/pricing" }], prevMarks: [] },
    ]);
    expect(diffInline('<a href="/old">plans</a>', '<a href="/new">plans</a>')).toEqual([
      { kind: "equal", text: "plans", marks: [{ a: "/new" }], prevMarks: [{ a: "/old" }] },
    ]);
  });

  test("a class change is a formatting change, and classes come back in the marks", () => {
    expect(diffInline('<span class="a">Sign</span> in', '<span class="b">Sign</span> in')).toEqual([
      { kind: "equal", text: "Sign", marks: [{ span: "b" }], prevMarks: [{ span: "a" }] },
      { kind: "equal", text: " in", marks: [] },
    ]);
    expect(diffInline('<b class="x">a</b> <a href="/p" class="l">b</a>', '<b class="x">a</b> <a href="/p" class="l">c</a>')).toEqual([
      { kind: "equal", text: "a", marks: [{ strong: "x" }] },
      { kind: "equal", text: " ", marks: [] },
      { kind: "delete", text: "b", marks: [{ a: "/p", class: "l" }] },
      { kind: "insert", text: "c", marks: [{ a: "/p", class: "l" }] },
    ]);
    // nesting order alone is no change
    expect(diffInline("<b><i>x</i></b>", "<i><b>x</b></i>")).toEqual([{ kind: "equal", text: "x", marks: ["em", "strong"] }]);
    expect(renderChangesHtml(diffInline("Sign in", '<span class="text-brand">Sign</span> in'))).toBe(
      '<span data-rl-fmt title="style “text-brand” added"><span class="text-brand">Sign</span></span> in',
    );
  });

  test("sameCopy ignores spacing but not words or formatting", () => {
    expect(sameCopy("Log in now", "Log&nbsp;in  now ")).toBe(true);
    expect(sameCopy("Log in now", " Log in\n now")).toBe(true);
    expect(sameCopy("a<br>b", "a <br> b")).toBe(true);
    expect(sameCopy("<b>a</b> b", "<b>a </b>b")).toBe(true);
    expect(sameCopy("<i><b>x</b></i>", "<b><i>x</i></b>")).toBe(true);
    expect(sameCopy("Log in now", "Log in now!")).toBe(false);
    expect(sameCopy("Log in now", "<b>Log</b> in now")).toBe(false);
    expect(sameCopy('<span class="a">x</span>', '<span class="b">x</span>')).toBe(false);
    expect(sameCopy("a<br>b", "a b")).toBe(false);
    expect(sameCopy("", " ")).toBe(true);
  });

  test("line breaks are tokens", () => {
    expect(kinds(diffInline("one two", "one<br>two"))).toEqual(["e:one", "d: ", "i:\n", "e:two"]);
  });

  test("empty before or after", () => {
    expect(diffInline("", "New copy")).toEqual([{ kind: "insert", text: "New copy", marks: [] }]);
    expect(diffInline("Old copy", "")).toEqual([{ kind: "delete", text: "Old copy", marks: [] }]);
    expect(diffInline("", "")).toEqual([]);
  });

  test("large unrelated texts still finish", () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`).join(" ");
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`).join(" ");
    const segs = diffInline(a, b);
    expect(segs.filter((s) => s.kind === "delete").map((s) => s.text).join("")).toContain("a2999");
    expect(segs.filter((s) => s.kind === "insert").map((s) => s.text).join("")).toContain("b2999");
  });

  test("renderChangesHtml marks insertions, deletions and formatting", () => {
    expect(renderChangesHtml(diffInline("Log in to view", "<b>Sign</b> in to view"))).toBe("<del data-rl-del>Log</del><ins data-rl-ins><strong>Sign</strong></ins> in to view");
    expect(renderChangesHtml(diffInline("Sign in", "<i>Sign</i> in"))).toBe('<span data-rl-fmt title="italic added"><em>Sign</em></span> in');
    expect(renderChangesHtml(diffInline("<b>old</b>", "new"))).toBe("<del data-rl-del><strong>old</strong></del><ins data-rl-ins>new</ins>");
    expect(renderChangesHtml(diffInline("a &lt; b", "a &lt; c"))).toBe("a &lt; <del data-rl-del>b</del><ins data-rl-ins>c</ins>");
    expect(renderChangesHtml(diffInline("one two", "one<br>two"))).toBe("one<del data-rl-del> </del><ins data-rl-ins><br></ins>two");
  });
});

const edit = (over: Partial<TextEdit> = {}): TextEdit => ({
  id: "e1",
  review_id: "r1",
  selector: "main h1",
  label: "the heading “Login”",
  before_html: "Log in to view your orders",
  before_text: "Log in to view your orders",
  after_html: "<strong>Sign in</strong> to view your orders",
  after_text: "Sign in to view your orders",
  viewport_width: 1440,
  status: "open",
  note: null,
  author_id: null,
  author_name: "Priya",
  author_color: "#e2342b",
  created_at: "2026-11-01T10:00:00.000Z",
  updated_at: "2026-11-01T10:00:00.000Z",
  ...over,
});

test.describe("hand-off formats", () => {
  test("toMarkdown", () => {
    expect(toMarkdown("<strong>Sign in</strong> to view your orders")).toBe("**Sign in** to view your orders");
    expect(toMarkdown("a <em>b</em> <u>c</u> <a href=\"/x y\">d</a>")).toBe("a *b* <u>c</u> [d](/x%20y)");
    expect(toMarkdown("<strong>Sign in </strong>now")).toBe("**Sign in** now");
    expect(toMarkdown("one<br>two")).toBe("one  \ntwo");
    expect(toMarkdown("<a href=\"/p\"><b>Plans</b> page</a>")).toBe("[**Plans** page](/p)");
    expect(toMarkdown("2 * 3 = [6] _x_")).toBe("2 \\* 3 = \\[6\\] \\_x\\_");
    expect(toMarkdown("a&nbsp;b")).toBe("a b");
    expect(toMarkdown("<b> </b>x")).toBe(" x");
  });

  test("Markdown and Jira: markers never span a line break, and line starts stay text", () => {
    expect(toMarkdown("<b>one<br>two</b>")).toBe("**one**  \n**two**");
    expect(toJira("<b>one<br>two</b>")).toBe("*one*\n*two*");
    expect(toMarkdown("# not a heading<br>- not a list<br>+ nor this<br>1. nor this<br>12) nor this<br>> nor this<br>===")).toBe(
      "\\# not a heading  \n\\- not a list  \n\\+ nor this  \n1\\. nor this  \n12\\) nor this  \n\\> nor this  \n\\===",
    );
    expect(toJira("# x<br>- y<br>h1. z")).toBe("\\# x\n\\- y\nh1\\. z");
    // the site's classes and spans don't travel into text markup
    expect(toMarkdown('<span class="a"><b class="x">Sign</b> in</span>')).toBe("**Sign** in");
  });

  test("toJira", () => {
    expect(toJira("<strong>Sign in</strong> to <em>view</em> <u>all</u> <a href=\"https://x.test\">orders</a>")).toBe("*Sign in* to _view_ +all+ [orders|https://x.test]");
    expect(toJira("one<br>two")).toBe("one\ntwo");
    expect(toJira("a*b [c]")).toBe("a\\*b \\[c\\]");
  });

  test("Jira: a selector with braces, and handoffAll's header", () => {
    expect(handoffText(edit({ selector: "div[data-x='}}']" }), "T", "u", { format: "jira" })).toContain("(selector: div\\[data-x='\\}\\}'\\])");
    expect(handoffAll([edit()], { title: "T", url: "u" }, { format: "jira" }).startsWith("*Page:* T — u\n*Copy changes:* 1")).toBe(true);
  });

  test("CSV cells that a spreadsheet would run as a formula are neutralized", () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell("\rx")).toBe(`"'\rx"`);
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell(5)).toBe("5");
  });

  test("handoffText and handoffAll", () => {
    expect(handoffText(edit({ note: "Matches the new nav" }), "Checkout", "https://shop.test/checkout")).toBe(
      [
        "Page: Checkout — https://shop.test/checkout",
        "Where: the heading “Login” (selector: `main h1`)",
        "Before: Log in to view your orders",
        "After: **Sign in** to view your orders",
        "Note: Matches the new nav",
      ].join("\n"),
    );
    const jira = handoffText(edit(), "Checkout", "https://shop.test/checkout", { format: "jira", status: "Open" });
    expect(jira).toContain("*After:* *Sign in* to view your orders");
    expect(jira).toContain("*Status:* Open");
    expect(jira).toContain("{{main h1}}");
    const all = handoffAll([edit({ id: "e2", created_at: "2026-11-02T00:00:00.000Z", label: "the button “Buy”" }), edit()], { title: "Checkout", url: "https://shop.test" });
    expect(all.startsWith("Page: Checkout — https://shop.test\nCopy changes: 2\n\nWhere: the heading")).toBe(true);
    expect(all.match(/Page:/g)).toHaveLength(1);
    expect(all.indexOf("“Login”")).toBeLessThan(all.indexOf("“Buy”"));
    expect(handoffText(edit({ after_html: "" }), "T", "u")).toContain("After: (empty)");
  });
});
