-- Everything the place detail screen needs, for one place.
--
-- A screen-shaped function rather than five round trips, because detail is
-- opened from a card tap inside a 90-second decision and its latency is felt.
--
-- What it deliberately does NOT return: anything from Google. Ratings, hours,
-- price and reviews are Layer 2, fetched request-scoped through places-proxy
-- and never stored (CLAUDE.md). This function is Layer 1 and Layer 3 only.
--
-- The hierarchy the screen renders -- YOURS, then YOUR PEOPLE, then Google's
-- block visually separated -- is the product thesis, not a layout preference.
-- Merging them into one list is exactly the averaging §4 refuses: whose
-- opinion is whose is the entire argument.

begin;

create or replace function place_detail(p_place_id uuid)
returns table (
  place_id       uuid,
  name           text,
  display_name   text,
  lat            double precision,
  lon            double precision,
  address_line   text,
  locality       text,
  locality_suspect boolean,
  website        text,
  phone          text,
  cuisines       text[],
  freshness      smallint,
  update_time    timestamptz,
  confirmations  integer,
  non_destination_suspect boolean,
  opening_soon   boolean,
  -- Yours.
  my_verdict     verdict_kind,
  my_note        text,
  my_visited_on  date,
  my_tags        text[],
  last_locked_at timestamptz
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    p.id, p.name, coalesce(p.display_name, p.name),
    st_y(p.location::geometry), st_x(p.location::geometry),
    p.address_line, p.locality, p.locality_suspect, p.website, p.phone,
    coalesce((select array_agg(c.label order by c.label)
              from place_cuisines pc join cuisines c on c.id = pc.cuisine_id
              where pc.place_id = p.id), '{}'::text[]),
    freshness_band(p.update_time),
    p.update_time,
    p.elsewhere_confirmations,
    p.non_destination_suspect,
    p.opening_soon,
    -- RLS scopes place_verdicts and place_lockins to auth.uid(), so "yours"
    -- needs no user parameter and cannot be asked for somebody else's.
    (select v.verdict from place_verdicts v where v.place_id = p.id),
    (select v.note    from place_verdicts v where v.place_id = p.id),
    (select v.visited_on from place_verdicts v where v.place_id = p.id),
    coalesce((select array_agg(t.label order by t.sort_order)
              from place_verdicts v
              join verdict_tags vt on vt.verdict_id = v.id
              join tags t on t.key = vt.tag_key
              where v.place_id = p.id), '{}'::text[]),
    (select max(l.locked_at) from place_lockins l where l.place_id = p.id)
  from places p
  where p.id = p_place_id;
$$;

grant execute on function place_detail to authenticated;

commit;
