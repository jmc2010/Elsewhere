/**
 * The catalog pool seed.
 *
 * `catalog_search` orders its pool by freshness, then by `md5(id || seed)`.
 * The seed decides which slice of a dense area a user sees, so it has two
 * requirements that pull against each other:
 *
 *   - Stable within a day. A shortlist that reshuffles between renders is
 *     unusable -- someone reading the fourth card must not have it move.
 *   - Different across days and across people. With a fixed seed the same 200
 *     of Dallas's 3,982 eligible places come back forever and the rest are
 *     unreachable, which is the bug 0031 exists to fix.
 *
 * So: user id plus the local calendar date. Local, not UTC -- the day should
 * turn over at midnight where the user is, not at 7pm Central.
 *
 * Every screen must use this same function. Two screens computing the seed
 * differently would show two different pools for the same session, and the
 * discrepancy would look like a ranking bug rather than a seeding one.
 */
export function catalogSeed(userId: string, now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${userId}|${y}-${m}-${d}`;
}
