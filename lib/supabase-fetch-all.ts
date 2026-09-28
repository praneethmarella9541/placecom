import "server-only";

const PAGE_SIZE = 1000;

/**
 * Pages requested at once. PostgREST caps a response at PAGE_SIZE rows and
 * offers no way to raise it from the client, so a large table can only be read
 * as many requests — and at ~0.6s of round trip each, doing them one after
 * another is what made /api/synced-contacts take ~7s for a 9.7k-row mailbox
 * (10 pages) and far worse for the 38.6k-row one. The rows themselves are
 * cheap: a page costs about the same whether it carries every column or only
 * an id, so the fix is fewer sequential waits, not a smaller payload.
 *
 * Six is deliberately modest. Each in-flight request holds a pooled Postgres
 * connection, and two of these run side by side whenever the Contacts page
 * loads (People and Companies read the same table), so the ceiling is really
 * twelve.
 */
const CONCURRENCY = 6;

/**
 * Supabase/PostgREST caps a single request at 1000 rows by default — a plain
 * `.select(...)` with no `.range()` silently returns only the first 1000 rows,
 * not an error. synced_contacts crossed that threshold (2,484 rows as of this
 * fix; 48k across all mailboxes today) and the People/Companies endpoints
 * started seeing two *different* arbitrary 1000-row slices of it — different
 * because each has its own `.order(...)`, so "first 1000" means something
 * different per query. A contact could appear in one view and not the other
 * despite existing in both queries' underlying table.
 *
 * Pages through with `.range()` until a page comes back short, accumulating
 * every row. The caller's query MUST have a stable/total `.order(...)` (a
 * unique column, or enough tiebreaker columns to make ties impossible) —
 * without one, row order across separate page requests isn't guaranteed
 * stable and pagination can skip or duplicate rows at page boundaries.
 *
 * Pages are fetched CONCURRENCY at a time. The last wave overshoots the end of
 * the table by up to CONCURRENCY - 1 requests, which return empty and are
 * discarded — a few wasted round trips in parallel, in exchange for dropping
 * the number of *sequential* ones by the same factor.
 */
export async function fetchAllRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ data: T[]; error: string | null }> {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const wave = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) => offset + i * PAGE_SIZE).map((from) =>
        query(from, from + PAGE_SIZE - 1)
      )
    );

    // Walk the wave in page order and stop at the first short page: everything
    // after it is past the end of the table (or, on error, unusable), so
    // appending it would reorder or duplicate rows.
    for (const { data, error } of wave) {
      if (error) return { data: rows, error: error.message };
      const page = data ?? [];
      rows.push(...page);
      if (page.length < PAGE_SIZE) return { data: rows, error: null };
    }

    offset += CONCURRENCY * PAGE_SIZE;
  }
}
