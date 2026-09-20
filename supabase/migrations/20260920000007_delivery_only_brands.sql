-- Mark delivery-only virtual brands rather than dropping them.
--
-- Nine brands in the North Texas catalog are ghost kitchens: an address a
-- delivery order comes out of, not somewhere you can go and sit. Barstool
-- Bites, The Burger Den, Tenderfix, Pardon My Cheesesteak, The Meltdown,
-- Soup Man, Larray's Loaded Mac, Foodgod Truffle Fries, Nascar Refuel.
--
-- Decided 2026-09-20: keep them and flag them, rather than excluding them at
-- promote. They are real options when the question is "what can we order
-- tonight", which Elsewhere may well answer later; they are wrong only when
-- the question is "where should we go". Flagging keeps both futures open and
-- makes the call reversible, where dropping them at ingest would not be.
--
-- Consumers: promote carries this onto places, and shortlist rendering
-- should either badge or suppress these depending on the mode the user is
-- in. A delivery-only place should never be offered as a Surprise Me pick,
-- since the whole affordance is "go here now".

alter table brand_cuisine_map
  add column delivery_only boolean not null default false;

comment on column brand_cuisine_map.delivery_only is
  'Ghost-kitchen brand: a delivery-only label operating out of another
   kitchen. Not somewhere a user can go. Keep out of "go there now" surfaces
   (Surprise Me, shortlist by default); valid for takeout/delivery modes.';

update brand_cuisine_map
set delivery_only = true
where name_norm in (
  'barstool bites',
  'the burger den',
  'tenderfix by noah schnapp',
  'pardon my cheesesteak',
  'the meltdown',
  'soup man',
  'larrays loaded mac',
  'foodgod truffle fries',
  'nascar refuel'
);

-- Their confidence was low because "is this even a place?" was folded into
-- the same number as "what does it serve?". Now that the first question has
-- its own column, confidence can say what it is supposed to say: how sure we
-- are of the cuisine. The notes drop the virtual-brand text, which the flag
-- now carries.
update brand_cuisine_map set confidence = 0.90, note = null
  where name_norm in ('the burger den', 'pardon my cheesesteak');
update brand_cuisine_map set confidence = 0.85, note = 'grilled cheese'
  where name_norm = 'the meltdown';
update brand_cuisine_map set confidence = 0.85, note = null
  where name_norm in ('larrays loaded mac', 'tenderfix by noah schnapp');
update brand_cuisine_map set confidence = 0.80, note = null
  where name_norm = 'soup man';
update brand_cuisine_map set confidence = 0.75, note = null
  where name_norm = 'foodgod truffle fries';
-- Barstool Bites and Nascar Refuel stay low: licensed media brands with
-- rotating menus, so the cuisine genuinely is not pinned down.
update brand_cuisine_map set note = 'licensed media brand; rotating menu'
  where name_norm in ('barstool bites', 'nascar refuel');
