-- Which migrations have actually been applied?
--
--   psql "$ELSEWHERE_PG_URL" -P pager=off -f scripts/check-schema.sql
--
-- These migrations are applied by hand, so nothing tracks them. Each check
-- below looks for a landmark object that only that migration creates, which
-- is more honest than a ledger anyone can forget to write to.

with checks(ord, migration, applied, detail) as (values
  (1, '0001 init',
      to_regclass('places') is not null and to_regclass('cuisines') is not null,
      (select count(*)::text || ' tables' from information_schema.tables
        where table_schema='public')),

  (2, '0002 seed cuisines',
      (select count(*) from cuisines where parent_id is not null) >= 93,
      (select count(*)::text || ' cuisine leaves' from cuisines where parent_id is not null)),

  (3, '0003 staging',
      to_regclass('overture_staging') is not null,
      (select count(*)::text || ' staged rows' from overture_staging)),

  (4, '0004 staging taxonomy',
      exists (select 1 from information_schema.columns
               where table_name='overture_staging' and column_name='operating_status'),
      'operating_status column'),

  (5, '0005 brand cuisine map',
      to_regclass('brand_cuisine_map') is not null and to_regproc('norm_place_name') is not null,
      coalesce((select count(*)::text || ' brands' from brand_cuisine_map), 'absent')),

  (6, '0006 chicken cuisine',
      exists (select 1 from cuisines where slug='chicken'),
      coalesce((select count(*)::text || ' brands on chicken'
                  from brand_cuisine_map b join cuisines c on c.id=b.cuisine_id
                 where c.slug='chicken'), '-')),

  (7, '0007 delivery-only brands',
      exists (select 1 from information_schema.columns
               where table_name='brand_cuisine_map' and column_name='delivery_only'),
      coalesce((select count(*)::text || ' flagged' from brand_cuisine_map where delivery_only), '-')),

  (8, '0008 category cuisine map',
      exists (select 1 from information_schema.columns
               where table_name='category_cuisine_map' and column_name='note'),
      coalesce((select count(*)::text || ' categories' from category_cuisine_map), 'absent')),

  (9, '0009 promote',
      to_regproc('promote_overture_staging') is not null,
      coalesce((select count(*)::text || ' places' from places), '0 places')),

  (10, '0010/0011 catalog_search + radius guard',
      to_regproc('catalog_search') is not null
        and (select pg_get_functiondef(to_regproc('catalog_search'))
                    like '%p_radius_meters must be%'),
      case when to_regproc('catalog_search') is null then 'absent'
           when (select pg_get_functiondef(to_regproc('catalog_search'))
                        like '%p_radius_meters must be%') then 'radius clamped'
           else 'UNCLAMPED -- 0011 missing' end),

  (12, '0012 google quota',
      to_regproc('google_quota_reserve') is not null,
      case when to_regproc('google_quota_reserve') is null then 'absent'
           else 'limit ' || google_daily_call_limit()::text || '/user/day' end),

  (13, '0013 quality flags',
      exists (select 1 from information_schema.columns
               where table_name='places' and column_name='colocated_count'),
      coalesce((select count(*)::text || ' share an address'
                  from places where colocated_count > 0), '-')),

  (14, '0014 catalog_search locality',
      to_regproc('catalog_search') is not null
        and (select pg_get_function_result(to_regproc('catalog_search'))
                    like '%locality_suspect%'),
      coalesce((select count(*)::text || ' suspect localities'
                  from places where locality_suspect), '-'))
)
select ord as "#",
       migration,
       case when applied then 'yes' else '>>> NO <<<' end as applied,
       detail
from checks order by ord;
