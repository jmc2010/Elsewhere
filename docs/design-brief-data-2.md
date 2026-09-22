# Design brief — phone, churn, and the open queries

Answers to the two outstanding items, plus the queries left open. One of them
does not have the answer you asked for, and the reason matters.

---

## 1. Phone — clean enough for one formatter, with a narrow fallback

**88% of the North Texas food set has a phone**: 35,155 of 39,765. At most two
numbers per place, and only 11 rows in the whole set have more than one — so
treat `phones` as a single value and take `[0]`.

The formats are mixed, as you expected. Four shapes:

| Shape | Rows | % |
|---|---:|---:|
| `+12142325163` — E.164 US | 24,049 | 60.5 |
| `(903) 357-5368` — already display-formatted | ~5,300 | 13.4 |
| `2149871704` — bare 10 digits | 3,811 | 9.6 |
| `14697170999` — 11 digits, no `+` | 1,914 | 4.8 |
| non-US E.164 | 44 | 0.1 |

**Strip every non-digit, then:**

- 10 digits → format as `(XXX) XXX-XXXX`
- 11 digits starting `1` → drop the `1`, format the rest
- anything else → show the raw string

**That rule covers 99.79% of places that have a phone** — 35,080 of 35,155.
The fallback fires on 75 rows in the whole metro, essentially all non-US
numbers. So write the formatter you specced; the fallback is real but it will
almost never be seen.

Note the 13.4% already arriving as `(903) 357-5368`: your chosen display
format is what a good chunk of the source data already uses, which is a small
point in its favour.

**Twenty raw samples**, unedited:

```
+12142325163   Bakery Support Services Worldwide
2149871704     Frank's Taco Grill
+12143202424   Cicis Pizza
+18175232888   Taco Time Mexican Grill
14697170999    Bb.q Chicken Carrollton
+14696444086   Đoàn Chả Ốc
+18178868656   Cultivate Community Workspace
2143704550     Wing Boss
+18173770605   Firehouse Subs
+19722431216   Monica's Restaurant
+18178605842   Jack in the Box
+14695739500   Firehouse Subs
8174398028     Big Deal Burger Co
+19727710993   Topcloudvapor
+12146799375   Whats That Seasoning
+19409995566   Torchy's Tacos
+19408916060   I Love Sushi
+16823745774   Taqueria Tlaquepaque
+16822318369   Taco Bell
+18172513062   Monkey King
```

Phone is not in the catalog yet. Adding it is one line on the next ingest and
it is free — unlike opening hours, which are Google's and billed per request.

---

## 2. The monthly diff — cannot be run, and here is why that is itself an answer

**There is only one Overture release in existence to diff against.**

- `2026-08-19.0` — the one the catalog is built from
- `2026-07-22.0` — the prefix still exists in S3 but **the data is gone**;
  listing it returns zero files
- No September release has been published yet (checked 2026-09-21)

Overture ships roughly monthly and keeps a short window of releases. So the
four counts you asked for — disappeared, appeared, renamed in place, moved —
are not computable today by anyone, including us. The next release should land
within days, and the diff is a small job once it does.

**I would rather tell you that than hand you a number derived from something
else and let you design on it.**

### What can be said now

Each place carries an upstream `update_time` from its original provider. That
distribution is a genuine freshness signal:

| Last touched upstream | Rows | % |
|---|---:|---:|
| This release cycle (Aug 2026) | 31,118 | 78.3 |
| Earlier in 2026 | 831 | 2.1 |
| During 2025 | 5,438 | 13.7 |
| Before 2025 | 2,378 | 6.0 |

**About one place in five has not been touched upstream in over eight months,
and 6% not since 2024.** That is not the same as churn between releases, and I
do not want to blur them — but it does bound the problem. A record untouched
since 2024 is where the stale entries live: Rider's Smokehouse, the closed
Dairy Queen.

### How this bears on your fork

Your question was whether churn is ~60 rows or ~4,000 — meaningful signal
versus ingest noise. The honest position:

- **The 78% refreshed this cycle is a bulk provider timestamp**, not 31,118
  real changes. Most of it will be no-op re-confirmation.
- **A content diff will therefore be noisy** and I would not trust "name
  changed" or "coordinates moved" as a user-facing signal without seeing the
  numbers first.
- **An identity diff — appeared and disappeared — is the trustworthy half**,
  and it is also the half your closure-inference question depends on.

**My suggestion:** spec the frontier card and the "new around here" tick as
*conditional*, with the rule written down but the threshold left open. When the
September release lands we run the diff and the number decides whether they
ship. That keeps the design work from blocking on something a few days away,
without committing to a feature the data might not support.

If you would rather wait for the real counts before drawing them at all, say
so — that is a reasonable call and the delay is days, not weeks.

---

## 3. The open queries

### Longest names — your truncation rule

| Chars | Name |
|---:|---|
| 81 | Juice Junkies - Raw Organic Cold-pressed Juice, Superfood Smoothies & Vegan Bites |
| 81 | 7 Spice Halal Indian & Pakistani Kitchen & Catering(Inside the Revolving Kitchen) |
| 79 | CC's Cupcake Heaven - Cupcakes, Custom Cakes, Wedding Cakes in Fort Worth Texas |
| 79 | Smallcakes Cupcakery and Creamery at Double Oak, TX - www.smallcakeslantana.com |
| 78 | Crémeverse Café & Desserts \| Private Party Hall & Event Venue \| Ice Cream Café |
| 78 | Rufe Snow Wings & Burgers \| Best burgers and chicken wings, bar in Watauga, TX |
| 78 | Sigree Grill Indian Restaurant and Banquet ( Authentic Punjabi Chulha - Oven ) |
| 77 | The Original Ali Baba Authentic Lebanese Grill since 1988 On Lower Greenville |

Distribution:

| Length | Rows |
|---|---:|
| ≤ 20 chars | 27,490 (70%) |
| 21–30 | 9,225 (23%) |
| 31–40 | 2,093 (5%) |
| > 40 | 489 (1.2%) |
| **Average** | **17.3** |
| **Longest** | **81** |

**The tail is not a name, it is SEO.** Everything over about 45 characters is a
restaurant name with keywords bolted on — *"Best burgers and chicken wings, bar
in Watauga, TX"*, *"- www.smallcakeslantana.com"*. Truncating those mid-phrase
is not a loss; the useful part is almost always the first two or three words.

So a rule that reads well: **truncate at two lines** and accept that 1.2% lose
marketing copy. Truncating at one line would clip 28% of genuine names, which
is too aggressive. If you want a cleaner card, there is a case for stripping
everything after a `|` or ` - ` at ingest — say the word and it can be tested.

### Places with neither cuisine nor website

**2,076 rows, 5.3%.** These are the barest cards possible: a name, a distance,
and nothing else. No cuisine tag, no website, and — being mostly unresolvable
independents — probably no rating either.

That is the true floor of the card design. If the layout holds for these, it
holds for everything.

---

**Still happy to run more.** Anything that pins a decision you are currently
taking on faith is worth the two minutes.
