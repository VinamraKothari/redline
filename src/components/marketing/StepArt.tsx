/**
 * Small illustrations for the "how it works" steps, drawn with the app's own
 * colours: paper, hairlines, ink, a red pin, a blue selection, a violet
 * developer comment. Each is a 240 × 140 canvas that scales with its column.
 */
export type StepKind = "url" | "load" | "review" | "freeze" | "figma" | "jira";

const UI = "var(--font-ui), sans-serif";
const MONO = "var(--font-mono), monospace";

export function StepArt({ kind }: { kind: StepKind }) {
  return (
    <svg viewBox="0 0 240 140" className="h-auto w-full" aria-hidden>
      <rect width="240" height="140" rx="10" fill="var(--panel)" />
      <rect x="0.5" y="0.5" width="239" height="139" rx="10" fill="none" stroke="var(--line)" />
      {ART[kind]}
    </svg>
  );
}

/** grey bars standing in for text */
function Bars({ x, y, widths, gap = 9, h = 5, fill = "var(--line)" }: { x: number; y: number; widths: number[]; gap?: number; h?: number; fill?: string }) {
  return (
    <>
      {widths.map((w, i) => (
        <rect key={i} x={x} y={y + i * gap} width={w} height={h} rx={h / 2} fill={fill} />
      ))}
    </>
  );
}

/** a mini browser frame */
function Frame({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children?: React.ReactNode }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={h} rx="6" fill="var(--panel)" stroke="var(--line-strong)" />
      <line x1="0" y1="14" x2={w} y2="14" stroke="var(--line)" />
      <circle cx="8" cy="7" r="2" fill="var(--line-strong)" />
      <circle cx="15" cy="7" r="2" fill="var(--line-strong)" />
      <circle cx="22" cy="7" r="2" fill="var(--line-strong)" />
      {children}
    </g>
  );
}

function Pin({ x, y, n }: { x: number; y: number; n: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle cx="9" cy="-9" r="9" fill="var(--red)" />
      <text x="9" y="-5.5" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="700" fontFamily={UI}>
        {n}
      </text>
    </g>
  );
}

function DevPin({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle cx="9" cy="-9" r="9" fill="var(--violet)" />
      <text x="9" y="-5.5" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="700" fontFamily={MONO}>
        {"</>"}
      </text>
    </g>
  );
}

const ART: Record<StepKind, React.ReactNode> = {
  url: (
    <>
      <rect x="24" y="52" width="192" height="36" rx="8" fill="var(--paper)" stroke="var(--line-strong)" />
      <text x="36" y="74" fill="var(--ink)" fontSize="11" fontFamily={MONO}>
        acme.com/pricing
      </text>
      <rect x="146" y="65" width="1.5" height="13" fill="var(--blue)" />
      <rect x="156" y="58" width="52" height="24" rx="6" fill="var(--ink)" />
      <text x="182" y="74" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="600" fontFamily={UI}>
        Review →
      </text>
      <text x="24" y="106" fill="var(--ink-3)" fontSize="9" fontFamily={UI}>
        Desktop 1440 · Tablet 1024 · Phone 390
      </text>
    </>
  ),
  load: (
    <>
      <rect x="14" y="12" width="212" height="116" rx="6" fill="var(--canvas)" />
      <Frame x={44} y={24} w={152} h={104}>
        <rect x="12" y="24" width="14" height="6" rx="2" fill="var(--ink)" />
        <rect x="98" y="25" width="10" height="4" rx="2" fill="var(--line)" />
        <rect x="112" y="25" width="10" height="4" rx="2" fill="var(--line)" />
        <rect x="126" y="25" width="10" height="4" rx="2" fill="var(--line)" />
        <rect x="12" y="42" width="70" height="8" rx="2" fill="var(--ink)" opacity="0.85" />
        <rect x="12" y="54" width="50" height="8" rx="2" fill="var(--ink)" opacity="0.85" />
        <Bars x={12} y={70} widths={[64, 58, 40]} gap={7} h={3.5} />
        <rect x="96" y="42" width="44" height="40" rx="3" fill="var(--hover)" stroke="var(--line)" />
      </Frame>
      <rect x="160" y="16" width="52" height="16" rx="4" fill="var(--panel)" stroke="var(--line)" />
      <text x="186" y="27" textAnchor="middle" fill="var(--ink-2)" fontSize="8.5" fontFamily={MONO}>
        1440 px
      </text>
    </>
  ),
  review: (
    <>
      <rect x="24" y="22" width="192" height="96" rx="6" fill="var(--paper)" stroke="var(--line)" />
      <rect x="38" y="36" width="78" height="9" rx="2" fill="var(--ink)" opacity="0.85" />
      <rect x="38" y="49" width="56" height="9" rx="2" fill="var(--ink)" opacity="0.85" />
      <Bars x={38} y={66} widths={[70, 62]} gap={7} h={3.5} />
      <rect x="38" y="86" width="34" height="14" rx="3" fill="var(--ink)" />
      <rect x="78" y="86" width="30" height="14" rx="3" fill="none" stroke="var(--line-strong)" />
      {/* inspect: selection + size */}
      <rect x="76.5" y="84.5" width="33" height="17" rx="3" fill="none" stroke="var(--blue)" strokeWidth="1.5" />
      <rect x="86" y="70" width="30" height="10" rx="2" fill="var(--blue)" />
      <text x="101" y="77.5" textAnchor="middle" fill="#fff" fontSize="7" fontFamily={MONO}>
        30 × 14
      </text>
      {/* a drawn stroke around the image */}
      <rect x="132" y="36" width="70" height="64" rx="3" fill="var(--hover)" stroke="var(--line)" />
      <path d="M126 40 C 120 70, 140 112, 180 106 S 216 70, 200 44 S 150 20, 128 42" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" />
      <Pin x={30} y={40} n="1" />
      <Pin x={160} y={64} n="2" />
    </>
  ),
  freeze: (
    <>
      <rect x="52" y="34" width="150" height="86" rx="6" fill="var(--paper)" stroke="var(--line-strong)" opacity="0.6" />
      <rect x="40" y="24" width="150" height="86" rx="6" fill="var(--panel)" stroke="var(--line-strong)" />
      <rect x="52" y="38" width="60" height="8" rx="2" fill="var(--ink)" opacity="0.85" />
      <Bars x={52} y={54} widths={[90, 84, 60]} gap={8} h={4} />
      <rect x="52" y="86" width="26" height="11" rx="3" fill="var(--ink)" />
      <Pin x={100} y={52} n="3" />
      <rect x="120" y="14" width="86" height="20" rx="10" fill="var(--ink)" />
      <path d="M133 19.5 v9 M129.1 21.75 l7.8 4.5 M129.1 26.25 l7.8 -4.5" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.9" />
      <text x="146" y="27.5" fill="#fff" fontSize="9" fontWeight="600" fontFamily={UI}>
        Frozen · v2
      </text>
    </>
  ),
  figma: (
    <>
      {/* the design */}
      <rect x="16" y="26" width="92" height="90" rx="5" fill="var(--panel)" stroke="var(--violet)" strokeDasharray="3 3" />
      <text x="20" y="20" fill="var(--violet)" fontSize="8" fontFamily={MONO}>
        Figma · Pricing
      </text>
      <rect x="26" y="38" width="52" height="8" rx="2" fill="var(--ink)" opacity="0.85" />
      <Bars x={26} y={54} widths={[70, 64, 40]} gap={7} h={3.5} />
      <rect x="26" y="84" width="30" height="12" rx="3" fill="var(--ink)" />
      {/* the page */}
      <rect x="132" y="26" width="92" height="90" rx="5" fill="var(--paper)" stroke="var(--line-strong)" />
      <text x="136" y="20" fill="var(--ink-3)" fontSize="8" fontFamily={MONO}>
        acme.com/pricing
      </text>
      <rect x="142" y="38" width="44" height="8" rx="2" fill="var(--ink)" opacity="0.85" />
      <Bars x={142} y={54} widths={[70, 64, 40]} gap={7} h={3.5} />
      <rect x="142" y="88" width="30" height="12" rx="3" fill="var(--ink)" />
      {/* what differs */}
      <rect x="140.5" y="86.5" width="33" height="15" rx="3" fill="none" stroke="var(--violet)" strokeWidth="1.2" />
      <DevPin x={178} y={48} />
      <DevPin x={166} y={98} />
      <path d="M110 70 h16" stroke="var(--ink-3)" strokeWidth="1.2" markerEnd="url(#arrow)" />
      <defs>
        <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M1 1 L7 4 L1 7" fill="none" stroke="var(--ink-3)" strokeWidth="1.2" />
        </marker>
      </defs>
    </>
  ),
  jira: (
    <>
      {/* the thread list */}
      <rect x="16" y="24" width="104" height="92" rx="6" fill="var(--panel)" stroke="var(--line)" />
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(24 ${36 + i * 26})`}>
          <circle cx="7" cy="7" r="7" fill={i === 2 ? "var(--violet)" : "var(--red)"} />
          <text x="7" y="10" textAnchor="middle" fill="#fff" fontSize="7.5" fontWeight="700" fontFamily={i === 2 ? MONO : UI}>
            {i === 2 ? "</>" : String(i + 1)}
          </text>
          <rect x="20" y="2" width={54 - i * 8} height="4.5" rx="2" fill="var(--ink)" opacity="0.8" />
          <rect x="20" y="10" width="66" height="3.5" rx="1.75" fill="var(--line)" />
        </g>
      ))}
      <path d="M126 70 h14" stroke="var(--ink-3)" strokeWidth="1.2" markerEnd="url(#arrow2)" />
      <defs>
        <marker id="arrow2" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M1 1 L7 4 L1 7" fill="none" stroke="var(--ink-3)" strokeWidth="1.2" />
        </marker>
      </defs>
      {/* the issue */}
      <rect x="146" y="40" width="80" height="60" rx="6" fill="var(--panel)" stroke="var(--line-strong)" />
      <text x="154" y="54" fill="var(--ink-3)" fontSize="8" fontFamily={MONO}>
        ACME-42
      </text>
      <rect x="154" y="60" width="56" height="5" rx="2" fill="var(--ink)" opacity="0.85" />
      <Bars x={154} y={70} widths={[62, 48]} gap={6} h={3} />
      <rect x="154" y="84" width="28" height="9" rx="4.5" fill="var(--red-soft)" />
      <text x="168" y="90.5" textAnchor="middle" fill="var(--red-ink)" fontSize="6.5" fontWeight="600" fontFamily={UI}>
        To do
      </text>
      <text x="154" y="116" fill="var(--ink-3)" fontSize="8" fontFamily={UI}>
        .csv · Jira import
      </text>
    </>
  ),
};
