import "server-only";

const PAGE_SIZE = 1000;

/**
 * Supabase/PostgREST caps a single request at 1000 rows by default — a plain
 * `.select(...)` with no `.range()` silently returns only the first 1000 rows,
 * not an error. synced_contacts crossed that threshold (2,484 rows as of this
 * fix) and the People/Companies endpoints started seeing two *different*
 * arbitrary 1000-row slices of it — different because each has its own
 * `.order(...)`, so "first 1000" means something different per query. A
 * contact could appear in one view and not the other despite existing in
 * both queries' underlying table.
 *
 * Pages through with `.range()` until a page comes back short, accumulating
 * every row. The caller's query MUST have a stable/total `.order(...)` (a
 * unique column, or enough tiebreaker columns to make ties impossible) —
 * without one, row order across separate page requests isn't guaranteed
 * stable and pagination can skip or duplicate rows at page boundaries.
 */
export async function fetchAllRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ data: T[]; error: string | null }> {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await query(offset, offset + PAGE_SIZE - 1);
    if (error) return { data: rows, error: error.message };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return { data: rows, error: null };
}
