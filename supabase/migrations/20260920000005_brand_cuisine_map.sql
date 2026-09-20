-- Brand → cuisine mapping.
--
-- Why this exists separately from category_cuisine_map: 33% of the North
-- Texas catalog (13,052 of 39,852 rows) sits in Overture leaves that carry no
-- cuisine at all -- `restaurant`, `fast_food_restaurant`, `casual_eatery`,
-- `cafe`, `bar`, `coffee_shop`, `bakery`. Cuisine is the core filter in the
-- product, so that third is currently unfilterable. No category mapping can
-- fix it, because the category genuinely does not carry the information.
--
-- Name does. 210 repeated names (3+ locations) cover 4,486 of those rows,
-- ~34% of the gap, and they are nearly all chains whose cuisine is obvious.
-- The long tail of ~8,100 unique independent names is a separate job.
--
-- Matching is on an EXACT normalized name, never a substring. Substring
-- matching is what produced `barber` from '%bar%' in the extract filter; see
-- scripts/ingest/README.md. Brand name variants get one row each.
--
-- EVERYTHING HERE IS reviewed = false. These are proposed mappings, not
-- reviewed ones. The spec requires a human audit before the mapping is
-- applied, and confidence below ~0.8 marks the calls worth arguing with.

-- Normalization lives in the database so the map and the promote step cannot
-- drift apart. Apostrophes are deleted (so Wendy's -> wendys); every other
-- non-alphanumeric becomes a space (so Chick-fil-A -> chick fil a, and
-- Sonic Drive-In matches Sonic Drive In).
create or replace function norm_place_name(s text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select trim(regexp_replace(
           regexp_replace(
             replace(replace(lower(s), '''', ''), '’', ''),
             '[^a-z0-9]+', ' ', 'g'),
           '\s+', ' ', 'g'));
$$;

create table brand_cuisine_map (
  -- norm_place_name is ASCII-only: a name written entirely in CJK, Thai,
  -- Korean or styled Unicode normalizes to ''. There are ~90 such places in
  -- North Texas. They must never collide on a shared '' key, so it is
  -- rejected outright, and the promote step skips rows that normalize empty.
  -- Those places fall through to the category map like any other.
  name_norm   text primary key check (name_norm <> ''),
  cuisine_id  int references cuisines(id) on delete set null,
  confidence  real,
  reviewed    boolean not null default false,
  reviewed_at timestamptz,
  note        text
);

comment on table brand_cuisine_map is
  'Exact normalized-name -> cuisine. Applied after category_cuisine_map, for
   places whose Overture category carries no cuisine. Never substring-match
   against this table.';

alter table brand_cuisine_map enable row level security;

insert into brand_cuisine_map (name_norm, cuisine_id, confidence, note)
select v.name_norm, c.id, v.confidence, v.note
from (values
  -- ---- Burgers -----------------------------------------------------------
  ('mcdonalds',                             'burgers',         0.95, null),
  ('burger king',                           'burgers',         0.95, null),
  ('wendys',                                'burgers',         0.95, null),
  ('whataburger',                           'burgers',         0.95, null),
  ('five guys',                             'burgers',         0.95, null),
  ('carls jr',                              'burgers',         0.95, null),
  ('jack in the box',                       'burgers',         0.85, null),
  ('sonic drive in',                        'burgers',         0.85, null),
  ('sonic',                                 'burgers',         0.80, null),
  ('a w restaurant',                        'burgers',         0.85, null),
  ('steak n shake',                         'burgers',         0.90, null),
  ('freddys frozen custard steakburgers',   'burgers',         0.90, null),
  ('the burger den',                        'burgers',         0.70, 'delivery-only virtual brand'),

  -- ---- Fried chicken -----------------------------------------------------
  -- The taxonomy has no Chicken leaf, and fried chicken is one of the largest
  -- segments in this metro (~750 rows across these brands). fast-food is
  -- accurate but coarse, and nobody filters for "Fast Food" wanting KFC.
  -- Recommend adding a 'chicken' leaf under 'american'; see docs/STATUS.md.
  ('chick fil a',                           'fast-food',       0.50, 'no chicken leaf in taxonomy'),
  ('golden chick',                          'fast-food',       0.50, 'no chicken leaf in taxonomy'),
  ('kfc',                                   'fast-food',       0.50, 'no chicken leaf in taxonomy'),
  ('popeyes',                               'fast-food',       0.50, 'no chicken leaf in taxonomy'),
  ('popeyes louisiana kitchen',             'fast-food',       0.50, 'no chicken leaf in taxonomy'),
  ('churchs chicken',                       'fast-food',       0.50, 'no chicken leaf in taxonomy'),
  ('churchs texas chicken',                 'fast-food',       0.50, 'no chicken leaf in taxonomy'),
  ('chicken express',                       'fast-food',       0.50, 'no chicken leaf in taxonomy'),
  ('raising canes',                         'fast-food',       0.50, 'no chicken leaf in taxonomy'),
  ('raising canes chicken fingers',         'fast-food',       0.50, 'no chicken leaf in taxonomy'),
  ('krispy krunchy chicken',                'fast-food',       0.50, 'no chicken leaf in taxonomy'),
  ('bojangles',                             'fast-food',       0.50, 'no chicken leaf in taxonomy'),
  ('henderson chicken',                     'fast-food',       0.50, 'no chicken leaf in taxonomy'),
  ('williams fried chicken',                'fast-food',       0.50, 'no chicken leaf in taxonomy'),
  ('louisiana famous fried chicken',        'fast-food',       0.50, 'no chicken leaf in taxonomy'),
  ('tenderfix by noah schnapp',             'fast-food',       0.50, 'delivery-only virtual brand'),
  ('el pollo loco',                         'mexican',         0.75, null),
  ('pollo regio',                           'mexican',         0.80, null),

  -- ---- Wings -------------------------------------------------------------
  ('wingstop',                              'wings',           0.95, null),
  ('wingstreet',                            'wings',           0.90, null),
  ('wing boss',                             'wings',           0.70, null),

  -- ---- Mexican / Tex-Mex -------------------------------------------------
  ('taco bell',                             'tacos',           0.70, 'americanized; arguably fast-food'),
  ('taco bueno',                            'tex-mex',         0.80, null),
  ('taco casa',                             'tacos',           0.80, null),
  ('fuzzys taco shop',                      'tacos',           0.85, null),
  ('laredo taco company',                   'tacos',           0.85, null),
  ('chipotle mexican grill',                'mexican',         0.85, null),
  ('cantina laredo',                        'mexican',         0.85, null),
  ('azteca mexican',                        'mexican',         0.80, null),
  ('panchos mexican buffet',                'tex-mex',         0.85, null),
  ('hacienda buffet',                       'tex-mex',         0.70, null),
  ('rosas cafe',                            'tex-mex',         0.85, null),
  ('chilis grill bar',                      'tex-mex',         0.70, 'casual-dining Tex-Mex-leaning American'),

  -- ---- Pizza -------------------------------------------------------------
  ('pizza hut express',                     'pizza-classic',   0.95, null),
  ('papa johns',                            'pizza-classic',   0.95, null),
  ('cicis pizza',                           'pizza-classic',   0.95, null),
  ('blaze pizza',                           'pizza-classic',   0.95, null),
  ('palios pizza cafe',                     'pizza-classic',   0.90, null),
  ('pizza takeout delivery',                'pizza-classic',   0.70, 'generic name, clearly pizza'),

  -- ---- Sandwiches / deli -------------------------------------------------
  ('subway',                                'deli-sandwiches', 0.95, null),
  ('subway restaurants',                    'deli-sandwiches', 0.95, null),
  ('jimmy johns',                           'deli-sandwiches', 0.95, null),
  ('jersey mikes subs',                     'deli-sandwiches', 0.95, null),
  ('firehouse subs',                        'deli-sandwiches', 0.95, null),
  ('cousins subs',                          'deli-sandwiches', 0.95, null),
  ('blimpie',                               'deli-sandwiches', 0.95, null),
  ('quiznos',                               'deli-sandwiches', 0.95, null),
  ('arbys',                                 'deli-sandwiches', 0.85, 'roast beef'),
  ('schlotzskys',                           'deli-sandwiches', 0.90, null),
  ('roly poly sandwiches',                  'deli-sandwiches', 0.90, null),
  ('philly connection',                     'deli-sandwiches', 0.85, null),
  ('charleys cheesesteaks and wings',       'deli-sandwiches', 0.80, null),
  ('pardon my cheesesteak',                 'deli-sandwiches', 0.70, 'delivery-only virtual brand'),
  ('mendocino farms',                       'deli-sandwiches', 0.85, null),
  ('newks eatery',                          'deli-sandwiches', 0.80, null),
  ('frullati',                              'deli-sandwiches', 0.70, null),
  ('frullati cafe',                         'deli-sandwiches', 0.70, null),

  -- ---- Coffee ------------------------------------------------------------
  ('starbucks',                             'coffee',          0.95, null),
  ('starbucks coffee company',              'coffee',          0.95, null),
  ('dutch bros coffee',                     'coffee',          0.95, null),
  ('scooters coffee',                       'coffee',          0.95, null),
  ('dunkin',                                'coffee',          0.80, 'coffee-led; also donuts'),
  ('dunkin donuts',                         'coffee',          0.80, 'coffee-led; also donuts'),
  ('7 brew coffee',                         'coffee',          0.95, null),
  ('black rock coffee bar',                 'coffee',          0.95, null),
  ('black rifle coffee company',            'coffee',          0.95, null),
  ('caribou coffee',                        'coffee',          0.95, null),
  ('pjs coffee',                            'coffee',          0.95, null),
  ('peets coffee tea',                      'coffee',          0.95, null),
  ('the coffee bean tea leaf',              'coffee',          0.95, null),
  ('saxbys coffee',                         'coffee',          0.95, null),
  ('summer moon coffee',                    'coffee',          0.90, null),
  ('ascension coffee',                      'coffee',          0.90, null),
  ('avoca coffee roasters',                 'coffee',          0.90, null),
  ('houndstooth coffee',                    'coffee',          0.90, null),
  ('white rhino coffee',                    'coffee',          0.90, null),
  ('white rock coffee',                     'coffee',          0.90, null),
  ('merit coffee',                          'coffee',          0.90, null),
  ('fiction coffee',                        'coffee',          0.90, null),
  ('buon giorno coffee',                    'coffee',          0.90, null),
  ('haraz coffee house',                    'coffee',          0.90, null),
  ('liberation coffee co',                  'coffee',          0.90, null),
  ('beans brews coffee house',              'coffee',          0.90, null),
  ('sweetwaters coffee tea',                'coffee',          0.90, null),
  ('sweetwaters coffee and tea',            'coffee',          0.90, null),
  ('sip stir coffee house',                 'coffee',          0.90, null),
  ('elevated grounds',                      'coffee',          0.80, null),
  ('151 coffee',                            'coffee',          0.90, null),
  ('1418 coffee',                           'coffee',          0.90, null),
  ('ldu coffee to go',                      'coffee',          0.85, null),
  ('wfm coffee bar',                        'coffee',          0.80, 'Whole Foods in-store counter'),
  ('la la land',                            'coffee',          0.75, 'La La Land Kind Cafe'),
  ('cosmcs',                                'coffee',          0.75, 'beverage-led McDonald''s spinoff'),

  -- ---- Bakery ------------------------------------------------------------
  ('panera bread',                          'bakery',          0.85, null),
  ('walmart bakery',                        'bakery',          0.85, 'in-store counter, not a destination'),
  ('sams club bakery',                      'bakery',          0.85, 'in-store counter, not a destination'),
  ('nothing bundt cakes',                   'bakery',          0.95, null),
  ('great american cookies',                'bakery',          0.90, null),
  ('crumbl cookies',                        'bakery',          0.90, null),
  ('insomnia cookies',                      'bakery',          0.90, null),
  ('tiffs treats',                          'bakery',          0.90, null),
  ('tiffs treats cookie delivery',          'bakery',          0.90, null),
  ('auntie annes',                          'bakery',          0.85, 'pretzels'),
  ('wetzels pretzels',                      'bakery',          0.85, 'pretzels'),
  ('cinnabon',                              'bakery',          0.90, null),
  ('cinnabon at schlotzskys',               'bakery',          0.85, null),
  ('cinnaholic',                            'bakery',          0.90, null),
  ('paris baguette',                        'bakery',          0.90, null),
  ('tous les jours',                        'bakery',          0.90, null),
  ('corner bakery',                         'bakery',          0.90, null),
  ('corner bakery cafe',                    'bakery',          0.90, null),
  ('paradise bakery cafe',                  'bakery',          0.90, null),
  ('atlanta bread company',                 'bakery',          0.90, null),
  ('celebrity cafe bakery',                 'bakery',          0.90, null),
  ('au bon pain',                           'bakery',          0.85, null),
  ('85 c bakery cafe',                      'bakery',          0.90, null),
  ('85c bakery cafe',                       'bakery',          0.90, null),
  ('anakaren bakery',                       'bakery',          0.90, null),
  ('del norte bakery',                      'bakery',          0.90, null),
  ('busy bs bakery',                        'bakery',          0.90, null),
  ('unrefined bakery',                      'bakery',          0.90, null),
  ('monique bakery',                        'bakery',          0.90, null),
  ('latham bakery',                         'bakery',          0.90, null),
  ('mozart bakery',                         'bakery',          0.90, null),
  ('village baking co',                     'bakery',          0.90, null),
  ('creations baking company',              'bakery',          0.90, null),
  ('la popular panaderia',                  'bakery',          0.90, null),
  ('susiecakes',                            'bakery',          0.90, null),
  ('joy macarons',                          'bakery',          0.90, null),
  ('cake bliss',                            'bakery',          0.85, null),
  ('kolache factory',                       'bakery',          0.90, null),
  ('eatzis market bakery',                  'bakery',          0.85, null),
  ('eatzis market and bakery',              'bakery',          0.85, null),
  ('la madeleine',                          'french',          0.85, 'French bakery-cafe'),

  -- ---- Ice cream ---------------------------------------------------------
  ('braums ice cream dairy store',          'ice-cream',       0.90, null),
  ('braums ice cream and dairy store',      'ice-cream',       0.90, null),
  ('dairy queen',                           'ice-cream',       0.65, 'DQ Grill & Chill mapped to burgers; brand is split'),
  ('dq grill chill',                        'burgers',         0.65, 'full-menu format; plain Dairy Queen is ice-cream'),

  -- ---- Breakfast / diner -------------------------------------------------
  ('ihop',                                  'breakfast',       0.90, null),
  ('waffle house',                          'breakfast',       0.90, null),
  ('dennys',                                'diner',           0.90, null),
  ('dennys restaurant',                     'diner',           0.90, null),
  ('mamas daughters diner',                 'diner',           0.90, null),
  ('triple a cafe',                         'diner',           0.80, null),
  ('blue mound cafe',                       'diner',           0.80, null),
  ('buzzbrews kitchen',                     'diner',           0.80, null),
  ('mimis cafe',                            'breakfast',       0.80, null),
  ('starwood cafe',                         'breakfast',       0.80, null),
  ('sunny street cafe',                     'breakfast',       0.85, null),
  ('seven mile cafe',                       'breakfast',       0.85, null),
  ('main street cafe',                      'breakfast',       0.70, 'generic name; may be several unrelated places'),
  ('country cafe',                          'breakfast',       0.65, 'generic name; may be several unrelated places'),
  ('yellow rose cafe',                      'breakfast',       0.70, null),
  ('masons cafe',                           'breakfast',       0.70, null),
  ('stir cafe',                             'cafe',            0.70, null),
  ('cafe brazil',                           'cafe',            0.75, 'Dallas 24h cafe, not Brazilian'),
  ('cotton patch cafe',                     'southern',        0.85, 'Texas home cooking'),
  ('grandys',                               'comfort-food',    0.75, null),
  ('lubys',                                 'comfort-food',    0.85, 'cafeteria'),

  -- ---- Asian -------------------------------------------------------------
  ('panda express',                         'chinese',         0.90, null),
  ('china king super buffet',               'chinese',         0.90, null),
  ('king buffet',                           'chinese',         0.70, null),
  ('asian buffet',                          'pan-asian',       0.75, null),
  ('asian king buffet',                     'pan-asian',       0.75, null),

  -- ---- Smoothies / bowls / salad -----------------------------------------
  ('smoothie king',                         'juice-smoothie',  0.95, null),
  ('smoothie factory',                      'juice-smoothie',  0.90, null),
  ('planet smoothie',                       'juice-smoothie',  0.90, null),
  ('playa bowls',                           'bowls',           0.90, null),
  ('salad and go',                          'salad',           0.95, null),
  ('salata',                                'salad',           0.90, null),

  -- ---- Bars / casual dining ----------------------------------------------
  ('bennigans',                             'irish-pub',       0.75, null),
  ('houlihans',                             'bar',             0.75, null),
  ('tgi fridays',                           'bar',             0.70, null),
  ('hidden door',                           'bar',             0.70, null),
  ('romanos macaroni grill',                'italian-classic', 0.90, null),

  -- ---- Misc --------------------------------------------------------------
  ('dickeys barbecue pit',                  'barbecue-classic',0.95, null),
  ('long john silvers',                     'fish-and-chips',  0.90, null),
  ('hudson house',                          'seafood-classic', 0.70, null),
  ('golden corral',                         'buffet',          0.95, null),
  ('golden corral buffet and grill',        'buffet',          0.95, null),
  ('wienerschnitzel',                       'fast-food',       0.60, 'hot dogs; no hot-dog leaf in taxonomy'),
  ('potato corner',                         'fast-food',       0.70, null),
  ('foodgod truffle fries',                 'fast-food',       0.60, 'delivery-only virtual brand'),
  ('barstool bites',                        'fast-food',       0.60, 'delivery-only virtual brand'),
  ('nascar refuel',                         'fast-food',       0.55, 'delivery-only virtual brand'),
  ('the meltdown',                          'comfort-food',    0.65, 'delivery-only virtual brand; grilled cheese'),
  ('larrays loaded mac',                    'comfort-food',    0.65, 'delivery-only virtual brand'),
  ('soup man',                              'comfort-food',    0.65, 'delivery-only virtual brand')
) as v(name_norm, cuisine_slug, confidence, note)
join cuisines c on c.slug = v.cuisine_slug;
