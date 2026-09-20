-- Staging table for the Overture ingest.
--
-- DuckDB writes raw rows here, then a SQL transform promotes them into
-- places. Keeping a staging step means a bad extract can be inspected and
-- re-run without ever touching the live catalog.
--
-- Service-role only: RLS enabled with no policies (see CLAUDE.md).

create table overture_staging (
  source_id            text primary key,
  name                 text,
  lon                  double precision,
  lat                  double precision,
  address_line         text,
  locality             text,
  region               text,
  postcode             text,
  country              text,
  website              text,
  primary_category     text,
  alternate_categories text,
  confidence           real,
  ingested_at          timestamptz not null default now()
);

alter table overture_staging enable row level security;

create index overture_staging_category_idx on overture_staging (primary_category);
