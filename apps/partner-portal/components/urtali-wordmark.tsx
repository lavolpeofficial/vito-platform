export function UrtaliWordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`urtali-wordmark ${className}`.trim()} aria-label="URTALI">
      <span aria-hidden="true">URT</span>
      <span className="urtali-a" aria-hidden="true" />
      <span aria-hidden="true">LI</span>
    </span>
  );
}
