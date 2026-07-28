-- ============================================================================
-- Fix: profiles_company_id_fkey FK violation during new company creation
--
-- Root Cause:
--   on_auth_user_created fires at signup before the companies row exists.
--   The trigger inserts a profile referencing a company_id that isn't in
--   public.companies yet, causing a FK violation.
--
-- Run this entire script in Supabase Dashboard → SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Step 1: Drop the old FK constraint (may be NOT VALID or VALID)
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_company_id_fkey;

-- ----------------------------------------------------------------------------
-- Step 2: Re-add as DEFERRABLE INITIALLY DEFERRED
--   This relaxes transaction-level ordering: a profile can reference a company
--   that is inserted later in the same transaction.
--   NOT VALID skips re-scanning existing rows (run VALIDATE CONSTRAINT later).
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_company_id_fkey
  FOREIGN KEY (company_id)
  REFERENCES public.companies(id)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED
  NOT VALID;

-- ----------------------------------------------------------------------------
-- Step 3: Replace the trigger function
--   - Validates company_id exists before using it (falls back to NULL for
--     brand-new signups where the company is created after auth.signUp).
--   - Uses ON CONFLICT (user_id) DO UPDATE so retries are idempotent.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id text;
  v_raw_company_id text;
BEGIN
  v_raw_company_id := COALESCE(
    NULLIF(NEW.raw_user_meta_data ->> 'company_id', ''),
    NULLIF(NEW.raw_user_meta_data ->> 'companyId', '')
  );

  IF v_raw_company_id IS NOT NULL THEN
    SELECT id INTO v_company_id
      FROM public.companies
     WHERE id = v_raw_company_id
     LIMIT 1;
  END IF;

  IF v_company_id IS NULL AND v_raw_company_id IS NULL THEN
    SELECT id INTO v_company_id
      FROM public.companies
     ORDER BY created_at ASC
     LIMIT 1;
  END IF;

  INSERT INTO public.profiles (
    id, user_id, company_id, full_name, role, status, data, created_at, updated_at
  )
  VALUES (
    'PROF-' || gen_random_uuid()::text,
    NEW.id::text,
    v_company_id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
      NULLIF(NEW.raw_user_meta_data ->> 'name', ''),
      NEW.email,
      'User'
    ),
    COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'role', ''), 'Admin'),
    'Active',
    '{}'::jsonb,
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE
    SET
      company_id = COALESCE(public.profiles.company_id, EXCLUDED.company_id),
      full_name  = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
      updated_at = NOW();

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- Step 4: Re-attach the trigger
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_signup();

-- ----------------------------------------------------------------------------
-- Step 5: Backfill profiles with NULL company_id
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.profiles p
     SET company_id = COALESCE(
           (
             SELECT NULLIF(u.raw_user_meta_data ->> 'company_id', '')
               FROM auth.users u
              WHERE u.id::text = p.user_id
              LIMIT 1
           ),
           (SELECT id FROM public.companies ORDER BY created_at ASC LIMIT 1)
         ),
         updated_at = NOW()
   WHERE (p.company_id IS NULL OR p.company_id = '')
     AND EXISTS (SELECT 1 FROM public.companies LIMIT 1);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'Backfilled % profiles', v_updated;
END;
$$;

-- ----------------------------------------------------------------------------
-- Verification
-- ----------------------------------------------------------------------------
SELECT
  'Profiles still with NULL company_id' AS check_name,
  COUNT(*) AS count
FROM public.profiles
WHERE company_id IS NULL OR company_id = '';

SELECT
  'profiles_company_id_fkey deferrable?' AS check_name,
  is_deferrable,
  initially_deferred
FROM information_schema.table_constraints
WHERE constraint_name = 'profiles_company_id_fkey'
  AND table_schema = 'public';
