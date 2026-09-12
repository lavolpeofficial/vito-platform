import Link from 'next/link';
import { NavigationIcon } from '@/components/navigation-icon';
import { navigationItems } from '@/lib/navigation';

export default function ControlCenterHome() {
  return (
    <section aria-labelledby="page-title" className="home-page">
      <div className="page-heading"><span className="eyebrow">VITO Platform</span><h1 id="page-title">Control Center</h1><p>The internal control surface for governed execution, evidence and digital workforce operations.</p></div>
      <div className="boundary-notice" role="status"><span className="system-dot" /><div><strong>Shell operational</strong><p>Navigation and module boundaries are ready. No backend data is requested in this release.</p></div></div>
      <div className="module-grid">
        {navigationItems.map((item, index) => (
          <Link className="module-card" href={item.href} key={item.href}>
            <span className="module-card-icon"><NavigationIcon name={item.icon} /></span><span className="module-card-number">0{index + 1}</span><strong>{item.label}</strong><p>{item.description}</p><span className="card-action">Open boundary <span aria-hidden="true">→</span></span>
          </Link>
        ))}
      </div>
    </section>
  );
}
