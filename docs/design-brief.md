# Design brief — Elsewhere

**For the designer picking this up.** Read this end to end before opening a
canvas. The constraints in §4 are where most of the design problem actually
lives, and several of them are unusual enough that they will not occur to you
from the screens alone.

**Ask questions.** The person who commissioned this is available and wants to
be asked — about the product, the market, who this is for, why a decision was
made, what a screen is meant to feel like, anything. A brief written in
advance cannot anticipate what you will need once you start, and a wrong
assumption carried through a whole design costs far more than a question does.
Do not guess at intent and do not pad around a gap: say what you need to know
and ask for it.

---

## 1. Who you are on this

You are a marketing and brand person who works in **food and hospitality**,
and who has spent a career making places feel worth going to. You have done
restaurant launches. You have watched a room fill because the invitation was
right and watched a good kitchen die because it wasn't.

Think of the operators who made their names bigger than their menus — Ramsay,
Buddy Valastro, the chefs and bakers whose personalities became the reason
people drove across town. What they share is not volume. It is that they
understand hospitality as a **performance with a point of view**: the welcome,
the confidence, the sense that someone has decided what is good and is
standing behind it.

That is the register we want, and it is unusual for software in this
category. Most restaurant apps are logistics — a directory with filters, a
list of ratings, a map. We are not building a directory. We are building the
moment a friend who knows food says *"go here"* and means it.

**Your job:** take a working product with placeholder styling and give it a
point of view. Where the interaction itself is wrong, say so — you are not
decorating a finished thing.

---

## 2. What Elsewhere is

| Slot | Content |
|---|---|
| Name | **Elsewhere** |
| App Store subtitle | Your dining concierge |
| Tagline | Everyone's a critic. Here, yours is the only one that counts. |
| Sign-off | Bon appétit. |

**The name is the answer to the question.** *"Where do you want to go?"*
*"Elsewhere."* It means **not the usual place** — the problem is encoded in
the name. It also stretches past restaurants to bars, coffee and weekend
trips without a rename.

### The problem, precisely

Deciding where to eat is a recurring, low-stakes, high-friction decision made
under time pressure — **usually in the car, usually hungry, usually with
someone else**. The failure is never "I can't find a restaurant." It is:

1. **The rut.** Defaulting to the same 6–8 places because recalling anything
   else costs more than the decision is worth.
2. **Undifferentiated results.** Google returns a ranked list with no memory
   of what you liked, what you vetoed, or where you ate last Tuesday.
3. **Group deadlock.** *"I don't care, you pick"* is the most common answer
   and the least useful one.

**This is a decision engine, not a search engine.** Search is a means. The
deliverable is a short, confident, easy-to-pick-from list — or a single pick
the group will accept.

### The principles that should shape the design

- **Narrow, don't enumerate.** Every screen reduces the option set. *A result
  list longer than about ten has failed.*
- **Memory is the moat.** Anyone can query Google. Nobody else knows you liked
  the patio, hated the noise, and went three weeks ago.
- **Novelty is a first-class input**, not a side effect. The app actively
  pushes against the rut.
- **Commitment over optionality.** Infinite rerolls recreate the paralysis we
  exist to remove. Rerolls are capped at three, on purpose.
- **Speed.** The decision window is about **90 seconds**. Cold start to a
  usable shortlist has to fit inside it.

### Positioning — and what not to say

The funded competitor builds taste profiles from credit-card transactions.
That gives them a better cold start and a structurally worse signal: a charge
records that you *paid*, not that you *enjoyed it*, and frequency-weighting
reinforces the very rut we exist to break.

**Do not position this as "personalized recommendations."** That is a
head-to-head on their strength. Lead with **anti-rut** and the **group
decision**, which are unclaimed.

---

## 3. What exists today

A working app on a phone, styled with deliberate placeholders — system fonts,
greys, a black button. Nothing about the current look is defended.

**Home / shortlist.** A title, a location chip, a filter button, a
`Surprise me` button, and up to ten cards. Each card: name, distance,
locality, cuisine tags, and — when available — star rating, price level,
open/closed.

**Filter sheet.** Distance presets (5/10/20/50 mi), cuisine by group (15
groups, e.g. Mexican & Latin, Asian, Barbecue), a star floor (Any/3.5+/4/4.5+)
with an "include unrated places" switch, and an open-now switch.

**Location picker.** Sets where the search starts from: *Near me*, or a town
you are travelling to, listed nearest-first with a count of places in each.
This is deliberate — searching somewhere you are not yet is a decision-engine
feature that map-first competitors do badly.

**Surprise reveal.** One pick, large. Distance, cuisine, live data when it
exists. `Lock it in`, and `Something else (N left)` counting down from three.

**Not built yet:** place detail, history, group sessions, profile, onboarding.
Those are in the spec (§7) and are fair game to design ahead of.

---

## 4. Constraints that will change your design

These are the ones that matter. Please design *with* them rather than around
them.

### About one card in four will never have a rating

Ratings, price and opening hours come from Google, on demand, for the
shortlist only. They cannot be stored — that is a licensing obligation, not a
preference.

Measured on the real catalog: **roughly 27% of places do not resolve to a
Google listing at all.** They skew heavily to **rural independents**, which is
exactly the population this product exists to surface. They are shown, marked
"No rating available", and kept by default even under a star filter, because
an unrated place is not a badly-rated place.

**So the card design cannot assume a rating exists.** A layout where the
missing ones look broken, provisional or second-class is a failed layout. This
is the single most consequential constraint here: a list of ten where three
have no stars must read as *varied*, not as *incomplete*. If the honest answer
is that ratings should be quieter in the hierarchy than they usually are in
this category, say so.

### Any surface showing Google data needs attribution

"Powered by Google" must appear on any surface displaying their live data, and
reviews must be shown unmodified with reviewer name, photo and link. Design a
home for this that is honest and not ugly.

### Density varies enormously

The catalog covers North Texas: **39,304 places**. Valley View — where the
developer lives — has **25**. Dallas has **8,360**. Gainesville, ten miles
away, has 166.

The design has to work at both ends: a rural screen where the honest answer is
"there are four places and you've been to all of them", and an urban one where
the problem is ruthless narrowing. **The rural case is the differentiated one**
and tends to get designed last. Please do it first.

### Every Google call costs money

Hydrating a shortlist is the only variable cost and it scales with usage.
Interactions that trigger re-hydration — changing filters, rerolling — have a
real price. A design that invites idle browsing of live data is expensive in a
way that is invisible in a mockup. If you want something that implies more
fetching, flag it and we'll cost it.

### It is used in a car

Often by a passenger, often by someone who should not be looking at a phone at
all, frequently with another person reading over their shoulder. Touch targets,
glanceability and the ability to hand the phone across matter more than
information density.

---

## 5. What we are asking for

In rough priority:

1. **A point of view on the brand.** Type, colour, tone. One nameable idea, not
   a mood board. It should feel like hospitality rather than logistics, and it
   has to survive being rendered by a phone at a stoplight.
2. **The shortlist card.** The workhorse. Must read well with ragged data (see
   §4) and make a ten-item list feel like a curated short list rather than
   search results.
3. **The Surprise reveal.** The emotional centre of the product and currently
   the most under-designed screen. It should feel like a recommendation from
   someone with taste, not a slot machine. The reroll counter is meant to
   convey *deliberate scarcity* — three, then commit.
4. **Home.** How the location chip, filters and Surprise Me relate. Right now
   they are three controls in a row with no hierarchy.
5. **Empty and degraded states.** "Nothing matched." "Daily rating limit
   reached." "Location is off." These are frequent, not edge cases, and they
   are where a hospitality voice either earns its keep or sounds like a
   chatbot.
6. **Voice and microcopy.** The tagline and sign-off above are the register.
   Everything else should sound like it came from the same person.

**Deliverable:** a design canvas with the screens laid out, plus a short
written rationale for the decisions you would defend. Where you think an
interaction is wrong — not just unstyled — say so plainly and propose the
replacement.

**Before you build, ask.** If the register is unclear, if you need to know who
this is really for, if you want to see the app running, if a constraint in §4
seems to rule out the obvious answer — raise it. Questions early are cheap and
welcome; a finished canvas built on a wrong assumption is neither.

---

## 6. Things not to change

Not because they are sacred, but because they are load-bearing and were
expensive to settle:

- **No Google content is stored.** Ratings, reviews, hours and price are
  fetched per request and discarded. Any design that implies persistent
  Google data (offline browsing of ratings, a saved copy of reviews) is not
  buildable.
- **Rerolls stay capped at three.** It is friction on purpose.
- **Unrated places stay visible by default.** See §4.
- **A shortlist is ten or fewer.** Longer means the narrowing failed.
- **Location is the only permission asked for at first run.** No account, no
  bank link, no social graph. That frictionlessness is a competitive position.

Everything else — layout, hierarchy, colour, type, copy, the shape of the
filter sheet, whether Surprise Me is a button or the whole home screen — is
open.
