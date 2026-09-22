-- Add the `known` verdict.
--
-- `known` means: I have been here at some point, I have no opinion, and I do
-- not remember when. It is what the cold-start recognition grid writes -- six
-- taps on "which of these do you already know?" become six `known` verdicts.
--
-- It is NOT a weaker `fine`, and collapsing the two breaks the recognition
-- grid. They differ on which suppression applies:
--
--   fine   eligible, no boost, DOES get recency suppression (14 days).
--          You went, recently, and it was unremarkable.
--
--   known  eligible, no boost, NO recency suppression -- there is no date to
--          suppress from, and inventing one would either hide a place you
--          last visited in 2019 or fail to hide one you went to last week.
--          But it DOES suppress novelty: it is emphatically not "new to you",
--          and surfacing it as a discovery is the single thing the grid
--          exists to prevent.
--
-- That asymmetry is the whole value of the grid. What novelty needs is not a
-- list of what you like -- it is a list of what you already know, gathered
-- before anyone has recorded a single opinion.
--
-- No transaction wrapper here on purpose. ALTER TYPE ... ADD VALUE is a single
-- statement, so it is atomic on its own, and the new label cannot be used in
-- the same transaction that adds it -- wrapping it invites a later edit to add
-- a statement referencing 'known' and fail in a way that reads as nonsense.

-- Ordered between `fine` and `not_again` so the enum stays monotonic along the
-- opinion axis: positive, neutral-with-opinion, no-opinion, negative.
alter type verdict_kind add value if not exists 'known' before 'not_again';

comment on type verdict_kind is
  'again = boosted after cooldown; fine = recency-suppressed; known = novelty-suppressed only, no date; not_again = removed from the pool.';

-- `shared` needs no change. The trigger resolves it as `verdict <> not_again`,
-- so a `known` verdict defaults to shared -- which is right: "they have been
-- there" is a useful, low-stakes signal to a connection, and it carries no
-- judgement that could be read as one.
