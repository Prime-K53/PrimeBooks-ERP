-- ============================================================================
-- Restore Multi-Company Data Isolation
--
-- After the single-company migration removed company_id from all tables and
-- replaced RLS with permissive open-access policies, any authenticated user
-- could see every other company's data. This migration restores isolation:
--
--   1. Creates (or recreates) the companies table
--   2. Creates get_user_company_id() that resolves from profiles → auth metadata
--   3. Adds company_id TEXT to profiles and every business table
--   4. Creates restrictive RLS policies on every table
--   5. Creates indexes for fast company-scoped queries
--
-- The trigger-based auto-fill (set_company_id) ensures every INSERT/UPDATE
-- automatically stamps the caller's company_id, so the application code does
-- not need to pass it explicitly.
-- ============================================================================

-- ============================================================================
-- STEP 1: Create companies table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.companies (
  id TEXT PRIMARY KEY,
  company_name TEXT,
  registration_number TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  logo_url TEXT,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_isolation" ON public.companies;
CREATE POLICY "company_isolation" ON public.companies
  AS RESTRICTIVE FOR ALL
  TO authenticated
  USING (id = public.get_user_company_id())
  WITH CHECK (id = public.get_user_company_id());

-- ============================================================================
-- STEP 2: Ensure profiles has company_id
-- (Must run BEFORE get_user_company_id() because the function body references
--  profiles.company_id — SQL functions are validated at creation time.)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN company_id TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_company_id ON public.profiles(company_id);

-- ============================================================================
-- STEP 3: Create get_user_company_id() helper
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_company_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT company_id FROM public.profiles WHERE user_id = auth.uid()::text LIMIT 1),
    auth.jwt() ->> 'company_id',
    (SELECT raw_user_meta_data ->> 'company_id' FROM auth.users WHERE id = auth.uid())
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_user_company_id() TO authenticated;

-- ============================================================================
-- STEP 4: Add company_id to every business table (dynamic)
-- ============================================================================

DO $$
DECLARE
  tbl TEXT;
  tables_with_data TEXT[];
BEGIN
  -- Core ERP tables
  tables_with_data := ARRAY[
    'products', 'customers', 'suppliers', 'warehouses', 'inventory',
    'inventory_items', 'inventory_transactions', 'inventory_movements',
    'warehouse_inventory', 'material_categories', 'material_batches',
    'material_reservations', 'product_variants',
    'sales', 'sale_items', 'invoices', 'sales_orders',
    'sales_exchanges', 'sales_exchange_items', 'sales_exchange_approvals',
    'reprint_jobs', 'recurring_invoices', 'scheduled_payments',
    'delivery_notes', 'wallet_transactions', 'customer_payments',
    'purchase_orders', 'goods_receipts', 'supplier_payments', 'purchases',
    'ledger_entries', 'chart_of_accounts', 'accounts', 'budgets',
    'transfers', 'expenses', 'income', 'cheques',
    'vat_transactions', 'vat_returns', 'rounding_logs',
    'bank_accounts', 'bank_transactions', 'bank_statements',
    'bank_scheduled_payments', 'bank_exchange_rates', 'bank_fees',
    'bank_reconciliations', 'bank_adjustments', 'bank_cash_flow_forecasts',
    'bank_alerts', 'bank_categories',
    'departments', 'employees', 'payroll_runs', 'payslips',
    'work_centers', 'work_orders', 'production_resources',
    'production_batches', 'production_classes', 'production_subjects',
    'production_bom_calculations', 'production_class_adjustments',
    'production_pricing_audit', 'production_batch_notifications',
    'production_notification_audit_logs', 'production_bom_templates',
    'production_bom_template_components', 'job_tickets', 'job_ticket_settings',
    'job_orders', 'subcontract_orders', 'maintenance_logs',
    'resource_allocations', 'bom_templates', 'bom_default_materials', 'boms',
    'profit_margin_settings', 'profit_margin_audit_logs',
    'market_adjustments', 'market_adjustment_transactions',
    'transaction_adjustment_snapshots',
    'schools', 'classes', 'subjects', 'examinations',
    'examination_batches', 'examination_classes', 'examination_subjects',
    'examination_bom_calculations', 'examination_class_adjustments',
    'examination_pricing_audit', 'examination_batch_notifications',
    'examination_jobs', 'examination_job_subjects',
    'examination_invoice_groups', 'examination_recurring_profiles',
    'examination_inventory_deductions', 'examination_papers',
    'examination_printing_batches', 'notification_audit_logs',
    'whatsapp_accounts', 'whatsapp_message_queue', 'whatsapp_messages',
    'whatsapp_chats', 'whatsapp_templates', 'whatsapp_campaigns',
    'whatsapp_automations', 'customer_notification_logs',
    'sms_campaigns', 'sms_templates',
    'audit_logs', 'documents', 'tasks', 'settings',
    'user_groups', 'financial_years', 'user_preferences',
    'assets', 'reminders', 'shipments', 'subscribers', 'orders',
    'quotations', 'customerpricingtiers', 'discountrules',
    'customer_referrals', 'referral_rewards', 'referral_timeline',
    'referral_audit_logs', 'referral_campaigns', 'referral_analytics',
    'referral_reversals', 'referral_event_history',
    'engagement_timeline', 'engagement_audit', 'engagement_points',
    'engagement_point_balances', 'engagement_cashback',
    'engagement_membership_tiers', 'engagement_customer_tiers',
    'engagement_gift_cards', 'engagement_gift_card_transactions',
    'engagement_affiliates', 'engagement_affiliate_commissions',
    'engagement_promotions', 'engagement_customer_rewards',
    'engagement_analytics', 'inventory_audit_ledger',
    'idempotency_keys', 'tax_rates'
  ];

  FOREACH tbl IN ARRAY tables_with_data
  LOOP
    IF to_regclass('public.' || quote_ident(tbl)) IS NOT NULL THEN
      -- Add company_id if missing
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'company_id'
      ) THEN
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN company_id TEXT', tbl);
        RAISE NOTICE 'Added company_id to %', tbl;
      END IF;

      -- Create index
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_company_id ON public.%I(company_id)', tbl, tbl);

      -- Drop old permissive policies
      EXECUTE format('DROP POLICY IF EXISTS "permissive_all" ON public.%I', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "Authenticated users can manage %s" ON public.%I', tbl, tbl);

      -- Create restrictive company isolation policy
      EXECUTE format(
        'CREATE POLICY "company_isolation" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (company_id = public.get_user_company_id()) WITH CHECK (company_id = public.get_user_company_id())',
        tbl
      );
      RAISE NOTICE 'Created company_isolation policy on %', tbl;
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- STEP 5: Auto-set company_id on INSERT/UPDATE
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_company_id_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL OR NEW.company_id = '' THEN
    NEW.company_id := public.get_user_company_id();
  END IF;
  RETURN NEW;
END;
$$;

-- Apply the trigger to every table that has company_id
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'company_id'
      AND c.table_name NOT IN ('profiles', 'companies')
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_set_company_id ON public.%I',
      r.table_name
    );
    EXECUTE format(
      'CREATE TRIGGER trg_set_company_id BEFORE INSERT OR UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.set_company_id_on_insert()',
      r.table_name
    );
  END LOOP;
END $$;

-- ============================================================================
-- STEP 6: Grant service_role bypass (for admin operations)
-- ============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'company_id'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      r.table_name
    );
  END LOOP;
END $$;

-- ============================================================================
-- STEP 7: Ensure RLS is enabled on all tables
-- ============================================================================

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
