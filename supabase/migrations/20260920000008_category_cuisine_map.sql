-- Map all 182 Overture categories in the North Texas extract onto our cuisine
-- taxonomy. This is the two-thirds of the catalog the brand map does not
-- touch, and it is the mapping the spec calls the hardest data problem in the
-- project.
--
-- It is less hard than the spec assumed, because Overture's hierarchical
-- taxonomy did most of the work: many leaves are already cuisine-shaped, and
-- where ours is coarser than theirs the hierarchy says exactly which parent
-- to fall back to (salvadoran_restaurant -> latin-american, and so on).
--
-- Three kinds of row here, and the `note` column says which is which:
--   1. Exact matches, confidence 0.95. mexican_restaurant -> mexican.
--   2. Coarser fallbacks, 0.6-0.85. Our taxonomy has no Salvadoran or
--      Jamaican leaf, so those land on latin-american and caribbean. The note
--      records what was lost, so it can be recovered if the taxonomy grows.
--   3. Sixteen categories with NO cuisine, cuisine_id null. `restaurant`
--      (4,602 rows), `theme_restaurant`, `bistro`, `food_and_drink`. These
--      are venue types, not cuisines. They are exactly what the brand map and
--      the name pass exist to resolve, and a null here is a real answer, not
--      a gap in this table.
--
-- Everything is reviewed = false. Proposed, not reviewed.

alter table category_cuisine_map add column note text;

insert into category_cuisine_map (source_category, cuisine_id, confidence, note)
select v.source_category, c.id, v.confidence, v.note
from (values
  ('restaurant', null, 0.0, 'venue type, no cuisine'),
  ('fast_food_restaurant', 'fast-food', 0.9, null),
  ('mexican_restaurant', 'mexican', 0.95, null),
  ('pizza_restaurant', 'pizza-classic', 0.95, null),
  ('coffee_shop', 'coffee', 0.95, null),
  ('bakery', 'bakery', 0.95, null),
  ('sandwich_shop', 'deli-sandwiches', 0.95, null),
  ('burger_restaurant', 'burgers', 0.95, null),
  ('donut_shop', 'donuts', 0.95, null),
  ('bar', 'bar', 0.95, null),
  ('american_restaurant', 'new-american', 0.65, 'no plain American leaf; see STATUS'),
  ('barbecue_restaurant', 'barbecue-classic', 0.95, null),
  ('chicken_restaurant', 'chicken', 0.95, null),
  ('ice_cream_shop', 'ice-cream', 0.95, null),
  ('cafe', 'cafe', 0.9, null),
  ('taco_restaurant', 'tacos', 0.95, null),
  ('italian_restaurant', 'italian-classic', 0.95, null),
  ('chinese_restaurant', 'chinese', 0.95, null),
  ('smoothie_juice_bar', 'juice-smoothie', 0.95, null),
  ('seafood_restaurant', 'seafood-classic', 0.95, null),
  ('bar_and_grill_restaurant', 'bar', 0.55, 'venue type; revisit with name signal'),
  ('texmex_restaurant', 'tex-mex', 0.95, null),
  ('breakfast_and_brunch_restaurant', 'breakfast', 0.9, null),
  ('dessert_shop', 'dessert', 0.95, null),
  ('sports_bar', 'sports-bar', 0.95, null),
  ('indian_restaurant', 'indian', 0.95, null),
  ('sushi_restaurant', 'sushi', 0.95, null),
  ('food_truck_stand', 'food-truck', 0.95, null),
  ('japanese_restaurant', 'japanese', 0.95, null),
  ('steakhouse', 'steakhouse', 0.95, null),
  ('thai_restaurant', 'thai', 0.95, null),
  ('mediterranean_restaurant', 'mediterranean', 0.95, null),
  ('delicatessen', 'deli-sandwiches', 0.9, null),
  ('vietnamese_restaurant', 'vietnamese', 0.95, null),
  ('lounge', 'bar', 0.6, 'venue type'),
  ('bubble_tea_shop', 'tea-house', 0.7, null),
  ('chicken_wings_restaurant', 'wings', 0.95, null),
  ('cocktail_bar', 'cocktail-bar', 0.95, null),
  ('asian_restaurant', 'pan-asian', 0.75, null),
  ('shaved_ice_shop', 'dessert', 0.8, null),
  ('pub', 'pub', 0.95, null),
  ('cajun_and_creole_restaurant', 'cajun-creole', 0.95, null),
  ('diner', 'diner', 0.95, null),
  ('candy_store', 'dessert', 0.7, null),
  ('korean_restaurant', 'korean', 0.95, null),
  ('asian_fusion_restaurant', 'pan-asian', 0.85, null),
  ('brewery', 'brewery', 0.95, null),
  ('winery', 'wine-bar', 0.7, null),
  ('salad_bar', 'salad', 0.95, null),
  ('bagel_shop', 'bagels', 0.95, null),
  ('latin_american_restaurant', 'latin-american', 0.9, null),
  ('tea_room', 'tea-house', 0.95, null),
  ('buffet_restaurant', 'buffet', 0.95, null),
  ('wine_bar', 'wine-bar', 0.95, null),
  ('frozen_yogurt_shop', 'ice-cream', 0.9, null),
  ('southern_american_restaurant', 'southern', 0.95, null),
  ('salvadoran_restaurant', 'latin-american', 0.8, 'no Salvadoran leaf'),
  ('comfort_food_restaurant', 'comfort-food', 0.95, null),
  ('food_and_drink', null, 0.0, 'venue type, no cuisine'),
  ('hookah_bar', 'bar', 0.6, 'venue type; food incidental'),
  ('greek_restaurant', 'greek', 0.95, null),
  ('beer_bar', 'bar', 0.7, null),
  ('french_restaurant', 'french', 0.95, null),
  ('dive_bar', 'bar', 0.85, null),
  ('soul_food', 'soul-food', 0.95, null),
  ('gastropub', 'pub', 0.7, null),
  ('theme_restaurant', null, 0.0, 'venue type, no cuisine'),
  ('health_food_restaurant', 'salad', 0.5, 'vague category; revisit'),
  ('cupcake_shop', 'bakery', 0.85, null),
  ('hot_dog_restaurant', 'fast-food', 0.55, 'no hot-dog leaf in taxonomy'),
  ('soup_restaurant', 'comfort-food', 0.6, null),
  ('hawaiian_restaurant', 'hawaiian', 0.95, null),
  ('halal_restaurant', 'halal', 0.95, null),
  ('african_restaurant', null, 0.0, 'no generic African leaf; see STATUS'),
  ('middle_eastern_restaurant', 'middle-eastern', 0.95, null),
  ('vegetarian_restaurant', 'vegetarian', 0.95, null),
  ('distillery', 'distillery', 0.95, null),
  ('vegan_restaurant', 'vegan', 0.95, null),
  ('beer_garden', 'brewery', 0.7, null),
  ('brazilian_restaurant', 'brazilian', 0.95, null),
  ('caribbean_restaurant', 'caribbean', 0.95, null),
  ('pan_asian_restaurant', 'pan-asian', 0.95, null),
  ('honduran_restaurant', 'latin-american', 0.8, 'no Honduran leaf'),
  ('poke_restaurant', 'poke', 0.95, null),
  ('chocolatier', 'chocolate', 0.95, null),
  ('pakistani_restaurant', 'pakistani', 0.95, null),
  ('tapas_bar', 'tapas', 0.95, null),
  ('ethiopian_restaurant', 'ethiopian', 0.95, null),
  ('irish_pub', 'irish-pub', 0.95, null),
  ('ramen_restaurant', 'ramen', 0.95, null),
  ('gelato_shop', 'ice-cream', 0.9, null),
  ('venezuelan_restaurant', 'latin-american', 0.8, 'no Venezuelan leaf'),
  ('lebanese_restaurant', 'lebanese', 0.95, null),
  ('milk_bar', 'dessert', 0.6, null),
  ('pancake_house', 'breakfast', 0.9, null),
  ('filipino_restaurant', 'filipino', 0.95, null),
  ('gay_bar', 'bar', 0.8, null),
  ('pretzel_shop', 'bakery', 0.75, null),
  ('turkish_restaurant', 'turkish', 0.95, null),
  ('coffee_roastery', 'coffee', 0.9, null),
  ('food_court', 'food-hall', 0.7, null),
  ('airport_lounge', null, 0.0, 'not a dining destination'),
  ('peruvian_restaurant', 'peruvian', 0.95, null),
  ('cigar_bar', 'bar', 0.6, 'venue type; food incidental'),
  ('gluten_free_restaurant', 'gluten-free', 0.95, null),
  ('taiwanese_restaurant', 'chinese', 0.7, 'no Taiwanese leaf'),
  ('bistro', null, 0.0, 'venue type, no cuisine'),
  ('german_restaurant', 'german', 0.95, null),
  ('cuban_restaurant', 'cuban', 0.95, null),
  ('fish_and_chips_restaurant', 'fish-and-chips', 0.95, null),
  ('jamaican_restaurant', 'caribbean', 0.8, 'no Jamaican leaf'),
  ('mongolian_restaurant', 'pan-asian', 0.6, 'Mongolian grill format'),
  ('speakeasy', 'cocktail-bar', 0.85, null),
  ('puerto_rican_restaurant', 'caribbean', 0.8, 'no Puerto Rican leaf'),
  ('doner_kebab_restaurant', 'turkish', 0.8, null),
  ('cheesesteak_restaurant', 'deli-sandwiches', 0.85, null),
  ('hotel_bar', 'bar', 0.8, null),
  ('internet_cafe', 'cafe', 0.7, null),
  ('popcorn_shop', 'dessert', 0.5, 'snack retail, arguably not dining'),
  ('acai_bowls', 'bowls', 0.95, null),
  ('persian_restaurant', 'persian', 0.95, null),
  ('cafeteria', 'comfort-food', 0.7, null),
  ('argentine_restaurant', 'argentinian', 0.95, null),
  ('afghani_restaurant', 'middle-eastern', 0.7, 'no Afghan leaf'),
  ('colombian_restaurant', 'latin-american', 0.8, 'no Colombian leaf'),
  ('fondue_restaurant', null, 0.0, 'no leaf; format not cuisine'),
  ('pie_shop', 'bakery', 0.8, null),
  ('spanish_restaurant', 'spanish', 0.95, null),
  ('nigerian_restaurant', 'west-african', 0.9, null),
  ('tiki_bar', 'cocktail-bar', 0.85, null),
  ('dominican_restaurant', 'caribbean', 0.8, 'no Dominican leaf'),
  ('dim_sum_restaurant', 'dim-sum', 0.95, null),
  ('whiskey_bar', 'cocktail-bar', 0.8, null),
  ('irish_restaurant', 'irish-pub', 0.65, 'restaurant, not a pub; closest leaf'),
  ('burmese_restaurant', 'pan-asian', 0.6, 'no Burmese leaf'),
  ('polynesian_restaurant', 'hawaiian', 0.7, null),
  ('australian_restaurant', null, 0.0, 'no leaf'),
  ('guatemalan_restaurant', 'latin-american', 0.8, 'no Guatemalan leaf'),
  ('malaysian_restaurant', 'malaysian', 0.95, null),
  ('cambodian_restaurant', 'pan-asian', 0.6, 'no Cambodian leaf'),
  ('eastern_european_restaurant', 'eastern-european', 0.95, null),
  ('macaron_shop', 'bakery', 0.85, null),
  ('bangladeshi_restaurant', 'indian', 0.6, 'no Bangladeshi leaf'),
  ('nicaraguan_restaurant', 'latin-american', 0.8, 'no Nicaraguan leaf'),
  ('egyptian_restaurant', 'middle-eastern', 0.6, 'Overture files under North African'),
  ('european_restaurant', null, 0.0, 'parent node, too generic'),
  ('british_restaurant', 'british', 0.95, null),
  ('dumpling_restaurant', 'chinese', 0.65, null),
  ('falafel_restaurant', 'middle-eastern', 0.85, null),
  ('polish_restaurant', 'eastern-european', 0.8, 'no Polish leaf'),
  ('portuguese_restaurant', 'portuguese', 0.95, null),
  ('indonesian_restaurant', 'indonesian', 0.95, null),
  ('empanada_restaurant', 'latin-american', 0.75, null),
  ('drive_thru_bar', 'bar', 0.7, null),
  ('laotian_restaurant', 'pan-asian', 0.6, 'no Laotian leaf'),
  ('piano_bar', 'bar', 0.8, null),
  ('moroccan_restaurant', 'moroccan', 0.95, null),
  ('kosher_restaurant', null, 0.0, 'dietary; no kosher leaf in taxonomy'),
  ('syrian_restaurant', 'middle-eastern', 0.8, 'no Syrian leaf'),
  ('cidery', 'brewery', 0.6, 'no cidery leaf'),
  ('wine_tasting_room', 'wine-bar', 0.8, null),
  ('international_fusion_restaurant', null, 0.0, 'too generic'),
  ('south_african_restaurant', null, 0.0, 'no leaf'),
  ('armenian_restaurant', 'middle-eastern', 0.7, 'no Armenian leaf'),
  ('wok_restaurant', 'chinese', 0.7, null),
  ('georgian_restaurant', 'middle-eastern', 0.55, 'Overture files under Middle Eastern'),
  ('champagne_bar', 'wine-bar', 0.85, null),
  ('uzbek_restaurant', 'middle-eastern', 0.6, 'no Uzbek leaf'),
  ('sri_lankan_restaurant', 'indian', 0.6, 'no Sri Lankan leaf'),
  ('arabian_restaurant', 'middle-eastern', 0.8, null),
  ('kombucha_bar', 'juice-smoothie', 0.6, null),
  ('meat_restaurant', null, 0.0, 'parent node, too generic'),
  ('diy_foods_restaurant', null, 0.0, 'not a cuisine'),
  ('non_alcoholic_beverage_venue', null, 0.0, 'parent node, too generic'),
  ('indo_chinese_restaurant', 'chinese', 0.7, null),
  ('himalayan_restaurant', 'indian', 0.6, 'Nepali/Tibetan; no leaf'),
  ('pop_up_restaurant', null, 0.0, 'venue type, no cuisine'),
  ('live_and_raw_food_restaurant', 'vegan', 0.6, null),
  ('russian_restaurant', 'eastern-european', 0.8, 'no Russian leaf'),
  ('ukrainian_restaurant', 'eastern-european', 0.8, 'no Ukrainian leaf'),
  ('austrian_restaurant', 'german', 0.7, 'no Austrian leaf'),
  ('czech_restaurant', 'eastern-european', 0.8, 'no Czech leaf')
) as v(source_category, cuisine_slug, confidence, note)
-- LEFT JOIN so the sixteen deliberate no-cuisine rows still land. That also
-- means a typo'd slug would silently become null, so the count is asserted
-- immediately below.
left join cuisines c on c.slug = v.cuisine_slug;

do $$
declare
  unmapped int;
  total    int;
begin
  select count(*) into total    from category_cuisine_map;
  select count(*) into unmapped from category_cuisine_map where cuisine_id is null;
  if total <> 182 then
    raise exception 'category_cuisine_map: expected 182 categories, got %', total;
  end if;
  if unmapped <> 16 then
    raise exception
      'category_cuisine_map: expected exactly 16 categories with no cuisine, got %. A cuisine slug is probably misspelled.',
      unmapped;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PRECEDENCE, for promote and anything else that resolves a cuisine.
--
--     coalesce(brand_cuisine_map.cuisine_id, category_cuisine_map.cuisine_id)
--
-- BRAND WINS. This is not arbitrary. Measured across the 39,852 North Texas
-- rows, the two disagree on 3,414 of them, and the brand is more specific in
-- essentially every case:
--
--   category      brand             rows   example
--   fast-food  -> burgers           1222   A&W Restaurant
--   fast-food  -> chicken            627   Bojangles
--   fast-food  -> tacos              208   Fuzzy's Taco Shop
--   fast-food  -> deli-sandwiches    191   Arby's
--   chicken    -> wings              129   Wingstop
--   fast-food  -> ice-cream           73   Braum's
--   cafe       -> coffee              49   Ascension Coffee
--
-- The reasoning: the category is Overture's guess about a venue, while the
-- brand map is 201 hand-written assertions about chains we actually know.
-- "McDonald's is a burger place" beats "Overture filed this under fast food".
--
-- Taking them the other way round would leave 3,414 places filed under
-- generic `fast-food`, and nobody browsing for burgers would find McDonald's.
--
-- Coverage is 88.6% either way -- precedence changes WHICH cuisine, not
-- whether there is one.
