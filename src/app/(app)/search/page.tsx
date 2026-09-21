import { SearchClient } from '@/components/media/search-client';
import { popularTitles } from '@/server/repos/titles';

export const metadata = { title: 'Search' };
export const dynamic = 'force-dynamic';

export default async function SearchPage() {
  // Server-rendered so the page is never an empty box while JavaScript loads.
  const initial = await popularTitles(18);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Search</h1>
      <SearchClient initial={initial} />
    </div>
  );
}
