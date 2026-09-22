# Elsewhere — implementation spec, design pass one

Handoff for Claude Code. Canvas: `elsewhere-canvas.html` (published artifact).
Stack: **React Native / Expo**, iOS + Android. Light and dark, dark primary.

### Stack notes before you start

- **Tokens ship as a typed theme object** (`theme/tokens.ts`) with `light` and
  `dark` keys, consumed through a `ThemeProvider` and a `useTheme()` hook. No
  colour literal in any component, ever — the two themes are the reason.
- **Fonts via `expo-font`.** One caution: React Native's support for
  `fontVariationSettings` is not dependable across both platforms. The spec uses
  five distinct Fraunces axis combinations; verify runtime axis support before
  relying on it, and if it doesn't hold, **ship static instances** of Fraunces at
  those five settings rather than approximating with the nearest weight. The
  `SOFT` and `WONK` axes are doing the hand-painted work — losing them loses the
  brand.
- **No platform-standard components anywhere.** Everything is drawn: pills,
  toggles, sheets, buttons. That is deliberate — an iOS segmented control and a
  Material chip would make one product look like two.
- Use `react-native-safe-area-context` for the pinned action bar.

---

## 0. The idea, in one line

**Painted, not printed.** A chain has a brand manual; an independent has a sign
somebody painted. The name is the hero at display size; everything else is one
quiet line beneath it. A sign with nothing but a name is a complete sign — which
is why this layout has no hole in it when 30% of the catalog has no rating.

Register: **the friend who cooks.** Opinionated, informal, never neutral. The app
speaks in first person about its own judgment and never about the user's
("I'd send you here", never "you'll love this").

---

## 1. Tokens

Emit as a single source of truth (Swift `Color` extension + Kotlin/Compose
`ColorScheme`, or a shared JSON the build consumes). Never hard-code a colour in
a component.

### Dark (primary)

| Token | Value | Use |
|---|---|---|
| `ground` | `#14110D` | Screen background |
| `surface` | `#1E1A15` | Sheets, cards that lift, review blocks |
| `surface2` | `#29231B` | Inset controls, avatars |
| `ink` | `#F1EADD` | Primary text |
| `inkMuted` | `#A79C8A` | Meta line, secondary text |
| `inkFaint` | `#968974` | Labels, counts, separators, attribution |
| `rule` | `#332C22` | Hairlines between cards |
| `ruleStrong` | `#6E5E46` | Interactive boundaries (pills, buttons, toggles) |
| `brass` | `#E0A94A` | The only action colour |
| `brassInk` | `#14110D` | Text on brass |
| `green` | `#6FB189` | Confirmed / yours / a named friend |
| `oxblood` | `#C4685A` | Closure and caution only. Never full-bleed. |
| `glow` | `rgba(224,169,74,.13)` | Reveal screen radial only |

### Light (daylight)

| Token | Value |
|---|---|
| `ground` | `#E4E1D6` |
| `surface` | `#F3F1E9` |
| `surface2` | `#EAE7DC` |
| `ink` | `#1F1B15` |
| `inkMuted` | `#625B4E` |
| `inkFaint` | `#696357` |
| `rule` | `#D2CDBE` |
| `ruleStrong` | `#858072` |
| `brass` | `#7E5A18` |
| `brassInk` | `#FFF8E9` |
| `green` | `#2C6448` |
| `oxblood` | `#8F3627` |
| `glow` | `rgba(126,90,24,.09)` |

**These values were contrast-audited.** `inkFaint` and `ruleStrong` in
particular were raised from earlier drafts to clear 4.5:1 for text and 3:1 for
control boundaries against all three grounds. Do not darken them back toward the
ground for aesthetic reasons without re-checking.

### Type

Two families, both bundled (not system) — SF Pro and Roboto would make one
product look like two.

- **Fraunces** (variable: `opsz`, `wght`, `SOFT`, `WONK`) — names and voice.
- **Archivo** — interface, data, labels.

| Role | Family | Size / line | Variation |
|---|---|---|---|
| Pick (reveal) | Fraunces | 44 / 1.02, tracking −.015em | `opsz 144, wght 700, SOFT 44, WONK 1` |
| Detail name | Fraunces | 32 / 1.06 | `opsz 96, wght 650, SOFT 40, WONK 1` |
| Screen head | Fraunces | 25 / 1.14 | `opsz 60, wght 620, SOFT 36, WONK 1` |
| Card name | Fraunces | 22 / 1.14 | `opsz 48, wght 600, SOFT 34, WONK 1` |
| Voice (italic) | Fraunces italic | 17 / 1.40 | `opsz 36, wght 400, SOFT 60, WONK 1` |
| Body | Archivo | 15 / 1.50 | 400 |
| Card reason | Archivo italic | 13.5 / 1.45 | 400 |
| Meta | Archivo | 12.5 / 1.40 | 500 |
| Label | Archivo | 10.5 / 1.40, tracking .13em, uppercase | 700 |

Spacing scale: 4 / 8 / 12 / 16 / 20 / 24 / 32. Radii: 10 (fields), 12 (buttons,
tiles), 999 (pills). Use tabular figures for every distance, count and rating.

---

## 2. The shortlist card

One component, seven states, one grid. **The grid does not change between
states** — this is the whole point.

```
[ tick            ]   optional, 10.5 uppercase
  Name                Fraunces 22, max 2 lines, then ellipsis
  meta · meta · meta   12.5 muted, every element optional
  reason               13.5 italic, omitted if none is honest
[ action pill     ]   at most one
```

### States

| State | Tick | Reason text | Action |
|---|---|---|---|
| Inferred | — | `You've liked two other Tex-Mex places out this way.` | — |
| Yours, past cooldown | `Yours · liked` (green) | `You haven't been since March.` | — |
| Frontier (unverified) | `Nobody's been here` (brass) | `New name since the spring. You'd be first.` | `Call ahead` (brass) |
| Stale identity | — | `Might have changed hands — two people said the building's something else now.` | `Still there?` |
| Friend-attributed | First name (green) | `Dale: worth the drive, good bar.` | — |
| Friend caution | — | `**Seth:** wrong for kids on a Friday.` | — |
| Long / messy name | — | any | any |

### Rules

- **Name display cleaning.** Strip trailing locality suffixes and legal suffixes
  for display; keep the full string for search. Real cases from the catalog:
  `Funky Munky Shaved Ice Valley View`, `Cousins Maine Lobster — Dallas
  Fort-Worth, TX`, `TX | Teriyaki Madness Dallas`, `Jbm Specialties, Llc`.
  Also fix all-caps and bad casing (`Llc`, `Jbm`, `THE 1845`).
- **Rating** is one numeral plus a 10px glyph, at meta weight in muted ink.
  Never a five-star row, never a badge, never coloured. Its absence shortens the
  meta line; it must not leave an empty slot.
- **Reason** is omitted rather than filled. No filler.
- **Caution** is plain muted text, never a red badge. A conditional veto means
  *not with the four-year-old*, not *danger*.
- Two lines max on the name, `overflow-wrap: anywhere` so long unbroken strings
  cannot overflow.

---

## 3. Ranking — the load-bearing behaviour change

**Distance is a gate, not a sort key.** Measured: Valley View's places span 0.2–0.4
miles; ten Dallas places sit at 0.0. Distance discriminates nothing *within* a
town. It decides eligibility and then contributes nothing to order.

Order the shortlist entirely from local, free data:

1. Remove vetoed places (`Not again`, place-level).
2. Remove places visited inside the recency window.
3. Remove `Doubtful` / reported-gone records.
4. Score the remainder on: tag affinity to your history, friend verdicts
   (attributed, never averaged), confidence state, novelty.
5. Confidence is **weighted by distance** — an unverified place is a fine gamble
   at 2 miles and irresponsible at the top of the list at 22.
6. Cap at 10.

A shortlist must render completely with **zero Google calls**. Ratings, price and
open-now are a layer that lands on top, not a foundation.

### What is news depends on density

- **Urban**: news is a place you have never been.
- **Rural**: after a year you have been to most of 25 places, so news is *the
  place you forgot you liked*. Same rule, opposite content. Do not build two
  modes — build screens that behave honestly at any density.

### Favourites ("your usuals")

A favourite carries no information — you already know it is there. Usuals live on
a shelf reached deliberately and never auto-surface. They re-enter the shortlist
only once they have been out of rotation long enough to be news again (scaled to
the user's own pattern, not a fixed clock).

---

## 4. Reviews — the moat

### Verdict (three states, never stars)

| Verdict | Engine effect |
|---|---|
| **Again** | Eligible, boosted once cooldown clears |
| **It was fine** | Eligible, no boost, normal recency |
| **Not again** | Removed from the pool. A real veto. |

Veto list is visible and editable in profile. A permanent decision made in a bad
mood should not be permanent.

### Tags

Fixed vocabulary, no user-created tags. **The verdict decides which list is
shown** — same dimensions, wording flipped. One screen, one thumb, ~4 seconds.

| Again | Not again |
|---|---|
| Food was great | Food was off |
| Worth the drive | Not worth the drive |
| Good patio | Too loud |
| Quiet enough to talk | Slow |
| Good bar | Overpriced |
| Fast | Service was indifferent |
| Great with kids | Too crowded |
| Good for a date | Wrong for kids |
| Fits a group | Felt dirty |
| Fair price | Nothing for me on the menu |

### `It was fine` takes no tags

Tapping *It was fine* closes the sheet. One tap, done.

Neither list is right there. The positive list asks someone to praise a place
they were lukewarm about. The negative list is worse: showing a column of
complaints to somebody who said "fine" is a leading question, and it reframes
a neutral evening as a bad one on the way to recording it.

*It was fine* is already a complete answer. It means no complaints and no
pull, and that is exactly the signal the engine needs — eligible, no boost,
normal recency.

One small optional affordance follows it — **"Anything worth noting?"** —
which reveals **both** lists when tapped, for the "fine, but too loud" case
where somebody does have a specific thing to say.

This also makes the effort proportional to the information. The two verdicts
that carry real signal earn a tag step; the one that does not costs a single
tap.

### Tag propagation classes — important

Each tag carries a class that decides how far it travels:

- **Place** (`Food was off`, `Felt dirty`, `Service was indifferent`) — travels
  to connections; in a group session a veto carrying one of these *removes*.
- **Conditional** (`Too loud`, `Slow`, `Wrong for kids`, `Too crowded`) —
  travels as a visible note; removes only when tonight matches the condition.
- **Personal** (`Nothing for me on the menu`, `Not worth the drive`) — never
  travels. Shapes only that person's own list.

The positives mirror this: `Great with kids` only boosts when there are kids at
the table.

### Free text

Present, visibly optional, for the user's own memory ("ask for the corner
booth"). Not an engine input.

### Visibility

- Visible to **direct connections only**. One hop. Never friend-of-a-friend —
  that rebuilds an aggregate score by the back door.
- Never public, never averaged, never "3 of your friends liked this."
- **A veto with no tag does not travel.** If you will not say why, it stays
  yours.

---

## 5. Data corrections (the existence oracle)

Three corrections, mapping to the three real failures observed in Valley View:

| Correction | Case it fixes |
|---|---|
| **It's gone** | Closed, or moved away (Rider's Smokehouse) |
| **It's called something else now** + name field | Rebrand / rename (Dairy Queen → Tia's Tex-Mex; beverage plant → Texas Legacy Distillery) |
| **Not somewhere you eat or drink** | Non-destination record (`Jbm Specialties, Llc`, the beverage plant) |

A rename is the highest-value contribution in the app: it repairs the row **and**
unlocks the Google match from then on. Two independent reports drop a record to
`Doubtful`.

### Confidence states

Four, not three — Overture's upstream `update_time` splits the middle one.

- **Confirmed** — Google resolves it, *or* somebody in Elsewhere has reviewed it.
- **Listed, fresh** — no match, nobody's been, but confirmed upstream this
  release cycle. **This is the frontier card**: brass tick, *Nobody's told me
  about this one yet*, `Call ahead`. 78% of the catalog.
- **Listed, stale** — no match, and untouched upstream since 2024. Same visible
  symptom, opposite meaning. Muted treatment, *Might have changed hands*,
  `Still there?`. 6% of the catalog — and both known-closed Valley View places
  (Rider's Smokehouse, the shut Dairy Queen) sit in this bucket.
- **Reported gone** — two independent user reports. Suppressed from default
  shortlists, not deleted.

Copy must say *may have changed hands*, never *may not exist*. Every record
observed so far pointed at something real; the problem is identity drift, not
fabrication.

`update_time` is the freshness signal and it exists **today**, in the current
snapshot. It does not require a release diff.

### Confirmation counts are existence evidence, not opinion aggregates

`places.elsewhere_confirmations` counts how many people have recorded any
verdict for a place. It is public, exposed through `catalog_search`, and the
frontier card reads nothing from it but `> 0`.

This is deliberately not the aggregation §4 forbids, and the distinction is
recorded here so it does not get "corrected" later by someone reading §4 on
its own:

- **What §4 refuses to aggregate is opinions.** Averaging stars, or saying
  "3 of your friends liked this", destroys the attribution that makes a
  friend's verdict worth anything. *Dale: worth the drive, good bar* is useful
  because it is Dale. *4.2 from 9 people* is what every competitor already has
  and the reason none of them help.
- **A count of who has confirmed a place exists is not an opinion.** It is the
  existence oracle doing its job. It says nothing about whether anywhere is
  good and cannot be read as a ranking without misreading it.

Expose the count, never who, and never anything about what they thought.

Without it the frontier card cannot be built correctly. §5 defines it as *no
Google match AND nobody in Elsewhere has reviewed it*, and cross-user verdict
counts are unreadable under RLS — so the shortlist was substituting "unknown
to **you**", which is the same thing only while there is exactly one user.

### Co-location detection (free, no API call)

Two or more records within ~50m where one is a chain Google cannot resolve and
the other is an independent is the **successor pattern** (Dairy Queen /
Tia's Tex-Mex, 0.1 mi apart). The same geometric pass catches the Dallas
ghost-kitchen clusters. Run it in the ingest.

---

## 6. Controls

### Where — elastic to density

- **Low density**: the distance preset becomes a nearest-first **town list** with
  real catalog counts (Valley View 25, Sanger 41, Gainesville 166, Denton 612,
  Muenster 14). Rurally, distance is a cliff — 5 miles is a handful, 10 miles is
  a whole other town — so the town is the unit of choice.
- **High density**: reverts to miles, because downtown density really is
  continuous.
- "Somewhere I'm heading" stays — searching a town before you arrive is a
  decision-engine feature map-first competitors do badly.

### What — the filter sheet

- **Show only cuisine groups present, each with its count.** Fifteen groups in a
  twelve-place town is a screen of dead ends.
- **Never let a cuisine filter silently swallow the ~2,670 rows with no
  cuisine.** Uncategorised is not bad, same principle as unrated.
- **No star floor.** It contradicts the card and it promotes well-documented
  chains over the independents the product exists to surface. Replaced by
  tag-based mood filters, which are yours and free.
- **The sheet commits once.** No live re-render as you toggle; one fetch on
  dismissal. Cheaper, and the only version usable in a moving vehicle.
- Label anything that costs a lookup as costing one (`Open right now`).

---

## 7. Cost model

| Free (ours, unlimited) | Paid (Google, per request, never stored) |
|---|---|
| Name, cuisine, locality, distance | Star rating |
| Phone, website | Price level |
| Your verdicts, tags, visit history | Open now |
| Friends' verdicts and tags | Reviews (display only) |
| Confidence state | |

- Only two filters need Google: **star floor** (removed) and **open now**.
- `open now` can never be cached, even briefly — it changes by the minute.
- **Hydrate ONLY the displayed shortlist — the ≤10 after ranking.** Never the
  candidate pool.

  "The pool" meant ten when this was written and now means two hundred, and
  the two readings have very different bills. The candidate pool exists so
  ranking has something to choose from; it is Layer 1, free, and it is never
  sent to Google. Hydrating 200 rows per shortlist would exhaust a day's quota
  in an afternoon.

  The chain is: **200 candidates → rank → 10 displayed → hydrate those 10 →
  the reveal draws its 4 from the same 10.**

- **Rerolls are free**: the reveal draws from places the shortlist has already
  hydrated, so a reroll issues no call at all. The cap of three is therefore
  about commitment, not budget, and the copy can say so honestly.
- `phone` is ours and free. **"Call to check if they're open" costs nothing;
  "show the opening hours" costs money.** Lean on the former.

### Attribution (licence obligation)

- `Powered by Google` on any surface displaying Google's live data.
- Reviews shown **unmodified**, with reviewer name, photo and link.
- Place detail puts *yours* first, then *your people*, then Google's block
  visually separated — which is both the obligation and an honest signal about
  whose opinion is whose.

---

## 8. Cold start

No taste questionnaire. One screen of **recognition, not recall**: a grid of
nearby places, *"Which of these do you already know?"* Every tap is a visit
record. What novelty needs is not a list of what you like — it is a list of what
you already know.

First run asks for **location only**. No account. The account is **deferred** and
requested at the first moment it protects something real — after the second or
third review — framed as not losing what you have told it.

The friend invite is offered after the app first gets something right, never at
first run. Connections happen by a link sent to one person. **No contacts
scrape.** The social layer must be invisible on screen when you have no
connections — an empty Friends tab with an *Invite your friends!* banner
broadcasts that the app is unpopular.

---

## 9. Group sessions

- **Co-presence is not a feature.** Parents in the car do not install anything.
  It is a requirement that every screen be legible to a stranger at arm's length
  in a vehicle. You get it by doing the main work well.
- **Multi-device** is the only actual group feature. A session is a short-lived
  shared shortlist between people already connected.
- **No voting.** Voting adds work and relocates the deadlock into a tie. The fix
  for *"I don't care, you pick"* is **attribution**: the card says *Dale's been
  wanting to go back here.* Nobody has to assert a preference, because the app
  surfaced one that already existed.
- Resolution: anyone's place-level veto removes; recency is per-person; positive
  signal is **union, not intersection** (intersection returns an empty screen in
  a 166-place county).

---

## 10. Copy

| Moment | String |
|---|---|
| Primary action | `You pick.` |
| Commit | `That's the one.` |
| Sign-off | `Go eat.` |
| After committing | `I'll ask how it went tomorrow.` |
| No rating | `Nobody's told me about this one yet.` |
| Stale record | `Might have changed hands.` |
| Last reroll | `One more, then you're committing.` |
| Rural exhausted | `You've been to all four.` |
| Nothing matched | `Nothing out here fits that.` |
| Quota hit | `I'm out of Google's ratings for tonight.` |
| Location off | `I don't know where you are.` |
| Cold start | `Which of these do you already know?` |

Retired: `Surprise me`, `Lock it in`, `Bon appétit`, `No rating available`,
`Daily rating limit reached`, `Try adjusting your filters`.

Rerolls render as pips (spent = ring, live = filled brass), not a decrementing
integer. A number reads as a metered resource; pips read as a decision you are
using up.

---

## 11. Accessibility and car use

- Minimum touch target 44×44. The card's whole row is the target.
- Contrast: 4.5:1 for all text, 3:1 for control boundaries. The token values in
  §1 satisfy this; changing them requires re-auditing.
- Never encode state in colour alone — the reroll pips carry a ring as well as a
  fill for this reason.
- Respect Dynamic Type / font scale. The card must survive two lines of name at
  the largest setting.
- Respect reduced-motion.
- Dark is the default at night. Do not brighten the ground for consistency with
  light.

---

## 12. Ingest work and what remains open

### Do on the next ingest

1. **Add `phones`.** 88% coverage (35,155 of 39,765), free. Take `[0]` — only 11
   rows in the whole set have more than one. Formatter: strip every non-digit,
   then ten digits → `(XXX) XXX-XXXX`; eleven starting `1` → drop the `1` and
   format the rest; anything else → render the raw string. Covers 99.79%; the
   fallback fires on 75 rows, essentially all non-US.
2. **Carry `update_time` through** as a per-record freshness field. It drives the
   `Listed fresh` / `Listed stale` split in §5 and it is the only per-place age
   signal available.
3. **Derive `display_name`, keep `name`.** Average name is 17.3 chars but the
   tail is SEO, not names — *"Best burgers and chicken wings, bar in Watauga,
   TX"*, *"- www.smallcakeslantana.com"*. Proposed rule, conservative enough to
   leave real names alone: cut at the first `|`; cut at ` - ` / ` – ` / ` — `
   **only when the tail is longer than the head**; strip a trailing `www.*`.
   Test it over the 489 rows above 40 chars and eyeball before/after. Search
   keeps the original string.
4. **Run the co-location pass** (§5) — free, no API calls.

### Retain every release from now on — this is perishable

Overture keeps only a short window in S3: `2026-07-22.0`'s prefix still exists
but its data is **gone**, so the release the catalog was built from is currently
the only one that can be diffed against. Archive the identity set (id, name,
lat/lon, update_time — a few MB) of every release as it publishes. If this
doesn't start now, in six months there is still nothing to diff and the
*appeared / disappeared* signals stay unavailable permanently.

### Still open

- **`New around here`** — the "genuinely new to the catalog" tick. Needs two
  releases; only one exists. Rule is specified above, threshold stays open until
  the September release lands and the appeared/disappeared counts are known. Ship
  the frontier card without it.
- **Content-diff signals** (name changed in place, coordinates moved) are
  expected to be noisy, since 78% of records carry a bulk provider timestamp for
  the current cycle. Do not surface them to users without seeing real numbers.
- Outstanding queries: co-located cluster counts; localities with 1–4 places
  (the real hard case, not Valley View's 25).

### The floor card

**2,076 rows (5.3%) have neither cuisine nor website**, and being mostly
unresolvable independents, mostly no rating either. Name and distance, nothing
else. That is the true floor of the card design — if the layout holds there it
holds everywhere. It is drawn in the canvas as the eighth card state.

---

## 13. Navigation

**There is no tab bar.** A tab bar is a standing invitation to browse, and this
product exists to end a decision in ninety seconds. It would also put *Your
usuals* permanently on screen, which directly contradicts §3 — a favourite is
reached deliberately or it is not working as designed.

One stack, rooted at the shortlist. Four presentation kinds:

| Presentation | Screens |
|---|---|
| **Root** | Shortlist (the app) |
| **Push** | Place detail |
| **Full modal** | Reveal, Review capture, Cold start |
| **Sheet** | Town picker, Filter, Correction, The shelf |

### Entry points from the shortlist

- Location chip (header left) → **Town picker** sheet
- Lens chip (header, beside it) → **Filter** sheet
- `You pick.` (pinned, primary) → **Reveal** modal
- Card tap → **Place detail** push
- `Still there?` on a stale card, or an action on detail → **Correction** sheet
- Header right, one affordance → **The shelf** sheet: Your usuals, Your people,
  the veto list, settings

**The shelf is one sheet, not a section of the app.** Everything you might
return to deliberately lives behind a single tap and nothing else competes with
the primary action.

### Review capture is a prompt, not a destination

It arrives as a push the evening after a lock-in, or as an interstitial on the
next cold open. It is never something you navigate *to*. There is no "my
reviews" screen — reviews surface on the place they belong to.

### Cold start

Full modal on first launch, after the location permission, before the first
shortlist. Skippable. Never shown again.

---

## 14. Motion

Budget: nothing exceeds 600ms. The decision window is ninety seconds.

### The reveal — the one that matters

The failure mode is a slot machine. Do not cycle names, do not spin, do not
stagger characters. **A person with taste pauses and then tells you.** The name
arrives whole.

1. The shortlist dims to 40% and stays put; the reveal rises over it (240ms,
   ease-out). It came from the list, not from nowhere.
2. Name: fade in + translate up 8px, 320ms, ease-out. No scale.
3. Brass rule: draws left→right, 200ms, delayed 120ms.
4. Why-line: fade, 200ms, delayed 240ms.

### Reroll

The order is the whole point:

1. **Pip extinguishes first** (120ms).
2. Current name exits *upward* and fades (180ms) — dismissed, not shuffled.
3. New name enters from below (320ms).

You see the cost before you see the reward. That is what makes three rerolls
feel scarce rather than metered.

### Commit

`That's the one.` → brass rule expands to full width (280ms), actions crossfade
to Directions / Call, sign-off fades in last. Small and certain, no celebration.

### Sheets

Spring, 280ms, standard. **The filter sheet does not animate the list
underneath** — it commits once on dismissal (§6), so there is nothing to
animate, and a list reflowing under a thumb in a moving car is unusable.

### Reduced motion

Everything above collapses to a 120ms crossfade. No state is ever encoded in
motion alone — the reroll pips carry a ring as well as a fill for exactly this
reason.

---

## 15. Deliberately open

**These are starting values, not findings.** They are guesses that let the first
build run. Every one is expected to move once there is real behaviour to tune
against. Do not treat them as designed constants, do not bury them in component
files, and do not invent precision the data does not support — put them in one
config module so they can be changed without touching a screen.

| Knob | Start at | Tune against |
|---|---|---|
| Recency suppression, `It was fine` | 14 days | Repeat-visit rate |
| Recency suppression, unrated visit | 30 days | — |
| Cooldown, `Again` | 45 days | Re-lock-in rate |
| Forgotten-favourite resurface | 90 days since last visit | Lock-in rate on resurfaced usuals |
| Novelty ratio target | 7 new / 3 known | Lock-in rate, reroll rate |
| Reroll pool | Hydrate 10, reveal draws from top 4 | Reroll exhaustion rate |
| Confidence × distance | No unverified place in the top 3 beyond 10 mi | Correction-report rate |
| `New around here` threshold | **Unset** | The September Overture diff (§12) |

Ranking weights across tag affinity, friend verdicts, confidence and novelty are
**intentionally unspecified**. Build the scoring as a weighted sum with the
weights in that same config module, start them equal, and tune. A spec that
invented weights would be handing you magic numbers nobody chose.
