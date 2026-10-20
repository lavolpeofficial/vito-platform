export function MountainMark({ compact = false }: { compact?: boolean }) {
  const cls = compact ? 'mountain-mark compact mountain-v2' : 'mountain-mark mountain-v2';

  return (
    <svg
      className={cls}
      viewBox="0 0 800 360"
      role="img"
      aria-label="URTALI mountain landscape"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="urtaliSkyGlow" x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="#f8fcff" stopOpacity="0.95" />
          <stop offset="54%" stopColor="#dcebf6" stopOpacity="0.52" />
          <stop offset="100%" stopColor="#b8d0e2" stopOpacity="0.05" />
        </linearGradient>

        <linearGradient id="urtaliFarIce" x1="0" y1="0" x2="1" y2="0.8">
          <stop offset="0%" stopColor="#dceaf4" />
          <stop offset="100%" stopColor="#9fbed4" />
        </linearGradient>

        <linearGradient id="urtaliMidIce" x1="0" y1="0" x2="1" y2="0.86">
          <stop offset="0%" stopColor="#d6e7f2" />
          <stop offset="52%" stopColor="#91b2ca" />
          <stop offset="100%" stopColor="#587c9b" />
        </linearGradient>

        <linearGradient id="urtaliMainIce" x1="0.12" y1="0.04" x2="0.92" y2="0.92">
          <stop offset="0%" stopColor="#eef7fc" />
          <stop offset="38%" stopColor="#b8d0e2" />
          <stop offset="72%" stopColor="#7699b5" />
          <stop offset="100%" stopColor="#355a79" />
        </linearGradient>

        <linearGradient id="urtaliShadow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#658aa7" />
          <stop offset="100%" stopColor="#294a67" />
        </linearGradient>

        <linearGradient id="urtaliSnow" x1="0.15" y1="0" x2="0.78" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="58%" stopColor="#f2f8fc" />
          <stop offset="100%" stopColor="#c7dce9" />
        </linearGradient>

        <linearGradient id="urtaliGold" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#9b6927" />
          <stop offset="45%" stopColor="#dfbd79" />
          <stop offset="100%" stopColor="#b17a2f" />
        </linearGradient>

        <radialGradient id="urtaliHalo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.92" />
          <stop offset="52%" stopColor="#dcecf7" stopOpacity="0.34" />
          <stop offset="100%" stopColor="#dcecf7" stopOpacity="0" />
        </radialGradient>

        <clipPath id="urtaliMainMassifClip">
          <path d="M84 309 L192 244 L252 263 L404 58 L505 204 L558 166 L716 309 Z" />
        </clipPath>
      </defs>

      <ellipse className="mountain-halo" cx="410" cy="112" rx="212" ry="150" fill="url(#urtaliHalo)" />

      <path
        className="mountain-ridge mountain-ridge-far"
        d="M22 307 L114 258 L168 276 L252 184 L317 238 L385 168 L451 224 L503 186 L579 253 L632 224 L778 307 Z"
        fill="url(#urtaliFarIce)"
        opacity="0.48"
      />

      <path
        className="mountain-ridge mountain-ridge-mid"
        d="M44 309 L148 238 L210 268 L314 130 L386 226 L455 154 L530 249 L598 205 L756 309 Z"
        fill="url(#urtaliMidIce)"
        opacity="0.74"
      />

      <path
        className="mountain-ridge mountain-ridge-main"
        d="M84 309 L192 244 L252 263 L404 58 L505 204 L558 166 L716 309 Z"
        fill="url(#urtaliMainIce)"
      />

      <g clipPath="url(#urtaliMainMassifClip)">
        <path
          d="M404 58 L505 204 L472 185 L451 218 L422 152 L404 212 L384 157 L344 230 L315 222 Z"
          fill="url(#urtaliShadow)"
          opacity="0.68"
        />
        <path
          d="M404 58 L358 198 L382 179 L398 226 L421 143 L439 165 L451 117 Z"
          fill="url(#urtaliSnow)"
        />
        <path
          d="M404 58 L451 117 L430 108 L421 143 L409 126 L398 147 L386 125 Z"
          fill="#ffffff"
          opacity="0.98"
        />
        <path
          d="M252 263 L330 211 L359 226 L392 174 L347 247 L307 234 Z"
          fill="#d8e7f1"
          opacity="0.74"
        />
        <path
          d="M505 204 L558 166 L716 309 L605 278 L560 241 Z"
          fill="#507795"
          opacity="0.58"
        />
      </g>

      <path
        className="mountain-gold-ridge"
        d="M84 309 L192 244 L252 263 L404 58 L505 204 L558 166 L716 309"
        fill="none"
        stroke="url(#urtaliGold)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.66"
      />

      <path
        className="mountain-snow-line"
        d="M350 176 L382 179 L398 147 L409 126 L421 143 L451 117"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.72"
      />

      <g className="mountain-mist" fill="none" strokeLinecap="round">
        <path d="M120 286 C214 276 274 292 354 284 S516 270 673 286" stroke="#ffffff" strokeWidth="10" opacity="0.22" />
        <path d="M168 303 C282 292 367 309 458 299 S607 287 704 301" stroke="#dcecf7" strokeWidth="5" opacity="0.32" />
      </g>

      <path
        className="mountain-horizon"
        d="M58 311 H742"
        stroke="url(#urtaliGold)"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.76"
      />
    </svg>
  );
}
