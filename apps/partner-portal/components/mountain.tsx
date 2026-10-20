export function MountainMark({ compact = false }: { compact?: boolean }) {
  return (
    <svg className={compact ? 'mountain-mark compact' : 'mountain-mark'} viewBox="0 0 420 180" role="img" aria-label="URTALI mountain">
      <defs>
        <linearGradient id="ice" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#f8fcff" /><stop offset="55%" stopColor="#b9d2e6" /><stop offset="100%" stopColor="#6486a4" /></linearGradient>
        <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#dfbd79" /><stop offset="100%" stopColor="#9b6927" /></linearGradient>
      </defs>
      <path d="M8 163 L88 110 L126 128 L211 34 L271 101 L301 82 L412 163 Z" fill="url(#ice)" opacity=".95" />
      <path d="M88 110 L126 128 L211 34 L181 124 Z" fill="#dfeaf3" />
      <path d="M211 34 L271 101 L238 88 L223 63 Z" fill="#8faec5" />
      <path d="M173 125 L211 34 L198 111 L221 93 L211 134 Z" fill="#ffffff" opacity=".92" />
      <path d="M8 163 H412" stroke="url(#gold)" strokeWidth="2" opacity=".72" />
    </svg>
  );
}
