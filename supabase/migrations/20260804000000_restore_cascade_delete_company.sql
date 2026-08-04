-- Restore the company cascade-delete RPC.
--
-- The single-company migration removed it:
--   database/supabase-migrate-to-single-company.sql
--     DROP FUNCTION IF EXISTS public.cascade_delete_company(text) CASCADE;
-- That left "Delete Company" in the ERP as a local-only factory reset, so the
-- Supabase Auth users (and the company's cloud data) survived and the same
-- credentials could still sign in afterwards.
--
-- This rebuilds the function schema-agnostically: it deletes rows from every
-- table that currently has a company_id column (tolerating schema changes),
-- then removes profiles, the company row and the company's Supabase Auth
-- users so the deleted credentials stop working.

CREATE OR REPLACE FUNCTION public.cascade_delete_company(target_company_id TEXT)
RETURNS varchar
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tbl TEXT;
  user_ids UUID[];
  cleared_tables INTEGER := 0;
BEGIN
  -- Delete all data rows from any public table that has a company_id column.
  FOR tbl IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'company_id'
  LOOP
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE company_id = $1', tbl) USING target_company_id;
      cleared_tables := cleared_tables + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'cascade_delete_company: could not clear %: %', tbl, SQLERRM;
    END;
  END LOOP;

  -- Collect the Supabase Auth user ids of everyone in the company: from
  -- profiles first, plus ANY auth user whose metadata still claims this
  -- company. The metadata fallback matters because signup may stamp
  -- company_id on auth.users.raw_user_meta_data without ever creating a
  -- matching profiles row — leaving project credentials deletable/useful.
  user_ids := ARRAY(
    SELECT DISTINCT uid FROM (
      SELECT user_id::uuid AS uid FROM public.profiles WHERE company_id = target_company_id
      UNION
      SELECT id AS uid FROM auth.users
      WHERE raw_user_meta_data ->> 'company_id' = target_company_id
         OR raw_user_meta_data ->> 'companyId' = target_company_id
         OR raw_user_meta_data ->> 'tenant_id' = target_company_id
         OR raw_app_meta_data ->> 'company_id' = target_company_id
         OR raw_app_meta_data ->> 'companyId' = target_company_id
         OR raw_app_meta_data ->> 'tenant_id' = target_company_id
    ) t
  );
  DELETE FROM public.profiles WHERE company_id = target_company_id;
  DELETE FROM public.companies WHERE id = target_company_id;

  -- Delete the Auth users so the same credentials can no longer sign in.
  -- SECURITY DEFINER runs as the function owner, so this works even when the
  -- RPC is invoked by an authenticated (staff) session.
  -- NOTE: array_length(empty_array, 1) is NULL (not 0), so the loop bound must
  -- be guarded — otherwise plpgsql raises 22004 "upper bound of FOR loop
  -- cannot be null".
  IF array_length(user_ids, 1) > 0 THEN
    FOR i IN 1 .. array_length(user_ids, 1) LOOP
      BEGIN
        DELETE FROM auth.users WHERE id = user_ids[i];
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'cascade_delete_company: could not delete auth user %: %', user_ids[i], SQLERRM;
      END;
    END LOOP;
  END IF;

  RETURN format('Deleted company %s across %s tables', target_company_id, cleared_tables);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cascade_delete_company(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cascade_delete_company(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cascade_delete_company(TEXT) TO service_role;
