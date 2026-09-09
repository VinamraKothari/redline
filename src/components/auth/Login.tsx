"use client";

import { useState } from "react";
import { Logo } from "@/components/Logo";
import { signInWithGoogle } from "@/lib/auth/client";

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z" />
      <path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.7 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export function Login({ next, error, testMode }: { next: string; error: string | null; testMode: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(error);
  const [testName, setTestName] = useState("Priya Test");

  async function google() {
    setBusy(true);
    setErr(null);
    try {
      await signInWithGoogle(next);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  async function testSignIn() {
    const slug = testName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "tester";
    await fetch("/api/auth/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: `00000000-0000-4000-8000-${slug.padEnd(12, "0").slice(0, 12).replace(/[^0-9a-f]/g, "0")}`, email: `${slug}@example.test`, name: testName.trim() || "Tester" }),
    });
    window.location.href = next;
  }

  return (
    <main className="relative flex h-full items-center justify-center overflow-hidden canvas-grid px-6">
      <div className="w-full max-w-[380px] rounded-2xl bg-panel p-8 shadow-pop hairline">
        <Logo />
        <h1 className="mt-8 text-[22px] font-semibold leading-tight tracking-[-0.01em] text-ink">Sign in to Redline</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
          Reviews live in projects shared with your team. Sign in with the Google account you were invited with.
        </p>
        <button
          type="button"
          onClick={google}
          disabled={busy}
          className="mt-6 flex h-11 w-full items-center justify-center gap-3 rounded-lg bg-ink text-[14px] font-medium text-white transition-colors hover:bg-black disabled:opacity-60"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white">
            <GoogleMark />
          </span>
          {busy ? "Redirecting…" : "Continue with Google"}
        </button>
        {err && <p className="mt-3 text-[12.5px] text-red-ink">{err}</p>}

        {testMode && (
          <div className="mt-6 rounded-lg bg-paper p-3 hairline">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Test mode</div>
            <div className="mt-2 flex gap-2">
              <input
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
                aria-label="Test user name"
                className="h-9 min-w-0 flex-1 rounded-md bg-panel px-2.5 text-[13px] text-ink hairline outline-none"
              />
              <button type="button" onClick={testSignIn} className="h-9 rounded-md bg-ink px-3 text-[12.5px] font-medium text-white">
                Sign in as test user
              </button>
            </div>
          </div>
        )}
        <p className="mt-6 text-[11.5px] leading-relaxed text-ink-3">We only use your name, e-mail and picture to show who said what.</p>
      </div>
    </main>
  );
}
