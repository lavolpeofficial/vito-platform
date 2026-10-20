import { GlobalSearch } from '@/components/global-search';

export default function SearchPage() {
  return (
    <>
      <header className="page-head"><span className="eyebrow">Permission-aware Search</span><h1>Search</h1><p>In Produktion darf die Suche ausschließlich Inhalte innerhalb der aktuellen Rolle, Authorization und Portfolio Permission indexieren.</p></header>
      <GlobalSearch />
    </>
  );
}
