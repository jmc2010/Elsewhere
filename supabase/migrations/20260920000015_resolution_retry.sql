-- Make a failed Google resolution retryable.
--
-- places.google_resolution_failed is currently terminal: once set, the place
-- is never offered to Text Search again, so a single bad day is permanent.
-- docs/measurements.md already says it should not be -- "some no_result rows
-- are coordinate drift rather than absence" -- and a monthly Overture
-- reingest is exactly when coordinates improve.
--
-- Valley View's Dairy Queen is the live example: resolution failed once and
-- it would have stayed catalog-only forever.
--
-- The cost of retrying is real (one Text Search per attempt), which is why
-- this is a timestamp and a window rather than simply clearing the flag.

alter table places add column google_resolution_attempted_at timestamptz;

comment on column places.google_resolution_attempted_at is
  'When resolution was last attempted, successfully or not. places-proxy
   retries a failed place only after RESOLUTION_RETRY_DAYS, so a transient
   failure is not permanent and a genuine absence is not re-paid for on
   every hydration.';

-- Backfill so places already flagged become eligible rather than being
-- grandfathered into permanence by the migration that was meant to free them.
update places
   set google_resolution_attempted_at = coalesce(updated_at, now())
 where google_resolution_failed;

create index places_resolution_retry_idx
  on places (google_resolution_attempted_at)
  where google_resolution_failed;

-- Record the attempt time alongside the outcome. Same two permitted writes as
-- before; nothing new from the Places response is stored.
create or replace function google_place_id_record(
  p_place    uuid,
  p_place_id text,
  p_failed   boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_failed or p_place_id is null then
    update places
       set google_resolution_failed       = true,
           google_resolution_attempted_at = now(),
           updated_at                     = now()
     where id = p_place;
    return;
  end if;

  update places
     set google_place_id                 = p_place_id,
         google_place_id_resolved_at     = now(),
         google_resolution_failed        = false,
         google_resolution_attempted_at  = now(),
         updated_at                      = now()
   where id = p_place;
exception
  -- places.google_place_id is unique. Two catalog rows resolving to the same
  -- Google place means Overture holds a duplicate of one restaurant. Flag the
  -- loser rather than failing the whole hydration batch.
  when unique_violation then
    update places
       set google_resolution_failed       = true,
           google_resolution_attempted_at = now(),
           updated_at                     = now()
     where id = p_place;
end $$;

revoke execute on function google_place_id_record(uuid, text, boolean) from public;
grant  execute on function google_place_id_record(uuid, text, boolean) to service_role;
