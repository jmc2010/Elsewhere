-- Public confirmation counter: how many people have confirmed a place EXISTS.
--
-- ------------------------------------------------------------------------
-- WHY THIS IS NOT THE AGGREGATION §4 FORBIDS
-- ------------------------------------------------------------------------
-- Read §4 quickly and this looks like exactly what the product refuses to
-- build. It is not, and the distinction is worth stating precisely so nobody
-- "fixes" it later:
--
--   What §4 refuses to aggregate is OPINIONS. Averaging stars, or saying
--   "3 of your friends liked this", destroys the attribution that makes a
--   friend's verdict worth anything at all. "Dale: worth the drive, good bar"
--   is useful because it is Dale. "4.2 from 9 people" is the thing every
--   competitor already has and the reason none of them help.
--
--   A count of how many people have confirmed a place EXISTS is not an
--   opinion. It is the existence oracle of §5 doing its job. It says nothing
--   about whether anywhere is good, and it cannot be read as a ranking
--   without misreading it.
--
-- So: expose the COUNT, never WHO, and never anything about what they thought.
--
-- What it fixes: the frontier card (§5) means "no Google match AND nobody in
-- Elsewhere has reviewed it". Cross-user verdict counts are unreadable under
-- RLS, so the shortlist was approximating with "fresh upstream AND unknown to
-- you" -- identical while there is one user, wrong the moment there are two.
-- The card only ever needs `> 0`.

begin;

alter table places add column elsewhere_confirmations integer not null default 0;

comment on column places.elsewhere_confirmations is
  'How many people have recorded any verdict here. Existence evidence (spec 5), NOT an opinion aggregate -- see migration 0039 and design-spec 5.';

-- SECURITY DEFINER because the counter must move for verdicts the caller
-- cannot see. RLS on place_verdicts is per-user by design; without definer
-- rights the trigger could only ever count the caller's own.
create or replace function bump_place_confirmations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update places set elsewhere_confirmations = elsewhere_confirmations + 1
     where id = new.place_id;
  elsif tg_op = 'DELETE' then
    -- greatest() guards the floor. A counter that can go negative because of
    -- one replayed delete is worse than one that is occasionally one high.
    update places
       set elsewhere_confirmations = greatest(0, elsewhere_confirmations - 1)
     where id = old.place_id;
  end if;
  return null;
end $$;

create trigger place_verdicts_confirmations_ins
  after insert on place_verdicts
  for each row execute function bump_place_confirmations();

create trigger place_verdicts_confirmations_del
  after delete on place_verdicts
  for each row execute function bump_place_confirmations();

-- Backfill, so the column is correct rather than correct-from-now-on.
update places p
   set elsewhere_confirmations = c.n
  from (select place_id, count(*) as n from place_verdicts group by place_id) c
 where c.place_id = p.id;

commit;
