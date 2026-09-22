-- Verdicts and tags (design spec §4).
--
-- Replaces the 1-5 star rating in place_ratings with three verdicts.
--
-- Why: a five-point scale applied to your own visits rebuilds the averaged
-- score the product exists to avoid -- and worse, it cannot carry *why*. "3
-- stars" is unusable by the engine: it cannot tell "the food was fine but it
-- was deafening" from "the food was poor but it was quiet", and those two
-- produce opposite recommendations for a Tuesday date versus a Saturday with
-- kids. Three verdicts plus a tag vocabulary carry the reason, and the reason
-- is the entire moat.
--
-- The three verdicts and their engine effects:
--
--   again      Eligible, boosted once the cooldown clears.
--   fine       Eligible, no boost, normal recency.
--   not_again  Removed from the pool. A real veto.
--
-- place_vetoes folds in here as verdict = 'not_again'. It is dropped rather
-- than kept alongside, because two sources of truth for "never show me this"
-- is how a veto silently stops working.
--
-- place_ratings is dropped. It was measured empty first -- 0 rows, 0 users,
-- 0 places -- so nothing is lost and no star had to be mapped onto a verdict.
-- That mapping would have been a guess anyway: 3 stars is neither "again" nor
-- "not again", which is the objection to the scale in miniature.

begin;

create type verdict_kind     as enum ('again', 'fine', 'not_again');
create type tag_valence      as enum ('pos', 'neg');
create type tag_propagation  as enum ('place', 'conditional', 'personal');

-- ---------------------------------------------------------------------------
-- tags -- reference data, fixed vocabulary, seeded below
-- ---------------------------------------------------------------------------
-- No user-created tags. A fixed vocabulary is what makes tags comparable
-- across people; free text that means the same thing five different ways
-- cannot drive an engine, which is what the `note` field on a verdict is for.
--
-- `propagation` decides how far a tag travels, and it is the load-bearing
-- column here:
--
--   place        A fact about the place. Travels to connections. In a group
--                session a veto carrying one of these *removes*.
--   conditional  True only sometimes. Travels as a visible note, and removes
--                only when tonight matches the condition.
--   personal     Never travels. Shapes that person's own list and nobody
--                else's.
--
-- `dimension` is non-null only where a positive and a negative tag are two
-- sides of the same question, so the engine can treat them as one axis. The
-- asymmetry is deliberate: patio, bar, date and group are positive-only,
-- service, crowding, cleanliness and menu are negative-only. Nobody tags a
-- restaurant "the patio was bad" -- they say it was loud. Do not invent the
-- missing halves to make the table look tidy.
create table tags (
  key         text primary key,
  label       text not null,
  valence     tag_valence not null,
  dimension   text,
  propagation tag_propagation not null,
  sort_order  smallint not null
);

comment on column tags.dimension is
  'Non-null only for a pos/neg pair sharing one axis. One-sided tags are null by design.';

insert into tags (key, label, valence, dimension, propagation, sort_order) values
  -- Positive -- shown when the verdict is `again`.
  ('food_great',      'Food was great',            'pos', 'food',  'place',        1),
  ('drive_worth',     'Worth the drive',           'pos', 'drive', 'conditional',  2),
  ('patio_good',      'Good patio',                'pos', null,    'conditional',  3),
  ('quiet_talk',      'Quiet enough to talk',      'pos', 'noise', 'conditional',  4),
  ('bar_good',        'Good bar',                  'pos', null,    'conditional',  5),
  ('fast',            'Fast',                      'pos', 'speed', 'conditional',  6),
  ('kids_great',      'Great with kids',           'pos', 'kids',  'conditional',  7),
  ('date_good',       'Good for a date',           'pos', null,    'conditional',  8),
  ('group_good',      'Fits a group',              'pos', null,    'conditional',  9),
  ('price_fair',      'Fair price',                'pos', 'price', 'place',       10),

  -- Negative -- shown when the verdict is `not_again`. Same dimensions,
  -- wording flipped: one screen, one thumb, about four seconds.
  ('food_off',        'Food was off',              'neg', 'food',  'place',        1),
  ('drive_not_worth', 'Not worth the drive',       'neg', 'drive', 'conditional',  2),
  ('too_loud',        'Too loud',                  'neg', 'noise', 'conditional',  3),
  ('slow',            'Slow',                      'neg', 'speed', 'conditional',  4),
  ('price_over',      'Overpriced',                'neg', 'price', 'place',        5),
  ('service_poor',    'Service was indifferent',   'neg', null,    'place',        6),
  ('too_crowded',     'Too crowded',               'neg', null,    'conditional',  7),
  ('wrong_for_kids',  'Wrong for kids',            'neg', 'kids',  'conditional',  8),
  ('felt_dirty',      'Felt dirty',                'neg', null,    'place',        9),
  ('menu_nothing',    'Nothing for me on the menu','neg', null,    'personal',    10);

-- Guard the seed, so a future edit that drops or duplicates a row is caught
-- here rather than as a filter screen with a missing option.
do $$
declare
  n_total int;
  n_paired int;
begin
  select count(*) into n_total from tags;
  if n_total <> 20 then
    raise exception 'expected 20 seeded tags, found %', n_total;
  end if;

  -- Every non-null dimension must have exactly one pos and one neg.
  select count(*) into n_paired from (
    select dimension from tags where dimension is not null
    group by dimension
    having count(*) <> 2
        or count(*) filter (where valence = 'pos') <> 1
        or count(*) filter (where valence = 'neg') <> 1
  ) bad;
  if n_paired <> 0 then
    raise exception '% dimension(s) are not a clean pos/neg pair', n_paired;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- place_verdicts
-- ---------------------------------------------------------------------------
create table place_verdicts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  place_id   uuid not null references places(id)   on delete cascade,

  verdict    verdict_kind not null,

  -- Nullable on purpose. Capture is meant to take about four seconds on one
  -- thumb (§4), and demanding a date is friction on the step the whole moat
  -- depends on. It is also null for every veto folded in from place_vetoes,
  -- which carried no visit date -- inventing one from the veto's own
  -- timestamp would be fabricating a visit that may never have happened.
  visited_on date,

  -- The user's own memory ("ask for the corner booth"). Explicitly NOT an
  -- engine input: free text that cannot be compared across people cannot
  -- drive ranking, which is what the fixed tag vocabulary is for.
  note       text,

  -- Whether this verdict is visible to the user's connections. Defaults true,
  -- except for not_again which defaults false -- see the trigger below.
  shared     boolean not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One current verdict per user per place. Changing your mind replaces the
  -- verdict; it does not append a second one.
  unique (user_id, place_id)
);

create index place_verdicts_place_idx on place_verdicts (place_id);
create index place_verdicts_user_idx  on place_verdicts (user_id);

-- A column default can only be one value, and the default here depends on the
-- verdict: sharing what you liked is the point, but broadcasting every veto
-- is not. A BEFORE INSERT trigger runs ahead of the NOT NULL check, so a NULL
-- passed in means "caller did not specify" and gets resolved here. An explicit
-- true or false from the caller always wins.
create function set_verdict_shared_default() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.shared is null then
    new.shared := (new.verdict <> 'not_again');
  end if;
  return new;
end $$;

alter table place_verdicts alter column shared drop not null;

create trigger place_verdicts_shared_default
  before insert on place_verdicts
  for each row execute function set_verdict_shared_default();

create function touch_updated_at() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger place_verdicts_touch
  before update on place_verdicts
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- verdict_tags
-- ---------------------------------------------------------------------------
create table verdict_tags (
  verdict_id uuid not null references place_verdicts(id) on delete cascade,
  tag_key    text not null references tags(key)          on delete restrict,
  primary key (verdict_id, tag_key)
);

create index verdict_tags_tag_idx on verdict_tags (tag_key);

-- ---------------------------------------------------------------------------
-- Fold place_vetoes in, then drop it
-- ---------------------------------------------------------------------------
-- shared is forced false rather than left to the trigger: an existing veto was
-- recorded under a model that never offered to share it, so opting it into
-- sharing now would publish something nobody agreed to.
insert into place_verdicts (user_id, place_id, verdict, note, shared, created_at, updated_at)
select v.user_id, v.place_id, 'not_again', v.reason, false, v.created_at, v.created_at
from place_vetoes v
on conflict (user_id, place_id) do nothing;

drop policy if exists place_vetoes_self on place_vetoes;
drop table place_vetoes;

-- ---------------------------------------------------------------------------
-- Drop place_ratings
-- ---------------------------------------------------------------------------
-- Verified empty before dropping. The guard below makes that verification part
-- of the migration rather than a claim in a commit message: if this is ever
-- run against a database that does have ratings, it stops instead of
-- discarding them silently.
do $$
declare n bigint;
begin
  select count(*) into n from place_ratings;
  if n > 0 then
    raise exception
      'place_ratings has % rows -- refusing to drop. Decide how they map to '
      'verdicts first; there is no honest default for a 3.', n;
  end if;
end $$;

drop policy if exists place_ratings_self on place_ratings;
drop table place_ratings;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table place_verdicts enable row level security;
alter table verdict_tags   enable row level security;
alter table tags           enable row level security;

-- Self-only for now. §4 makes verdicts visible to direct connections, one hop,
-- never friend-of-a-friend -- but there is no connections model yet, so the
-- narrower policy is the honest one to ship. Widening it is a deliberate
-- future migration, not an oversight.
create policy place_verdicts_self on place_verdicts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy verdict_tags_self on verdict_tags
  for all to authenticated
  using (exists (select 1 from place_verdicts pv
                 where pv.id = verdict_tags.verdict_id and pv.user_id = auth.uid()))
  with check (exists (select 1 from place_verdicts pv
                      where pv.id = verdict_tags.verdict_id and pv.user_id = auth.uid()));

-- Reference data: everyone reads, nobody writes. The vocabulary is fixed.
create policy tags_read on tags for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- catalog_search -- repointed at place_verdicts
-- ---------------------------------------------------------------------------
-- Byte-for-byte the definition from 0016 except for the veto clause:
-- place_vetoes is gone, so "never show me this" now reads
-- verdict = 'not_again'. Lifted rather than reworded so the two cannot
-- diverge, matching how 0016 itself was written.
--
-- This has to happen in the same migration as the drop. plpgsql does not
-- resolve table references until the function runs, so dropping the table
-- without this would succeed silently and then break every search at runtime.

create or replace function catalog_search(
  p_lat                    double precision,
  p_lon                    double precision,
  p_radius_meters          double precision default 32187,
  p_cuisines               text[]  default null,
  p_exclude_cuisines       text[]  default null,
  p_household_id           uuid    default null,
  p_unvisited_only         boolean default false,
  p_include_delivery_only  boolean default false,
  p_include_probably_closed boolean default false,
  p_limit                  int     default 25
)
returns table (
  place_id        uuid,
  name            text,
  lat             double precision,
  lon             double precision,
  distance_meters double precision,
  address_line    text,
  locality        text,
  website         text,
  cuisines        text[],
  delivery_only   boolean,
  locality_suspect boolean,
  last_visited_at timestamptz,
  visit_count     bigint
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_center      geography(point, 4326);
  v_include_ids int[];
  v_exclude_ids int[];
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit must be between 1 and 100 (got %). The hydration '
                    'budget is the cost ceiling per session; see spec §5.',
                    p_limit;
  end if;

  if p_radius_meters is null or p_radius_meters <= 0 or p_radius_meters > 160934 then
    raise exception 'p_radius_meters must be between 1 and 160934 (100 miles), got %. '
                    'An unbounded radius turns the spatial index scan into a full '
                    'catalog scan.', p_radius_meters;
  end if;

  if p_lat is null or p_lat < -90 or p_lat > 90
     or p_lon is null or p_lon < -180 or p_lon > 180 then
    raise exception 'p_lat/p_lon out of range (got %, %)', p_lat, p_lon;
  end if;

  v_center := st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography;

  -- A slug may name a GROUP or a LEAF. Groups organise the filter UI; leaves
  -- are what places are actually tagged with. Per the taxonomy seed,
  -- "filtering on a group means filtering on all of its leaves" -- so a group
  -- slug expands to its children. Without this, filtering on `asian` matches
  -- nothing at all, because no place carries the group id.
  select array_agg(id) into v_include_ids
  from cuisines
  where p_cuisines is not null
    and (slug = any(p_cuisines)
         or parent_id in (select id from cuisines where slug = any(p_cuisines)));

  select array_agg(id) into v_exclude_ids
  from cuisines
  where p_exclude_cuisines is not null
    and (slug = any(p_exclude_cuisines)
         or parent_id in (select id from cuisines where slug = any(p_exclude_cuisines)));

  if p_cuisines is not null and array_length(p_cuisines, 1) is not null
     and v_include_ids is null then
    raise exception 'no cuisine matched %; check slugs against the cuisines table', p_cuisines;
  end if;

  return query
  with nearby as materialized (
    select p.id, p.name, p.location, p.address_line, p.locality, p.website,
           p.delivery_only, p.locality_suspect,
           st_distance(p.location, v_center) as dist
    from places p
    where st_dwithin(p.location, v_center, p_radius_meters)
      and not p.permanently_closed
      and (p_include_probably_closed or not p.probably_closed)
      and (p_include_delivery_only or not p.delivery_only)
  ),
  filtered as (
    select n.*
    from nearby n
    where (v_include_ids is null or exists (
             select 1 from place_cuisines pc
             where pc.place_id = n.id and pc.cuisine_id = any(v_include_ids)))
      and (v_exclude_ids is null or not exists (
             select 1 from place_cuisines pc
             where pc.place_id = n.id and pc.cuisine_id = any(v_exclude_ids)))
      and not exists (
            select 1 from place_verdicts v
            where v.place_id = n.id and v.verdict = 'not_again')
      and (not p_unvisited_only or p_household_id is null or not exists (
            select 1 from visits vi
            where vi.place_id = n.id and vi.household_id = p_household_id))
    order by n.dist
    limit p_limit
  )
  select
    f.id, f.name,
    st_y(f.location::geometry), st_x(f.location::geometry),
    f.dist, f.address_line, f.locality, f.website,
    coalesce((select array_agg(c.slug order by c.slug)
              from place_cuisines pc join cuisines c on c.id = pc.cuisine_id
              where pc.place_id = f.id), '{}'::text[]),
    f.delivery_only,
    f.locality_suspect,
    (select max(vi.visited_at) from visits vi
      where vi.place_id = f.id
        and (p_household_id is null or vi.household_id = p_household_id)),
    (select count(*) from visits vi
      where vi.place_id = f.id
        and (p_household_id is null or vi.household_id = p_household_id))
  from filtered f
  order by f.dist;
end $$;

grant execute on function catalog_search to authenticated;

commit;
