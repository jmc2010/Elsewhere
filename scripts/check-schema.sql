-- Which migrations have actually been applied?
--
--   psql "$ELSEWHERE_PG_URL" -f scripts/check-schema.sql
--
-- Migrations are applied by hand here, so nothing tracks them and STATUS.md
-- is only as accurate as whoever last edited it. This is not.
--
-- Every probe is dynamic, deliberately. A plain query that names a table or
-- function from an unapplied migration fails to PARSE -- so the first version
-- of this script only worked on a database that needed no checking. Existence
-- is tested with to_regclass/to_regproc/information_schema, which are safe for
-- absent objects, and each detail query runs only after its objects are known
-- to exist, wrapped so a surprise cannot take the report down with it.

do $$
declare
  checks text[] := array[
    '0001 init'
      || '@@@' || 'to_regclass(''places'') is not null and to_regclass(''cuisines'') is not null'
      || '@@@' || 'select count(*)||'' tables'' from information_schema.tables where table_schema=''public''',
    '0002 seed cuisines'
      || '@@@' || '(select count(*) from cuisines where parent_id is not null) >= 93'
      || '@@@' || 'select count(*)||'' cuisine leaves'' from cuisines where parent_id is not null',
    '0003 staging'
      || '@@@' || 'to_regclass(''overture_staging'') is not null'
      || '@@@' || 'select count(*)||'' staged rows'' from overture_staging',
    '0004 staging taxonomy'
      || '@@@' || 'exists (select 1 from information_schema.columns where table_name=''overture_staging'' and column_name=''operating_status'')'
      || '@@@' || 'select ''operating_status present''',
    '0005 brand cuisine map'
      || '@@@' || 'to_regclass(''brand_cuisine_map'') is not null and to_regproc(''norm_place_name'') is not null'
      || '@@@' || 'select count(*)||'' brands'' from brand_cuisine_map',
    '0006 chicken cuisine'
      || '@@@' || 'exists (select 1 from cuisines where slug=''chicken'')'
      || '@@@' || 'select count(*)||'' brands on chicken'' from brand_cuisine_map b join cuisines c on c.id=b.cuisine_id where c.slug=''chicken''',
    '0007 delivery-only brands'
      || '@@@' || 'exists (select 1 from information_schema.columns where table_name=''brand_cuisine_map'' and column_name=''delivery_only'')'
      || '@@@' || 'select count(*)||'' flagged'' from brand_cuisine_map where delivery_only',
    '0008 category cuisine map'
      || '@@@' || 'exists (select 1 from information_schema.columns where table_name=''category_cuisine_map'' and column_name=''note'')'
      || '@@@' || 'select count(*)||'' categories'' from category_cuisine_map',
    '0009 promote'
      || '@@@' || 'to_regproc(''promote_overture_staging'') is not null'
      || '@@@' || 'select count(*)||'' places'' from places',
    '0010+0011 catalog_search + radius guard'
      || '@@@' || 'to_regproc(''catalog_search'') is not null and pg_get_functiondef(to_regproc(''catalog_search'')) like ''%p_radius_meters must be%'''
      || '@@@' || 'select ''radius clamped''',
    '0012 google quota'
      || '@@@' || 'to_regproc(''google_quota_reserve'') is not null'
      || '@@@' || 'select ''limit ''||trim(prosrc)||''/user/day'' from pg_proc where proname=''google_daily_call_limit''',
    '0013 quality flags'
      || '@@@' || 'exists (select 1 from information_schema.columns where table_name=''places'' and column_name=''colocated_count'')'
      || '@@@' || 'select count(*)||'' share an address'' from places where colocated_count > 0',
    '0014 catalog_search locality'
      || '@@@' || 'to_regproc(''catalog_search'') is not null and pg_get_function_result(to_regproc(''catalog_search'')) like ''%locality_suspect%'''
      || '@@@' || 'select count(*)||'' suspect localities'' from places where locality_suspect'
  ];
  row_spec text;
  parts    text[];
  applied  boolean;
  detail   text;
  missing  int := 0;
begin
  raise notice '';
  raise notice '  %  %  %', rpad('MIGRATION', 40), rpad('APPLIED', 10), 'DETAIL';
  raise notice '  %', repeat('-', 78);

  foreach row_spec in array checks loop
    parts := string_to_array(row_spec, '@@@');
    begin
      execute 'select ' || parts[2] into applied;
    exception when others then
      applied := false;
    end;

    if applied then
      begin
        execute parts[3] into detail;
      exception when others then
        detail := '(detail unavailable)';
      end;
    else
      missing := missing + 1;
      detail  := '';
    end if;

    raise notice '  %  %  %', rpad(parts[1], 40),
      rpad(case when applied then 'yes' else '>>> NO <<<' end, 10),
      coalesce(detail, '');
  end loop;

  raise notice '  %', repeat('-', 78);
  if missing = 0 then
    raise notice '  all migrations applied';
  else
    raise notice '  % MISSING -- apply them from supabase/migrations/ in order', missing;
  end if;
  raise notice '';
end $$;
