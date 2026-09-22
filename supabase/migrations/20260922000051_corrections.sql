-- Place corrections (design spec §5) -- the existence oracle.
--
-- Three corrections, mapping to the three real failures observed by driving
-- around Valley View:
--
--   gone      Rider's Smokehouse: closed years ago, Overture says open.
--   renamed   Dairy Queen -> Tia's Tex-Mex, 42.6m apart. The rename is the
--             highest-value contribution anyone can make: it repairs the row
--             AND unlocks the Google match from then on, because the search
--             that could never find "Dairy Queen" finds "Tia's Tex-Mex".
--   not_a_place  Jbm Specialties Llc: a listing, not a destination.
--
-- ----------------------------------------------------------------------------
-- A CORRECTION IS NOT A VETO
-- ----------------------------------------------------------------------------
-- "It's gone" is a data claim about the world. "Not again" is a taste verdict
-- about you. They live in different tables on purpose and a correction must
-- never write to place_verdicts: reporting a closure would otherwise silently
-- record that you disliked the place, poison your own recency and novelty
-- signals, and -- once connections exist -- travel to other people as an
-- opinion you never held.
--
-- ----------------------------------------------------------------------------
-- TWO INDEPENDENT REPORTS, NOT ONE
-- ----------------------------------------------------------------------------
-- One report is a data point; two from different people is evidence. A single
-- report must not be able to remove a place from everyone's shortlist, or the
-- correction path becomes a griefing tool and one mistaken tap deletes a real
-- restaurant for the whole user base.
--
-- The copy is "may have changed hands", never "may not exist". Every record
-- observed so far pointed at something real -- the problem is identity drift,
-- not fabrication.

begin;

create type correction_kind as enum ('gone', 'renamed', 'not_a_place');

create table place_corrections (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  place_id   uuid not null references places(id)   on delete cascade,
  kind       correction_kind not null,
  -- Only for `renamed`. The whole point of that correction.
  new_name   text,
  note       text,
  created_at timestamptz not null default now(),

  -- One correction per person per place. Changing your mind replaces it;
  -- it does not stack, because stacking would let one person reach the
  -- two-report threshold alone.
  unique (user_id, place_id),

  constraint renamed_needs_a_name
    check (kind <> 'renamed' or (new_name is not null and length(btrim(new_name)) > 1))
);

create index place_corrections_place_idx on place_corrections (place_id);

alter table place_corrections enable row level security;

-- Write and read your own. The AGGREGATE -- how many people reported a place
-- -- is exposed through the counter below, never as rows, so nobody can see
-- who reported what.
create policy place_corrections_self on place_corrections
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table places add column reported_gone_count      integer not null default 0;
alter table places add column reported_renamed_count   integer not null default 0;
alter table places add column reported_not_place_count integer not null default 0;

comment on column places.reported_gone_count is
  'Independent user reports that this place is closed. TWO is the threshold (spec 5); one is a data point.';

create or replace function bump_place_corrections()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.place_id, old.place_id);
begin
  update places p set
    reported_gone_count =
      (select count(*) from place_corrections c where c.place_id = target and c.kind = 'gone'),
    reported_renamed_count =
      (select count(*) from place_corrections c where c.place_id = target and c.kind = 'renamed'),
    reported_not_place_count =
      (select count(*) from place_corrections c where c.place_id = target and c.kind = 'not_a_place')
  where p.id = target;
  return null;
end $$;

create trigger place_corrections_counts
  after insert or update or delete on place_corrections
  for each row execute function bump_place_corrections();

commit;
