-- Lock-ins: "I chose this tonight."
--
-- A lock-in is NOT a visit and NOT a verdict. People lock somewhere in and
-- then don't go -- the place is shut, the queue is long, somebody changes
-- their mind in the car. Writing a verdict at commit time would record an
-- opinion nobody has formed about a meal nobody has eaten.
--
-- But writing nothing costs two things that matter more than the tidiness:
--
--   1. RECENCY SUPPRESSION IS THE ONLY RANKING RULE THAT WORKS TODAY. Tag
--      affinity, friend verdicts and confidence weights are all unbuilt. If
--      committing leaves no trace, the app offers tonight's restaurant again
--      tomorrow morning -- reintroducing the exact rut it exists to break,
--      on the one screen where the product is supposed to be at its best.
--
--   2. REVIEW CAPTURE HAS NO TRIGGER WITHOUT IT. "How was Middlebrooks?"
--      requires knowing you went to Middlebrooks, and the only moment the app
--      ever learns that is the commit.
--
-- So a lock-in drives PROVISIONAL recency suppression and the review prompt.
-- Review capture then resolves it: either into a verdict, or into a record
-- that they did not go. Both outcomes are honest; the ambiguity lives in the
-- table rather than being resolved by guesswork.
--
-- Not unique per (user, place): locking somewhere in twice is two separate
-- decisions on two separate evenings, and collapsing them would lose the
-- second date -- which is precisely the value.

begin;

create table place_lockins (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references profiles(id) on delete cascade,
  place_id  uuid not null references places(id)   on delete cascade,
  locked_at timestamptz not null default now(),

  -- Set by review capture when it resolves this lock-in. Null means
  -- unresolved: either it has not been asked about yet, or the user has not
  -- answered. Distinguishing "not asked" from "asked and ignored" is not
  -- worth a column until there is a reason to treat them differently.
  resolved_at timestamptz,
  -- true  = they went; false = they did not. Null while unresolved.
  did_go      boolean
);

create index place_lockins_user_idx     on place_lockins (user_id, locked_at desc);
create index place_lockins_unresolved_idx on place_lockins (user_id, locked_at desc)
  where resolved_at is null;

comment on table place_lockins is
  'A choice made, not a visit taken and not an opinion held. Drives provisional recency suppression and the review prompt (spec 4).';

alter table place_lockins enable row level security;

create policy place_lockins_self on place_lockins
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A lock-in is NOT a confirmation that the place exists. Somebody choosing a
-- place from a list is not evidence they found it there -- that is what the
-- verdict, written after the fact, is for. No trigger on elsewhere_confirmations.

commit;
