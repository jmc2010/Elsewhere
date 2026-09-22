-- Drop the single-SKU google_quota_reserve.
--
-- 0052 added the jsonb-breakdown form and deliberately LEFT the old one in
-- place, so the deployed edge function kept working until it was redeployed.
-- That was right for the window and wrong the moment the window closed:
-- PostgREST will not choose between overloaded functions (PGRST203), so with
-- both present EVERY call to google_quota_reserve failed to resolve.
--
-- The symptom was silent and expensive to diagnose: the edge function
-- returned 500 before reaching Google, the client query errored, the detail
-- screen rendered no Google block, and NOTHING was logged -- so the first
-- cost test measured zero calls and looked like a caching triumph rather than
-- a broken function.
--
-- Lesson worth keeping: adding an overload is not a backwards-compatible
-- change when PostgREST is the caller. Deploy the function first, then drop
-- the old signature immediately -- do not leave both in place.

begin;

drop function if exists google_quota_reserve(uuid, text, int, text);

commit;
