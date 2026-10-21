export function UrtaliWordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`urtali-wordmark ${className}`.trim()} aria-label="URTALI">
      <span aria-hidden="true">URT</span>
      <span className="urtali-a-char" aria-hidden="true">Λ</span>
      <span aria-hidden="true">LI</span>
    </span>
  );
}
