-- Widen the holding-word list.
--
-- 0046 stopped a legal suffix from flagging a name that carries a venue word,
-- which correctly un-hid Lonesome Dove and J Samuell Restaurant. It also
-- un-hid 18 rows that are companies rather than places, because the words
-- that give them away were not on the holding list.
--
-- ADDED: services, solutions, operations, concepts, systems, corporation.
--
-- `corporation` is the important one and it was the gap: it already sat in
-- the legal-suffix list, but the venue-word escape hatch let it through. Allen
-- / Lucas / Melissa / Molina / Hls Restaurant Corporation carry a venue word
-- and no holding word, so they stayed visible. No dining venue trades as
-- "X Corporation".
--
-- NOT ADDED: `designs`. It fails the same evidence-not-intuition test that
-- commissary failed. Six catalog rows use it and at least three are real
-- bakeries -- "Designs By Cake Daddy, LLC", "Designs by GG Boutique Bakery",
-- "Editable Designs By Julia". It would have hidden them to catch
-- "Restaurant Designs Inc".
--
-- The test, again, because it keeps earning its place: before adding a word,
-- query the catalog for rows that match it. If real venues come back, the
-- word is ambiguous in practice whatever it sounds like in the abstract.

begin;

create or replace function name_has_holding_word(p_name text)
returns boolean
language sql immutable set search_path = public
as $$
  select p_name ~* '\m(group|holdings|investments|enterprise|enterprises|properties|management|partners|ventures|services|solutions|operations|concepts|systems|corporation)\M';
$$;

commit;
