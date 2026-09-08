import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function NotFound() {
  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <Logo />
      <h1 className="text-[20px] font-semibold text-ink">This review doesn&apos;t exist</h1>
      <p className="max-w-[360px] text-[13px] text-ink-2">The link may be wrong, or the review was deleted by its owner.</p>
      <Link href="/" className="rounded-md bg-ink px-3 py-1.5 text-[13px] font-medium text-white">
        Start a new review
      </Link>
    </main>
  );
}
