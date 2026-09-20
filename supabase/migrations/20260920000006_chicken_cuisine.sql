-- Add a Chicken leaf, and move the fried-chicken chains onto it.
--
-- 0005 parked Chick-fil-A, KFC, Popeyes, Church's, Golden Chick, Raising
-- Cane's, Chicken Express and friends on `fast-food` at confidence 0.50,
-- because the taxonomy had nowhere better. That was the largest single
-- compromise in the map: ~963 North Texas rows by brand name, and Overture
-- independently tags 872 rows `chicken_restaurant`. Roughly 3% of the metro
-- catalog, and "Fast Food" as a filter was returning KFC next to Subway.
--
-- One leaf rather than a fried/rotisserie split, because Overture gives only
-- `chicken_restaurant` -- there is no signal to split on, so a finer taxonomy
-- would be hand-decided for every row with nothing backing it.
--
-- Sits alongside the existing `wings` leaf. Wings chains (Wingstop,
-- Wingstreet, Wing Boss) stay on `wings`; they are a distinct thing people
-- filter for. El Pollo Loco and Pollo Regio stay on `mexican`, which is what
-- they are.

insert into cuisines (slug, label, parent_id)
select 'chicken', 'Chicken', id from cuisines where slug = 'american';

-- Confidence goes to 0.90: the cuisine is no longer a compromise. These stay
-- reviewed = false, because what was reviewed is the taxonomy question, not
-- each individual brand assignment.
update brand_cuisine_map
set cuisine_id = (select id from cuisines where slug = 'chicken'),
    confidence = 0.90,
    note       = null
where name_norm in (
  'chick fil a',
  'golden chick',
  'kfc',
  'popeyes',
  'popeyes louisiana kitchen',
  'churchs chicken',
  'churchs texas chicken',
  'chicken express',
  'raising canes',
  'raising canes chicken fingers',
  'krispy krunchy chicken',
  'bojangles',
  'henderson chicken',
  'williams fried chicken',
  'louisiana famous fried chicken'
);

-- Tenderfix is chicken tenders, but it is a delivery-only virtual brand, so
-- it keeps its low confidence and its flag -- the open question there is
-- whether ghost-kitchen brands belong in the catalog at all, not what they
-- serve. See docs/STATUS.md.
update brand_cuisine_map
set cuisine_id = (select id from cuisines where slug = 'chicken')
where name_norm = 'tenderfix by noah schnapp';
