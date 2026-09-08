import Link from "next/link";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="inline-flex items-center gap-2 select-none" aria-label="Redline home">
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
        <rect x="1" y="1" width="20" height="20" rx="5" fill="var(--ink)" />
        <path d="M5 15.5 C 8 15, 9 7, 12 8 S 15 14, 17 6.5" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {!compact && <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Redline</span>}
    </Link>
  );
}
