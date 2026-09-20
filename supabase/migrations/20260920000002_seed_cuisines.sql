-- Elsewhere — cuisine taxonomy seed
--
-- This is OUR taxonomy, not a data source's. Overture and Foursquare category
-- strings are mapped onto it at ingest via category_cuisine_map; source
-- taxonomies are inconsistent between providers and change between releases,
-- so the app must never filter on them directly.
--
-- Two levels: groups (parent_id is null) organise the filter UI, leaves are
-- what a place is actually tagged with and what users filter by. Filtering on
-- a group means filtering on all of its leaves.

-- --- Groups ---------------------------------------------------------------

insert into cuisines (slug, label) values
  ('american',                    'American'),
  ('italian',                     'Italian'),
  ('pizza',                       'Pizza'),
  ('mexican-latin',               'Mexican & Latin'),
  ('asian',                       'Asian'),
  ('mediterranean-middle-eastern','Mediterranean & Middle Eastern'),
  ('european',                    'European'),
  ('african',                     'African'),
  ('barbecue',                    'Barbecue'),
  ('seafood',                     'Seafood'),
  ('breakfast-cafe',              'Breakfast & Cafe'),
  ('bakery-dessert',              'Bakery & Dessert'),
  ('bars-drinks',                 'Bars & Drinks'),
  ('fast-casual',                 'Fast & Casual'),
  ('dietary',                     'Dietary');

-- --- Leaves ---------------------------------------------------------------

insert into cuisines (slug, label, parent_id)
select v.slug, v.label, p.id
from (values
  -- American
  ('new-american',    'New American',        'american'),
  ('southern',        'Southern',            'american'),
  ('soul-food',       'Soul Food',           'american'),
  ('cajun-creole',    'Cajun & Creole',      'american'),
  ('diner',           'Diner',               'american'),
  ('burgers',         'Burgers',             'american'),
  ('steakhouse',      'Steakhouse',          'american'),
  ('deli-sandwiches', 'Deli & Sandwiches',   'american'),
  ('wings',           'Wings',               'american'),
  ('comfort-food',    'Comfort Food',        'american'),
  ('hawaiian',        'Hawaiian',            'american'),

  -- Italian
  ('italian-classic', 'Italian',             'italian'),
  ('pasta',           'Pasta',               'italian'),

  -- Pizza
  ('pizza-classic',   'Pizza',               'pizza'),
  ('neapolitan',      'Neapolitan',          'pizza'),

  -- Mexican & Latin
  ('mexican',         'Mexican',             'mexican-latin'),
  ('tex-mex',         'Tex-Mex',             'mexican-latin'),
  ('tacos',           'Tacos',               'mexican-latin'),
  ('peruvian',        'Peruvian',            'mexican-latin'),
  ('cuban',           'Cuban',               'mexican-latin'),
  ('brazilian',       'Brazilian',           'mexican-latin'),
  ('argentinian',     'Argentinian',         'mexican-latin'),
  ('caribbean',       'Caribbean',           'mexican-latin'),
  ('latin-american',  'Latin American',      'mexican-latin'),

  -- Asian
  ('chinese',         'Chinese',             'asian'),
  ('dim-sum',         'Dim Sum',             'asian'),
  ('japanese',        'Japanese',            'asian'),
  ('sushi',           'Sushi',               'asian'),
  ('ramen',           'Ramen',               'asian'),
  ('thai',            'Thai',                'asian'),
  ('vietnamese',      'Vietnamese',          'asian'),
  ('korean',          'Korean',              'asian'),
  ('indian',          'Indian',              'asian'),
  ('pakistani',       'Pakistani',           'asian'),
  ('filipino',        'Filipino',            'asian'),
  ('malaysian',       'Malaysian',           'asian'),
  ('indonesian',      'Indonesian',          'asian'),
  ('poke',            'Poke',                'asian'),
  ('pan-asian',       'Pan-Asian',           'asian'),

  -- Mediterranean & Middle Eastern
  ('mediterranean',   'Mediterranean',       'mediterranean-middle-eastern'),
  ('greek',           'Greek',               'mediterranean-middle-eastern'),
  ('turkish',         'Turkish',             'mediterranean-middle-eastern'),
  ('lebanese',        'Lebanese',            'mediterranean-middle-eastern'),
  ('israeli',         'Israeli',             'mediterranean-middle-eastern'),
  ('persian',         'Persian',             'mediterranean-middle-eastern'),
  ('middle-eastern',  'Middle Eastern',      'mediterranean-middle-eastern'),
  ('halal',           'Halal',               'mediterranean-middle-eastern'),

  -- European
  ('french',          'French',              'european'),
  ('spanish',         'Spanish',             'european'),
  ('tapas',           'Tapas',               'european'),
  ('german',          'German',              'european'),
  ('eastern-european','Eastern European',    'european'),
  ('british',         'British',             'european'),
  ('irish-pub',       'Irish Pub',           'european'),
  ('portuguese',      'Portuguese',          'european'),

  -- African
  ('ethiopian',       'Ethiopian',           'african'),
  ('moroccan',        'Moroccan',            'african'),
  ('west-african',    'West African',        'african'),

  -- Barbecue
  ('barbecue-classic','Barbecue',            'barbecue'),
  ('smokehouse',      'Smokehouse',          'barbecue'),

  -- Seafood
  ('seafood-classic', 'Seafood',             'seafood'),
  ('oyster-bar',      'Oyster Bar',          'seafood'),
  ('fish-and-chips',  'Fish & Chips',        'seafood'),
  ('crab-house',      'Crab House',          'seafood'),

  -- Breakfast & Cafe
  ('breakfast',       'Breakfast',           'breakfast-cafe'),
  ('brunch',          'Brunch',              'breakfast-cafe'),
  ('coffee',          'Coffee',              'breakfast-cafe'),
  ('cafe',            'Cafe',                'breakfast-cafe'),
  ('bagels',          'Bagels',              'breakfast-cafe'),
  ('donuts',          'Donuts',              'breakfast-cafe'),

  -- Bakery & Dessert
  ('bakery',          'Bakery',              'bakery-dessert'),
  ('dessert',         'Dessert',             'bakery-dessert'),
  ('ice-cream',       'Ice Cream',           'bakery-dessert'),
  ('chocolate',       'Chocolate',           'bakery-dessert'),

  -- Bars & Drinks
  ('bar',             'Bar',                 'bars-drinks'),
  ('cocktail-bar',    'Cocktail Bar',        'bars-drinks'),
  ('brewery',         'Brewery',             'bars-drinks'),
  ('brewpub',         'Brewpub',             'bars-drinks'),
  ('wine-bar',        'Wine Bar',            'bars-drinks'),
  ('sports-bar',      'Sports Bar',          'bars-drinks'),
  ('pub',             'Pub',                 'bars-drinks'),
  ('distillery',      'Distillery',          'bars-drinks'),
  ('juice-smoothie',  'Juice & Smoothies',   'bars-drinks'),
  ('tea-house',       'Tea House',           'bars-drinks'),

  -- Fast & Casual
  ('fast-food',       'Fast Food',           'fast-casual'),
  ('food-truck',      'Food Truck',          'fast-casual'),
  ('buffet',          'Buffet',              'fast-casual'),
  ('bowls',           'Bowls',               'fast-casual'),
  ('salad',           'Salad',               'fast-casual'),
  ('food-hall',       'Food Hall',           'fast-casual'),

  -- Dietary (cross-cutting: a place can be Thai AND vegan)
  ('vegetarian',      'Vegetarian',          'dietary'),
  ('vegan',           'Vegan',               'dietary'),
  ('gluten-free',     'Gluten-Free',         'dietary')
) as v(slug, label, parent)
join cuisines p on p.slug = v.parent;
