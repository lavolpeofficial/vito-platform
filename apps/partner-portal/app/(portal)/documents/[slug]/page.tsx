import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ContentView } from '@/components/content-view';
import { findPortalContent } from '@/lib/content';

export default async function DocumentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entry = findPortalContent('DOCUMENT', slug);
  if (!entry) notFound();
  return <><div className="breadcrumb"><Link href="/documents">Documents</Link><span>→</span><span>{entry.title}</span></div><ContentView entry={entry} /></>;
}
