-- Overture shipped a hierarchical category system ('taxonomy') alongside the
-- legacy flat 'categories' struct that 0003 was written against. The extract
-- now keys on the hierarchy, which needs somewhere to land.
--
-- primary_category / alternate_categories keep their meaning and are now fed
-- from taxonomy.primary / taxonomy.alternates rather than the legacy struct.
--
-- Provenance note, because operating_status will look alarming next to the
-- rule in CLAUDE.md: this is Overture open data (CDLA-Permissive), not
-- Google's businessStatus. Storing it is legal and it is not the same field.
-- Google's own businessStatus remains request-scoped and unstored.

alter table overture_staging add column category_hierarchy text;
alter table overture_staging add column basic_category     text;
alter table overture_staging add column operating_status   text;

comment on column overture_staging.category_hierarchy is
  'Overture taxonomy.hierarchy, root-to-leaf, '' > ''-delimited. Stored as
   delimited text to match alternate_categories; split_part() to slice it.';
comment on column overture_staging.operating_status is
  'Overture open data, NOT Google businessStatus. Closed places are excluded
   at promote, not at extract, so staging stays inspectable.';

-- The promote step filters on this, and the category review groups by it.
create index overture_staging_operating_status_idx
  on overture_staging (operating_status);
