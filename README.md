# Elsewhere

**Your dining concierge.**

> Everyone's a critic. Here, yours is the only one that counts.

Elsewhere is a curated, history-aware restaurant discovery app for iOS and
Android. It exists to solve one specific problem: you keep eating at the same
eight places, because recalling anything else costs more effort than the
decision is worth.

It is a **decision engine, not a search engine**. The deliverable is a short,
confident, easy-to-pick-from list — or a single pick your group will accept.

## What makes it different

- **It remembers.** Where you went, who liked it, what you vetoed. Your rating
  changes tomorrow's shortlist instead of vanishing into a global average.
- **It pushes against the rut.** Recency decay actively sinks places you've
  been to lately. Most recommenders do the opposite.
- **It decides.** "Surprise Me" picks for you within guardrails you set — 4+
  stars, Italian, within 50 miles — using weighted random selection, not a
  deterministic best-match that would return the same answer every time.
- **It works for a group.** Two people in a car actually reaching a decision is
  the moment this app is built for.

## Start here

**[`docs/spec.md`](docs/spec.md)** is the full product and technical spec:
problem framing, competitive landscape, the three-layer data architecture, cost
model, feature set, phasing, and open risks. Read it before writing code.

**[`CLAUDE.md`](CLAUDE.md)** carries the architectural rules that are easy to
violate by accident — particularly the Google Places data-retention
constraints, which are a legal obligation rather than a style preference.

## Stack

React Native + Expo · Supabase (Postgres + PostGIS, Auth, RLS) · Supabase Edge
Functions · TanStack Query · Claude via server-side proxy

## Status

Phase 0 — foundation. Not yet building.
