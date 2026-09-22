-- Read-only. Writes nothing, creates nothing, changes nothing.
--
-- Three reports that have to be read before anything is acted on:
--   1. place_ratings volume  -- migrate or discard is a judgement call
--   2. display_name before/after over the long tail
--   3. co-location counts (spec §5 successor pattern)

\pset pager off
\timing off

\echo
\echo === 1. place_ratings =========================================
-- Whether the 1-5 ratings are worth carrying across to verdicts, or whether
-- there is nothing there to carry. A star cannot be mapped to a verdict
-- honestly anyway -- 3 stars is neither "again" nor "not again" -- so volume
-- decides whether that ambiguity is worth anyone's time.
select
  count(*)                                        as total_rows,
  count(distinct user_id)                         as distinct_users,
  count(distinct place_id)                        as distinct_places,
  count(*) filter (where rating >= 4)             as would_be_again,
  count(*) filter (where rating = 3)              as ambiguous_middle,
  count(*) filter (where rating <= 2)             as would_be_not_again,
  count(*) filter (where note is not null)        as with_note,
  min(created_at)                                 as earliest,
  max(created_at)                                 as latest
from place_ratings;

\echo
\echo === 2. display_name: the long tail ===========================
-- Only runs once 0022 is applied; derive_display_name() is pure, so this
-- shows exactly what promote would write without writing any of it.
\echo (skipped if derive_display_name does not exist yet)

select
  count(*)                                                   as names_over_40,
  count(*) filter (where derive_display_name(name) <> name)  as would_change,
  round(100.0 * count(*) filter (where derive_display_name(name) <> name)
        / nullif(count(*), 0), 1)                            as pct_changed
from places
where length(name) > 40
  and to_regprocedure('derive_display_name(text)') is not null;

\echo
\echo --- every name over 40 chars that the rule would change ---
select
  length(name)                        as len,
  name                                as before,
  derive_display_name(name)           as after,
  length(derive_display_name(name))   as new_len
from places
where length(name) > 40
  and to_regprocedure('derive_display_name(text)') is not null
  and derive_display_name(name) <> name
order by length(name) - length(derive_display_name(name)) desc;

\echo
\echo --- sanity: names the rule LEAVES ALONE, longest first ---
-- The rule is meant to be conservative. Anything here that obviously should
-- have been cut is a miss; anything in the list above that is a real name is
-- a false positive, and false positives are the expensive kind.
select length(name) as len, name
from places
where length(name) > 40
  and to_regprocedure('derive_display_name(text)') is not null
  and derive_display_name(name) = name
order by length(name) desc
limit 25;

\echo
\echo === 3. co-location (spec §5) =================================
-- Two or more records within ~50m where one is a chain Google cannot resolve
-- and the other is an independent is the successor pattern: the chain shut,
-- something took the building. Dairy Queen -> Tia's Tex-Mex is the known case.
--
-- "Chain" here means the name matches brand_cuisine_map. "Unresolvable" means
-- Google could not find it -- which for a national chain is strong evidence it
-- is gone, because Google is never missing a live Dairy Queen.
with pairs as (
  select
    a.id           as a_id,
    a.name         as a_name,
    b.id           as b_id,
    b.name         as b_name,
    st_distance(a.location, b.location) as metres,
    (ba.name_norm is not null)          as a_is_chain,
    (bb.name_norm is not null)          as b_is_chain,
    (a.google_place_id is null)         as a_unresolved,
    (b.google_place_id is null)         as b_unresolved
  from places a
  join places b
    on b.id > a.id
   and st_dwithin(a.location, b.location, 50)
  left join brand_cuisine_map ba on ba.name_norm = norm_place_name(a.name)
  left join brand_cuisine_map bb on bb.name_norm = norm_place_name(b.name)
  where not a.permanently_closed
    and not b.permanently_closed
)
select
  count(*)                                                      as pairs_within_50m,
  count(*) filter (where a_is_chain or b_is_chain)              as involving_a_chain,
  count(*) filter (
    where (a_is_chain and a_unresolved and not b_is_chain)
       or (b_is_chain and b_unresolved and not a_is_chain))     as successor_pattern,
  count(*) filter (where not a_is_chain and not b_is_chain)     as both_independent,
  count(*) filter (where a_is_chain and b_is_chain)             as both_chains
from pairs;

\echo
\echo --- the successor candidates themselves ---
with pairs as (
  select
    a.name as a_name, b.name as b_name,
    round(st_distance(a.location, b.location)::numeric, 1) as metres,
    a.locality,
    (ba.name_norm is not null) as a_is_chain,
    (bb.name_norm is not null) as b_is_chain,
    (a.google_place_id is null) as a_unresolved,
    (b.google_place_id is null) as b_unresolved
  from places a
  join places b
    on b.id > a.id
   and st_dwithin(a.location, b.location, 50)
  left join brand_cuisine_map ba on ba.name_norm = norm_place_name(a.name)
  left join brand_cuisine_map bb on bb.name_norm = norm_place_name(b.name)
  where not a.permanently_closed and not b.permanently_closed
)
select
  case when a_is_chain then a_name else b_name end as gone_chain,
  case when a_is_chain then b_name else a_name end as probable_successor,
  metres, locality
from pairs
where (a_is_chain and a_unresolved and not b_is_chain)
   or (b_is_chain and b_unresolved and not a_is_chain)
order by metres
limit 40;
