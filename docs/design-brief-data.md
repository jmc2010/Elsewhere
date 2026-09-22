# Design brief — answers on the data

Companion to `design-brief.md`. Three questions came back; all three are
answered below with real rows rather than a schema.

---

## 1. Record age

**There isn't a per-place age, and that is the interesting part.**

The catalog is a single Overture Maps release (`2026-08-19.0`) ingested in one
pass. Every row has the same timestamp. Overture ships monthly, so the plan is
a monthly re-ingest diffed against what is there.

What matters for design is that **age is not knowable per place, and staleness
is real**. Two confirmed cases from one small town:

- **Rider's Smokehouse**, Valley View — sold years ago, the premises have since
  been two other restaurants. Overture still lists it as open.
- **The Dairy Queen**, Valley View — shut; the building is now Tia's Tex-Mex.
  Overture lists it as open, and Google, asked directly, offered the Sanger
  branch 14 km away.

We infer closure for **chains** that Google cannot find, because Google's chain
coverage is effectively complete. For independents there is no automated
signal at all — and independents are the population this product exists to
surface.

**Design consequence:** some places in any list are gone and we cannot tell
which. A "this place has closed" report from the person standing outside it is
the only fix, and it is planned (spec §4.1). If you want to design that
reporting moment, it is genuinely load-bearing rather than a nice-to-have.

---

## 2. Phone

**Not in the catalog today. Available for about 82% of places, free.**

The extract never took the field. Overture carries it: of 765,437 food-and-
drink places sampled, **624,976 have a phone number (82%)**. Adding it is one
line on the next re-ingest and costs nothing.

**Worth knowing:** phone is *ours*, from open data. Ratings, hours and price
are Google's and cost money per request. So "call to check if they're open" is
free and "show the opening hours" is not. If a design leans on calling, that is
cheap — say so and it goes in the next ingest.

---

## 3. Catalog source

All 39,304 rows are `overture`. The schema allows a second source (`fsq`,
Foursquare Open Places) which is not yet used.

**The distinction that matters more than the source name:**

| Layer | What's in it | Where it lives |
|---|---|---|
| **1 — Catalog** | name, location, address, website, cuisine | Ours. Stored. Free to query. |
| **2 — Live** | rating, price, opening hours, reviews | Google. Fetched per request. **Never stored.** |
| **3 — History** | visits, your ratings, vetoes | Ours. Not built yet. |

The catalog holds **no ratings at all**. A star only exists for the moment a
shortlist is on screen. That is why roughly one card in four has none — see
§4 of the main brief.

---

## A real sample

### Rural — Valley View, the developer's town. 25 places in total.

| Name | Cuisine | Miles | Website |
|---|---|---|---|
| Dairy Queen | Ice Cream | 0.2 | yes |
| Tia's Tex-Mex | Tex-Mex | 0.3 | no |
| Subway | Deli & Sandwiches | 0.3 | yes |
| Pizza Inn | Pizza | 0.3 | yes |
| Jbm Specialties, Llc | *(none)* | 0.4 | yes |
| Lil Brick Oven Pizza | Pizza | 0.4 | yes |
| Middlebrooks Bar & Grill | Bar | 0.4 | no |
| Rider's Smokehouse | Barbecue | 0.4 | yes |
| Funky Munky Shaved Ice Valley View | Dessert | 0.4 | yes |
| The Bluebonnet Cafe and Coffee Bar | Tex-Mex | 0.4 | yes |
| Texas Legacy Distillery | Distillery | 0.4 | no |
| THE 1845 Bar & Lounge | Cocktail Bar | 0.4 | yes |

Note what this town looks like: **everything is within half a mile**, so
distance is nearly useless as a sort key here. `Jbm Specialties, Llc` is an
LLC filing that Overture classed as food. `Rider's Smokehouse` is one of the
two confirmed-closed places. This is the honest rural picture.

### Urban — Dallas, 8,360 places. Within two miles of downtown.

| Name | Cuisine | Miles |
|---|---|---|
| Big Deal Burger | Burgers | 0.0 |
| Indian | New American | 0.0 |
| K-Sha Coffee | Coffee | 0.0 |
| Dickey's Barbecue Pit | Barbecue | 0.0 |
| Trailer Birds | Chicken | 0.0 |
| Cousins Maine Lobster — Dallas Fort-Worth, TX | Seafood | 0.0 |
| TX \| Teriyaki Madness Dallas | Fast Food | 0.0 |
| Starbucks | Coffee | 0.0 |
| Wing Boss | Wings | 0.0 |
| Power Up Palace | Cafe | 0.1 |

**Ten places at 0.0 miles.** Several are delivery-only ghost-kitchen brands
sharing one address — `Big Deal Burger`, `Wing Boss`, `Trailer Birds`,
`Teriyaki Madness`. They are flagged in the data and kept out of shortlists,
but the density is real: distance cannot separate anything downtown. A place
literally named `Indian` is classified New American, which is wrong and is the
sort of noise that survives into production.

---

## Catalog shape

| | |
|---|---|
| Places | **39,304** |
| Towns (5+ places) | **181** of 354 localities |
| Cuisine leaves | **94**, in 15 groups |
| With a cuisine | **93.2%** |
| With a website | 32,634 (83%) |
| With a phone | **0 today, ~82% available** |
| Flagged closed | 7 by name, plus chain inference |

Density runs from **25 places in Valley View** to **8,360 in Dallas**. Both
have to work.

---

**Ask for more.** If a specific query would help — what a filtered list looks
like, how many places have neither cuisine nor website, what the longest names
are so the card does not break — say what you want to see and it will be run.
