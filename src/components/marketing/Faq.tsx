import { ChevronDown } from "lucide-react";

export interface FaqItem {
  q: string;
  a: React.ReactNode;
}

/** Questions as native <details>: no script, keyboard-accessible, printable. */
export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <div className="mk-faq divide-y divide-line rounded-xl bg-panel hairline">
      {items.map((item) => (
        <details key={item.q} className="group px-5">
          <summary className="flex items-center justify-between gap-4 py-4 text-[15px] font-medium text-ink">
            {item.q}
            <ChevronDown size={16} className="mk-faq-chevron shrink-0 text-ink-3 transition-transform duration-200" />
          </summary>
          <div className="pb-5 text-[14px] leading-relaxed text-ink-2">{item.a}</div>
        </details>
      ))}
    </div>
  );
}
