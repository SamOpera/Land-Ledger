/** The Land-Ledger mark: a surveyed plot on a navy tile, with a gold boundary and pin. */
export function Mark({ className = "mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="ll-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2a3d86" />
          <stop offset="0.55" stopColor="#111c44" />
          <stop offset="1" stopColor="#0a1030" />
        </linearGradient>
        <linearGradient id="ll-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff0b8" />
          <stop offset="0.5" stopColor="#f2c15a" />
          <stop offset="1" stopColor="#b9862a" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="92" height="92" rx="22" fill="url(#ll-body)" stroke="#4a63c7" strokeOpacity="0.6" strokeWidth="2" />
      <path d="M22 40 50 26 78 40 50 54Z" fill="none" stroke="#6f86e0" strokeOpacity="0.55" strokeWidth="3" strokeLinejoin="round" />
      <path d="M22 56 50 42 78 56 50 70Z" fill="rgba(242,193,90,0.12)" stroke="url(#ll-gold)" strokeWidth="5" strokeLinejoin="round" />
      <path d="M50 70V80" stroke="url(#ll-gold)" strokeWidth="5" strokeLinecap="round" />
      <circle cx="50" cy="56" r="5" fill="url(#ll-gold)" />
    </svg>
  );
}
