-- ============================================================================
-- Single-Company Migration: Remove Multi-Tenant / Multi-Company Architecture
--
-- This migration converts the database from a multi-company (multi-tenant)
-- architecture to a single-company architecture by:
--   1. Dropping get_user_company_id() and all company_id-dependent helper functions
--   2. Dropping ALL RLS policies that reference company_id or get_user_company_id()
--   3. Dropping the company_id column from every table that has it
--   4. Dropping the companies, company_users, and company_config tables
--   5. Simplifying RLS policies to be permissive for all authenticated users
--      (no tenant filtering)
--   6. Dropping triggers that auto-set company_id
--   7. Dropping foreign keys that reference companies(id) or company_users
--   8. Dropping indexes on company_id columns
--   9. Fixing the pcompany_id parameter naming bug in engagement functions
--  10. Using ALTER TABLE ... DROP COLUMN IF EXISTS company_id for each table
--
-- Safe to run in a development environment. Uses DROP ... IF EXISTS everywhere.
-- All table-scoped statements are guarded with to_regclass() checks so that
-- tables that do not exist in a given database (e.g. tables created only by
-- other migration files) are skipped instead of aborting the whole migration.
-- ============================================================================

-- ============================================================================
-- STEP 1: Drop ALL triggers that auto-set company_id or reference tenant logic
-- ============================================================================
-- Triggers explicitly created by migration files:
--   trg_profile_company_id (profiles) — 04-schema-hardening, 05-rls-policies,
--     supabase-rls-hardening-migration, supabase-comprehensive-403-fix, ...
--   trg_sync_profile_to_company_users (profiles) — 06-triggers-validation
--   trg_sync_profile_company_to_auth (profiles) — 20260716223248_fix_rls_profiles_account_creation
--   on_auth_user_created (auth.users) — supabase-comprehensive-403-fix, ...
--   trg_validate_* / trg_inventory_audit_ledger / trg_protect_* — 06-triggers-validation

DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT * FROM (VALUES
        ('public', 'profiles',               'trg_profile_company_id'),
        ('public', 'profiles',               'trg_sync_profile_to_company_users'),
        ('public', 'profiles',               'trg_sync_profile_company_to_auth'),
        ('auth',   'users',                  'on_auth_user_created'),
        ('public', 'inventory_transactions', 'trg_validate_inventory_txn_company'),
        ('public', 'warehouse_inventory',    'trg_validate_warehouse_inv_company'),
        ('public', 'sale_items',             'trg_validate_sale_item_company'),
        ('public', 'goods_receipts',         'trg_validate_gr_company'),
        ('public', 'inventory_transactions', 'trg_inventory_audit_ledger'),
        ('public', 'inventory_transactions', 'trg_protect_inventory_transactions'),
        ('public', 'inventory_audit_ledger', 'trg_protect_inventory_audit')
    ) AS t(schema_name, table_name, trigger_name)
    LOOP
        IF to_regclass(format('%I.%I', t.schema_name, t.table_name)) IS NOT NULL THEN
            EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I',
                           t.trigger_name, t.schema_name, t.table_name);
            RAISE NOTICE 'Dropped trigger % on %.%', t.trigger_name, t.schema_name, t.table_name;
        ELSE
            RAISE NOTICE 'Skipped trigger % (table %.% does not exist)',
                t.trigger_name, t.schema_name, t.table_name;
        END IF;
    END LOOP;
END $$;

-- Dynamic: drop trg_set_company_id from ALL tables that have it
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT t.tgname AS trigger_name, c.relname AS table_name
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE t.tgname IN (
            'trg_set_company_id',
            'trg_profile_company_id',
            'trg_sync_profile_to_company_users',
            'trg_sync_profile_company_to_auth',
            'trg_validate_inventory_txn_company',
            'trg_validate_warehouse_inv_company',
            'trg_validate_sale_item_company',
            'trg_validate_gr_company',
            'trg_inventory_audit_ledger',
            'trg_protect_inventory_transactions',
            'trg_protect_inventory_audit'
        )
        AND n.nspname = 'public'
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', r.trigger_name, r.table_name);
        RAISE NOTICE 'Dropped trigger % on %', r.trigger_name, r.table_name;
    END LOOP;
END $$;

-- ============================================================================
-- STEP 2: Drop trigger FUNCTIONS that auto-set or validate company_id
-- ============================================================================

-- Functions created by: 06-triggers-validation.sql, supabase-rls-hardening-migration.sql,
--   supabase-comprehensive-403-fix.sql, supabase-fix-accounts-rls.sql,
--   supabase-fix-rls-company-id.sql, supabase-fix-rls-products-403.sql,
--   supabase-fix-rls-profiles-account-creation.sql, supabase-fix-rls-warehouses-403.sql
-- NOTE: CASCADE is required because RLS policies (and possibly views/other
-- functions) still depend on these functions. The dependents are all
-- company-scoped objects that this migration removes anyway.
DROP FUNCTION IF EXISTS public.trigger_set_company_id() CASCADE;
DROP FUNCTION IF EXISTS public.trigger_validate_inventory_txn_company() CASCADE;
DROP FUNCTION IF EXISTS public.trigger_validate_warehouse_inventory_company() CASCADE;
DROP FUNCTION IF EXISTS public.trigger_validate_sale_item_company() CASCADE;
DROP FUNCTION IF EXISTS public.trigger_validate_gr_company() CASCADE;
DROP FUNCTION IF EXISTS public.trigger_sync_profile_to_company_users() CASCADE;
DROP FUNCTION IF EXISTS public.trigger_inventory_audit_ledger() CASCADE;
DROP FUNCTION IF EXISTS public.trigger_protect_inventory_transactions() CASCADE;
DROP FUNCTION IF EXISTS public.handle_profile_company_id() CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user_signup() CASCADE;
DROP FUNCTION IF EXISTS public.sync_profile_company_to_auth() CASCADE;

-- Functions created by: 05-rls-policies.sql
DROP FUNCTION IF EXISTS public.user_belongs_to_company(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_user_companies() CASCADE;
DROP FUNCTION IF EXISTS public.create_tenant_policy() CASCADE;

-- Functions created by: supabase-rls-hardening-migration.sql
DROP FUNCTION IF EXISTS public.set_user_app_metadata(uuid, text, text) CASCADE;

-- Function created by: 07-monitoring-integrity.sql
DROP FUNCTION IF EXISTS public.check_company_integrity() CASCADE;
DROP FUNCTION IF EXISTS public.quick_tenant_health() CASCADE;

-- Function created by: supabase-cascade-delete.sql and 05-rls-policies.sql
DROP FUNCTION IF EXISTS public.cascade_delete_company(text) CASCADE;

-- Function created by: supabase-engagement-tables.sql and supabase-engagement-tables-run.sql
-- CASCADE drops all RLS policies that reference it (engagement_*_company, etc.)
DROP FUNCTION IF EXISTS public.get_current_company_id() CASCADE;

-- Engagement functions (to be recreated with fixed parameter naming — see Step 9)
DROP FUNCTION IF EXISTS public.upsert_point_balance(text, numeric, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.redeem_gift_card(text, numeric, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.calculate_tier_for_customer(text, text) CASCADE;

-- Scheduling function from supabase-referral-tables-v2.sql
DROP FUNCTION IF EXISTS public.expire_referrals() CASCADE;
DROP FUNCTION IF EXISTS public.generate_referral_analytics(text, date, date, text) CASCADE;

-- ============================================================================
-- STEP 3: Drop ALL RLS policies that reference company_id or get_user_company_id()
-- ============================================================================
-- This dynamic block drops every policy in the public schema, ensuring nothing
-- references company_id, get_user_company_id(), or get_current_company_id().

DO $$
DECLARE
    rec RECORD;
    v_count INT := 0;
BEGIN
    FOR rec IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
        ORDER BY tablename, policyname
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', rec.policyname, rec.schemaname, rec.tablename);
        v_count := v_count + 1;
        RAISE NOTICE 'Dropped policy % on %.%', rec.policyname, rec.schemaname, rec.tablename;
    END LOOP;

    RAISE NOTICE 'Total policies dropped: %', v_count;
END $$;

-- ============================================================================
-- STEP 4: Drop FOREIGN KEY constraints referencing companies(id),
--          company_users, or company_config(id)
-- ============================================================================

-- Explicitly known FK constraints (from 04-schema-hardening.sql):
-- Core business tables
ALTER TABLE IF EXISTS public.inventory        DROP CONSTRAINT IF EXISTS fk_inventory_company;
ALTER TABLE IF EXISTS public.products         DROP CONSTRAINT IF EXISTS fk_products_company;
ALTER TABLE IF EXISTS public.warehouses       DROP CONSTRAINT IF EXISTS fk_warehouses_company;
ALTER TABLE IF EXISTS public.inventory_transactions DROP CONSTRAINT IF EXISTS fk_inv_txns_company;
ALTER TABLE IF EXISTS public.inventory_movements  DROP CONSTRAINT IF EXISTS fk_inv_movements_company;
ALTER TABLE IF EXISTS public.warehouse_inventory  DROP CONSTRAINT IF EXISTS fk_wh_inv_company;
ALTER TABLE IF EXISTS public.sales            DROP CONSTRAINT IF EXISTS fk_sales_company;
ALTER TABLE IF EXISTS public.sale_items       DROP CONSTRAINT IF EXISTS fk_sale_items_company;
ALTER TABLE IF EXISTS public.sales_orders     DROP CONSTRAINT IF EXISTS fk_sales_orders_company;
ALTER TABLE IF EXISTS public.invoices         DROP CONSTRAINT IF EXISTS fk_invoices_company;
ALTER TABLE IF EXISTS public.customer_payments DROP CONSTRAINT IF EXISTS fk_cust_payments_company;
ALTER TABLE IF EXISTS public.purchase_orders  DROP CONSTRAINT IF EXISTS fk_po_company;
ALTER TABLE IF EXISTS public.goods_receipts   DROP CONSTRAINT IF EXISTS fk_gr_company;
ALTER TABLE IF EXISTS public.supplier_payments DROP CONSTRAINT IF EXISTS fk_supp_payments_company;
ALTER TABLE IF EXISTS public.ledger_entries   DROP CONSTRAINT IF EXISTS fk_ledger_company;
ALTER TABLE IF EXISTS public.chart_of_accounts DROP CONSTRAINT IF EXISTS fk_coa_company;
ALTER TABLE IF EXISTS public.customers        DROP CONSTRAINT IF EXISTS fk_customers_company;
ALTER TABLE IF EXISTS public.suppliers        DROP CONSTRAINT IF EXISTS fk_suppliers_company;
ALTER TABLE IF EXISTS public.examination_batches DROP CONSTRAINT IF EXISTS fk_exam_batches_company;
ALTER TABLE IF EXISTS public.work_orders      DROP CONSTRAINT IF EXISTS fk_work_orders_company;

-- inventory_audit_ledger FK (from 06-triggers-validation.sql)
ALTER TABLE IF EXISTS public.inventory_audit_ledger DROP CONSTRAINT IF EXISTS fk_inv_audit_company;

-- profiles FK (from supabase-fix-rls-warehouses-403.sql and supabase-fix-profiles-company-fk.sql)
ALTER TABLE IF EXISTS public.profiles DROP CONSTRAINT IF EXISTS profiles_company_id_fkey;

-- company_users FKs (from 04-schema-hardening.sql)
ALTER TABLE IF EXISTS public.company_users DROP CONSTRAINT IF EXISTS company_users_user_id_fkey;
ALTER TABLE IF EXISTS public.company_users DROP CONSTRAINT IF EXISTS company_users_company_id_fkey;

-- Referral / engagement FKs to company_config (from drop-fk-referrals.sql)
ALTER TABLE IF EXISTS public.customer_referrals        DROP CONSTRAINT IF EXISTS customer_referrals_company_id_fkey;
ALTER TABLE IF EXISTS public.referral_rewards          DROP CONSTRAINT IF EXISTS referral_rewards_company_id_fkey;
ALTER TABLE IF EXISTS public.referral_timeline         DROP CONSTRAINT IF EXISTS referral_timeline_company_id_fkey;
ALTER TABLE IF EXISTS public.referral_audit_logs       DROP CONSTRAINT IF EXISTS referral_audit_logs_company_id_fkey;
ALTER TABLE IF EXISTS public.referral_campaigns        DROP CONSTRAINT IF EXISTS referral_campaigns_company_id_fkey;
ALTER TABLE IF EXISTS public.referral_analytics        DROP CONSTRAINT IF EXISTS referral_analytics_company_id_fkey;
ALTER TABLE IF EXISTS public.referral_reversals        DROP CONSTRAINT IF EXISTS referral_reversals_company_id_fkey;
ALTER TABLE IF EXISTS public.referral_event_history    DROP CONSTRAINT IF EXISTS referral_event_history_company_id_fkey;

-- Dynamic: drop ALL FK constraints that reference companies, company_users, or company_config
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT
            con.conname AS constraint_name,
            rel.relname AS table_name
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = con.confrelid
        WHERE con.contype = 'f'
          AND n.nspname = 'public'
          AND con.confrelid IN (
              -- companies table
              (SELECT oid FROM pg_class WHERE relname = 'companies' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')),
              -- company_users table
              (SELECT oid FROM pg_class WHERE relname = 'company_users' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')),
              -- company_config table
              (SELECT oid FROM pg_class WHERE relname = 'company_config' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')),
              -- auth.users table
              (SELECT oid FROM pg_class WHERE relname = 'users' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'auth'))
          )
    LOOP
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I CASCADE', r.table_name, r.constraint_name);
        RAISE NOTICE 'Dropped FK % on %', r.constraint_name, r.table_name;
    END LOOP;
END $$;

-- ============================================================================
-- STEP 5: Drop ALL indexes on company_id columns
-- ============================================================================

-- Dynamic: drop all company-related indexes in the public schema.
-- Two selection criteria:
--   1. any index whose definition references company_id (catch-all), OR
--   2. any index with a known company-related name from the migration files
--      (idx_*_company, idx_*_company_id, engagement/referral indexes, etc.)
-- Indexes that BACK a PRIMARY KEY / UNIQUE / EXCLUSION constraint are SKIPPED
-- here — PostgreSQL refuses to drop them directly (2BP01). They are removed
-- instead when their constraint is dropped (Step 6) or when the column itself
-- is dropped (Step 7, DROP COLUMN ... CASCADE).
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT i.indexname
        FROM pg_indexes i
        WHERE i.schemaname = 'public'
          AND (
              i.indexdef ILIKE '%company_id%'
              OR i.indexname IN (
                  'idx_companies_company_id',
                  'idx_profiles_user_id',
                  'idx_profiles_company_id',
                  'idx_idempotency_keys_company_id',
                  'idx_tax_rates_company_id',
                  'idx_inventory_company',
                  'idx_products_company',
                  'idx_warehouses_company',
                  'idx_inv_txns_company',
                  'idx_inv_movements_company',
                  'idx_wh_inv_company',
                  'idx_inventory_company_id',
                  'idx_inventory_company_category',
                  'idx_sales_company',
                  'idx_sale_items_company',
                  'idx_sales_orders_company',
                  'idx_invoices_company',
                  'idx_cust_payments_company',
                  'idx_po_company',
                  'idx_gr_company',
                  'idx_supp_payments_company',
                  'idx_ledger_company',
                  'idx_coa_company',
                  'idx_customers_company',
                  'idx_suppliers_company',
                  'idx_exam_batches_company',
                  'idx_work_orders_company',
                  'idx_inv_audit_company',
                  'idx_company_users_user_id',
                  'idx_company_users_company_id',
                  'idx_company_users_default',
                  'idx_warehouses_company_id',
                  'idx_customer_referrals_company_id',
                  'idx_referral_rewards_company_id',
                  'idx_referral_timeline_company_id',
                  'idx_referral_audit_company_id',
                  'idx_referral_campaigns_company_id',
                  'idx_referral_analytics_company_id',
                  'idx_referral_reversals_company_id',
                  'idx_referral_events_company_id',
                  'idx_engagement_points_customer',
                  'idx_engagement_balances_customer',
                  'idx_engagement_cashback_customer',
                  'idx_engagement_cashback_status',
                  'idx_engagement_tiers_level',
                  'idx_engagement_customer_tiers_customer',
                  'idx_engagement_customer_tiers_tier',
                  'idx_engagement_gift_cards_code',
                  'idx_engagement_gift_cards_issuer',
                  'idx_engagement_gift_cards_recipient',
                  'idx_engagement_gc_tx_giftcard',
                  'idx_engagement_gc_tx_customer',
                  'idx_engagement_affiliates_code',
                  'idx_engagement_affiliates_customer',
                  'idx_engagement_affiliates_status',
                  'idx_engagement_aff_comm_affiliate',
                  'idx_engagement_aff_comm_status',
                  'idx_engagement_promotions_code',
                  'idx_engagement_promotions_type',
                  'idx_engagement_promotions_active',
                  'idx_engagement_promotions_dates',
                  'idx_engagement_cust_rewards_customer',
                  'idx_engagement_cust_rewards_type',
                  'idx_engagement_cust_rewards_status',
                  'idx_engagement_analytics_customer',
                  'idx_engagement_analytics_period',
                  'idx_engagement_timeline_customer',
                  'idx_engagement_timeline_event',
                  'idx_engagement_timeline_ref',
                  'idx_engagement_audit_entity',
                  'idx_engagement_audit_action',
                  'idx_engagement_audit_actor',
                  'idx_financial_years_company',
                  'idx_user_preferences_unique',
                  'idx_user_preferences_lookup'
              )
          )
          AND NOT EXISTS (
              -- skip indexes that back a PK / UNIQUE / EXCLUSION constraint
              SELECT 1
              FROM pg_constraint con
              JOIN pg_class c ON c.oid = con.conindid
              WHERE c.relname = i.indexname
                AND con.contype IN ('p', 'u', 'x')
          )
    LOOP
        EXECUTE format('DROP INDEX IF EXISTS %I CASCADE', r.indexname);
        RAISE NOTICE 'Dropped index %', r.indexname;
    END LOOP;
END $$;

-- ============================================================================
-- STEP 6: Drop CHECK constraints and UNIQUE constraints related to company_id
-- ============================================================================

-- From 04-schema-hardening.sql — CHECK constraint on inventory.company_id
ALTER TABLE IF EXISTS public.inventory DROP CONSTRAINT IF EXISTS chk_inventory_company_id;

-- From 04-schema-hardening.sql — UNIQUE constraint on engagement_membership_tiers
ALTER TABLE IF EXISTS public.engagement_membership_tiers DROP CONSTRAINT IF EXISTS engagement_membership_tiers_company_id_key;
-- Note: UNIQUE(company_id, slug) may have a different auto-generated name; handle dynamically below.

-- Dynamic: drop all constraints related to company_id (excluding FK which are already handled above)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT
            con.conname,
            rel.relname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = rel.relnamespace
        WHERE n.nspname = 'public'
          AND (con.conname ILIKE '%company%' OR con.conname ILIKE '%tenant%')
          AND con.contype IN ('u', 'c')
    LOOP
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I CASCADE', r.relname, r.conname);
        RAISE NOTICE 'Dropped constraint % on %', r.conname, r.relname;
    END LOOP;
END $$;

-- ============================================================================
-- STEP 7: Drop the company_id COLUMN from every table that has it
-- ============================================================================
-- Explicitly listing ALL tables found across the migration files, plus a
-- dynamic catch-all at the end for any tables this list missed.

-- --- Core tables (profiles, idempotency_keys, tax_rates) ---
ALTER TABLE IF EXISTS public.profiles DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.idempotency_keys DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.tax_rates DROP COLUMN IF EXISTS company_id CASCADE;

-- --- Core ERP / BOM / Pricing tables ---
ALTER TABLE IF EXISTS public.bom_templates DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.bom_default_materials DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.inventory_items DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.inventory DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.inventory_transactions DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.inventory_movements DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.warehouse_inventory DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.warehouses DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.material_categories DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.material_batches DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.material_reservations DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.products DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.product_variants DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.market_adjustments DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.market_adjustment_transactions DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.transaction_adjustment_snapshots DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.rounding_logs DROP COLUMN IF EXISTS company_id CASCADE;

-- --- Examination / Education module ---
ALTER TABLE IF EXISTS public.examination_batches DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.examination_classes DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.examination_subjects DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.examination_bom_calculations DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.examination_class_adjustments DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.examination_pricing_audit DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.examination_batch_notifications DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.notification_audit_logs DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.examination_jobs DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.examination_job_subjects DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.examination_invoice_groups DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.examination_recurring_profiles DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.examination_inventory_deductions DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.examination_papers DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.examination_printing_batches DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.schools DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.classes DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.subjects DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.examinations DROP COLUMN IF EXISTS company_id CASCADE;

-- --- Production module ---
ALTER TABLE IF EXISTS public.production_batches DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.production_classes DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.production_subjects DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.production_bom_calculations DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.production_class_adjustments DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.production_pricing_audit DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.production_batch_notifications DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.production_notification_audit_logs DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.production_bom_templates DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.production_bom_template_components DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.work_centers DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.work_orders DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.production_resources DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.job_tickets DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.job_ticket_settings DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.job_orders DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.subcontract_orders DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.maintenance_logs DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.resource_allocations DROP COLUMN IF EXISTS company_id CASCADE;

-- --- Sales / Invoicing ---
ALTER TABLE IF EXISTS public.sales DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.sale_items DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.invoices DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.sales_orders DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.sales_exchanges DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.sales_exchange_items DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.sales_exchange_approvals DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.reprint_jobs DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.recurring_invoices DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.scheduled_payments DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.delivery_notes DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.wallet_transactions DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.customer_payments DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.supplier_payments DROP COLUMN IF EXISTS company_id CASCADE;

-- --- Purchasing / Procurement ---
ALTER TABLE IF EXISTS public.purchase_orders DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.goods_receipts DROP COLUMN IF EXISTS company_id CASCADE;

-- --- Accounting ---
ALTER TABLE IF EXISTS public.ledger_entries DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.chart_of_accounts DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.budgets DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.transfers DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.expenses DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.income DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.vat_transactions DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.vat_returns DROP COLUMN IF EXISTS company_id CASCADE;

-- --- Banking ---
ALTER TABLE IF EXISTS public.bank_accounts DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.bank_transactions DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.bank_statements DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.bank_scheduled_payments DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.bank_exchange_rates DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.bank_fees DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.bank_reconciliations DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.bank_adjustments DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.bank_cash_flow_forecasts DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.bank_alerts DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.bank_categories DROP COLUMN IF EXISTS company_id CASCADE;

-- --- HR / Payroll ---
ALTER TABLE IF EXISTS public.departments DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.employees DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.payroll_runs DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.payslips DROP COLUMN IF EXISTS company_id CASCADE;

-- --- Customers, Suppliers, Assets ---
ALTER TABLE IF EXISTS public.customers DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.suppliers DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.assets DROP COLUMN IF EXISTS company_id CASCADE;

-- --- Communication: WhatsApp ---
ALTER TABLE IF EXISTS public.whatsapp_accounts DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.whatsapp_message_queue DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.whatsapp_messages DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.whatsapp_chats DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.whatsapp_templates DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.whatsapp_campaigns DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.whatsapp_automations DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.customer_notification_logs DROP COLUMN IF EXISTS company_id CASCADE;

-- --- Communication: SMS ---
ALTER TABLE IF EXISTS public.sms_campaigns DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.sms_templates DROP COLUMN IF EXISTS company_id CASCADE;

-- --- Audit / Logs / Tasks ---
ALTER TABLE IF EXISTS public.audit_logs DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.documents DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.tasks DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.user_groups DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.settings DROP COLUMN IF EXISTS company_id CASCADE;

-- --- Legacy tables ---
ALTER TABLE IF EXISTS public.purchases DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.accounts DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.reminders DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.quotations DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.orders DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.boms DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.cheques DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.subscribers DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.shipments DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.customerpricingtiers DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.discountrules DROP COLUMN IF EXISTS company_id CASCADE;

-- --- Financial Years / User Preferences ---
ALTER TABLE IF EXISTS public.financial_years DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.user_preferences DROP COLUMN IF EXISTS company_id CASCADE;

-- --- Inventory Audit Ledger ---
ALTER TABLE IF EXISTS public.inventory_audit_ledger DROP COLUMN IF EXISTS company_id CASCADE;

-- --- Referral tables ---
ALTER TABLE IF EXISTS public.customer_referrals DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.referral_rewards DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.referral_timeline DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.referral_audit_logs DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.referral_campaigns DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.referral_analytics DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.referral_reversals DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.referral_event_history DROP COLUMN IF EXISTS company_id CASCADE;

-- --- Engagement tables ---
ALTER TABLE IF EXISTS public.engagement_timeline DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.engagement_audit DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.engagement_points DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.engagement_point_balances DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.engagement_cashback DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.engagement_membership_tiers DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.engagement_customer_tiers DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.engagement_gift_cards DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.engagement_gift_card_transactions DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.engagement_affiliates DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.engagement_affiliate_commissions DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.engagement_promotions DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.engagement_customer_rewards DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE IF EXISTS public.engagement_analytics DROP COLUMN IF EXISTS company_id CASCADE;

-- Dynamic catch-all: drop company_id from ANY remaining table in the public schema
-- that still has the column (handles tables not explicitly listed above).
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT c.column_name, t.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public'
          AND c.column_name = 'company_id'
          AND t.table_type = 'BASE TABLE'
          AND t.table_name NOT IN ('companies', 'company_users', 'company_config')
    LOOP
        EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS company_id CASCADE', r.table_name);
        RAISE NOTICE 'Dropped company_id column from % (catch-all)', r.table_name;
    END LOOP;
END $$;

-- ============================================================================
-- STEP 8: Drop the companies, company_users, and company_config tables
--         (and all their remaining FKs, indexes, triggers)
-- ============================================================================

-- Explicitly drop known triggers on auth.users and profiles — handled by the
-- dynamic block below (relname IN 'companies','company_users','company_config',
-- 'profiles','users'), which is safe against missing tables.
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT * FROM (VALUES
        ('auth',   'users',    'on_auth_user_created'),
        ('public', 'profiles', 'trg_profile_company_id'),
        ('public', 'profiles', 'trg_sync_profile_to_company_users'),
        ('public', 'profiles', 'trg_sync_profile_company_to_auth')
    ) AS t(schema_name, table_name, trigger_name)
    LOOP
        IF to_regclass(format('%I.%I', t.schema_name, t.table_name)) IS NOT NULL THEN
            EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I',
                           t.trigger_name, t.schema_name, t.table_name);
        END IF;
    END LOOP;
END $$;

-- Dynamic: drop company-related triggers on companies, company_users,
-- company_config, profiles, and auth.users.
-- NOTE: only trigger names in the known company-related set are dropped —
-- standard triggers such as Supabase's handle_new_user (profile creation on
-- signup) are preserved.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT t.tgname AS trigger_name, c.relname AS table_name, n.nspname AS schema_name
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('public', 'auth')
          AND c.relname IN ('companies', 'company_users', 'company_config', 'profiles', 'users')
          AND t.tgname IN (
              'on_auth_user_created',
              'trg_profile_company_id',
              'trg_sync_profile_to_company_users',
              'trg_sync_profile_company_to_auth',
              'handle_new_user_signup',
              'trg_set_company_id',
              'trg_validate_inventory_txn_company',
              'trg_validate_warehouse_inv_company',
              'trg_validate_sale_item_company',
              'trg_validate_gr_company',
              'trg_inventory_audit_ledger',
              'trg_protect_inventory_transactions',
              'trg_protect_inventory_audit'
          )
    LOOP
        IF r.schema_name = 'auth' THEN
            EXECUTE format('DROP TRIGGER IF EXISTS %I ON auth.%I', r.trigger_name, r.table_name);
        ELSE
            EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', r.trigger_name, r.table_name);
        END IF;
        RAISE NOTICE 'Dropped trigger % on %.%', r.trigger_name, r.schema_name, r.table_name;
    END LOOP;
END $$;

-- Drop the tables (with CASCADE to handle any remaining dependent objects)
DROP TABLE IF EXISTS public.company_users CASCADE;
DROP TABLE IF EXISTS public.company_config CASCADE;
DROP TABLE IF EXISTS public.companies CASCADE;

-- ============================================================================
-- STEP 9: Fix the pcompany_id parameter naming bug in engagement functions
--         (supabase-engagement-tables-run.sql)
--
-- The bug: parameters were named `pcompany_id` (missing underscore) instead of
-- the conventional `p_company_id`.  Since we are removing company_id columns
-- entirely, the functions are recreated WITHOUT company_id references while
-- still accepting the (now-correctly-named) parameter for API compatibility.
-- ============================================================================

-- Replace get_current_company_id() to return NULL (no tenant filtering)
CREATE OR REPLACE FUNCTION public.get_current_company_id()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT NULL::TEXT;
$$;

-- upsert_point_balance: fix pcompany_id → p_company_id; remove company_id from INSERT
-- (skipped if the engagement tables don't exist in this database)
DO $migration$
BEGIN
    CREATE OR REPLACE FUNCTION public.upsert_point_balance(
        p_customer_id TEXT,
        p_points NUMERIC,
        p_reason TEXT,
        p_company_id TEXT  -- parameter name fixed from pcompany_id to p_company_id
    )
    RETURNS engagement_point_balances
    LANGUAGE plpgsql
    AS $func$
    DECLARE
        v_balance engagement_point_balances%ROWTYPE;
    BEGIN
        INSERT INTO engagement_point_balances (id, customer_id, balance, lifetime_earned, last_updated)
        VALUES (
            gen_random_uuid()::TEXT,
            p_customer_id,
            CASE WHEN p_reason = 'redeem' THEN 0 ELSE p_points END,
            CASE WHEN p_reason = 'redeem' THEN 0 ELSE p_points END,
            NOW()
        )
        ON CONFLICT (customer_id) DO UPDATE SET
            balance = engagement_point_balances.balance + CASE
                WHEN p_reason = 'redeem' THEN -p_points
                WHEN p_reason = 'expire' THEN 0
                ELSE p_points
            END,
            lifetime_earned = engagement_point_balances.lifetime_earned + CASE
                WHEN p_reason IN ('earn', 'bonus') THEN p_points
                ELSE 0
            END,
            lifetime_redeemed = engagement_point_balances.lifetime_redeemed + CASE
                WHEN p_reason = 'redeem' THEN p_points
                ELSE 0
            END,
            lifetime_expired = engagement_point_balances.lifetime_expired + CASE
                WHEN p_reason = 'expire' THEN p_points
                ELSE 0
            END,
            last_updated = NOW()
        RETURNING * INTO v_balance;

        RETURN v_balance;
    END;
    $func$;
EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'Skipped upsert_point_balance (engagement_point_balances table missing)';
END $migration$;

-- redeem_gift_card: fix pcompany_id → p_company_id; remove company_id from INSERT
DO $migration$
BEGIN
    CREATE OR REPLACE FUNCTION public.redeem_gift_card(
        p_gift_card_id TEXT,
        p_amount NUMERIC,
        p_customer_id TEXT,
        p_company_id TEXT  -- parameter name fixed from pcompany_id to p_company_id
    )
    RETURNS engagement_gift_cards
    LANGUAGE plpgsql
    AS $func$
    DECLARE
        v_card engagement_gift_cards%ROWTYPE;
    BEGIN
        SELECT * INTO v_card FROM engagement_gift_cards WHERE id = p_gift_card_id FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Gift card not found';
        END IF;

        IF v_card.status != 'active' THEN
            RAISE EXCEPTION 'Gift card is not active';
        END IF;

        IF v_card.current_balance < p_amount THEN
            RAISE EXCEPTION 'Insufficient gift card balance';
        END IF;

        IF v_card.expires_at IS NOT NULL AND v_card.expires_at < NOW() THEN
            RAISE EXCEPTION 'Gift card has expired';
        END IF;

        UPDATE engagement_gift_cards SET
            current_balance = current_balance - p_amount,
            updated_at = NOW()
        WHERE id = p_gift_card_id
        RETURNING * INTO v_card;

        INSERT INTO engagement_gift_card_transactions (
            id, gift_card_id, customer_id, transaction_type,
            amount, balance_before, balance_after
        )
        VALUES (
            gen_random_uuid()::TEXT,
            p_gift_card_id,
            p_customer_id,
            'redemption',
            p_amount,
            v_card.current_balance + p_amount,
            v_card.current_balance
        );

        RETURN v_card;
    END;
    $func$;
EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'Skipped redeem_gift_card (engagement tables missing)';
END $migration$;

-- calculate_tier_for_customer: fix pcompany_id → p_company_id; remove company_id filter
DO $migration$
BEGIN
    CREATE OR REPLACE FUNCTION public.calculate_tier_for_customer(
        p_customer_id TEXT,
        p_company_id TEXT  -- parameter name fixed from pcompany_id to p_company_id
    )
    RETURNS engagement_customer_tiers
    LANGUAGE plpgsql
    AS $func$
    DECLARE
        v_points NUMERIC;
        v_tier engagement_membership_tiers%ROWTYPE;
        v_customer_tier engagement_customer_tiers%ROWTYPE;
    BEGIN
        SELECT balance INTO v_points
        FROM engagement_point_balances
        WHERE customer_id = p_customer_id;

        IF v_points IS NULL THEN
            v_points := 0;
        END IF;

        -- Single-company: no company_id filter on membership_tiers
        SELECT * INTO v_tier FROM engagement_membership_tiers
        WHERE is_active = true
          AND min_points <= v_points
          AND (max_points IS NULL OR max_points >= v_points)
        ORDER BY level DESC
        LIMIT 1;

        IF v_tier.id IS NULL THEN
            SELECT * INTO v_tier FROM engagement_membership_tiers
            WHERE is_active = true
            ORDER BY level ASC
            LIMIT 1;
        END IF;

        IF v_tier.id IS NOT NULL THEN
            UPDATE engagement_customer_tiers
            SET is_current = false
            WHERE customer_id = p_customer_id AND is_current = true;

            INSERT INTO engagement_customer_tiers (
                id, customer_id, tier_id, tier_name, tier_level
            )
            VALUES (
                gen_random_uuid()::TEXT,
                p_customer_id,
                v_tier.id,
                v_tier.name,
                v_tier.level
            )
            RETURNING * INTO v_customer_tier;
        END IF;

        RETURN v_customer_tier;
    END;
    $func$;
EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'Skipped calculate_tier_for_customer (engagement tables missing)';
END $migration$;

-- ============================================================================
-- STEP 10: Drop the get_user_company_id() function and replace with NULL stub
--          (kept as a compatibility stub that returns NULL so any lingering
--           references don't cause "function does not exist" errors)
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_user_company_id() CASCADE;

CREATE OR REPLACE FUNCTION public.get_user_company_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULL::TEXT;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_company_id() TO anon;

-- ============================================================================
-- STEP 11: Simplify RLS policies to be permissive for all authenticated users
--          (no tenant filtering)
-- ============================================================================
-- For every table that has RLS enabled, drop all existing policies and
-- create a single permissive policy: any authenticated user can do
-- anything (SELECT, INSERT, UPDATE, DELETE).

-- Explicitly handle core tables that had custom policy names.
-- Each table-scoped DROP POLICY is guarded by to_regclass() so missing tables
-- are skipped instead of aborting the migration (DROP POLICY ... IF EXISTS
-- still errors with 42P01 when the TABLE does not exist).

DO $$
DECLARE
    p RECORD;
BEGIN
    FOR p IN SELECT * FROM (VALUES
        ('companies',                 'Authenticated users can insert companies'),
        ('companies',                 'Authenticated users can view companies'),
        ('companies',                 'Authenticated users can update companies'),
        ('companies',                 'Authenticated users can delete companies'),
        ('companies',                 'Users can insert their company'),
        ('companies',                 'Users can view their company'),
        ('companies',                 'Users can update their company'),
        ('companies',                 'Users can delete their company'),
        ('companies',                 'companies_select'),
        ('companies',                 'companies_insert'),
        ('companies',                 'companies_update'),
        ('companies',                 'companies_delete'),
        ('companies',                 'tenant_all'),
        ('company_users',             'company_users_select'),
        ('company_users',             'company_users_insert'),
        ('company_users',             'company_users_update'),
        ('company_users',             'company_users_delete'),
        ('profiles',                  'Authenticated users can insert profiles'),
        ('profiles',                  'Users can view profiles'),
        ('profiles',                  'Users can update profiles'),
        ('profiles',                  'Users can delete profiles'),
        ('profiles',                  'Users can view own profile'),
        ('profiles',                  'Users can insert own profile'),
        ('profiles',                  'profiles_select'),
        ('profiles',                  'profiles_insert'),
        ('profiles',                  'profiles_update'),
        ('profiles',                  'profiles_delete'),
        ('profiles',                  'tenant_all'),
        ('idempotency_keys',          'Authenticated users can manage idempotency keys'),
        ('idempotency_keys',          'Users can manage idempotency keys'),
        ('tax_rates',                 'Users can view tax rates'),
        ('tax_rates',                 'Users can upsert tax rates'),
        ('tax_rates',                 'Users can update tax rates'),
        ('tax_rates',                 'Users can delete tax rates'),
        ('warehouses',                'tenant_all'),
        ('accounts',                  'tenant_all'),
        ('inventory_audit_ledger',    'audit_ledger_select'),
        ('inventory_audit_ledger',    'audit_ledger_insert'),
        ('financial_years',           'financial_years_select'),
        ('financial_years',           'financial_years_insert'),
        ('financial_years',           'financial_years_update'),
        ('financial_years',           'financial_years_delete'),
        ('user_preferences',          'user_preferences_select'),
        ('user_preferences',          'user_preferences_insert'),
        ('user_preferences',          'user_preferences_update'),
        ('user_preferences',          'user_preferences_delete')
    ) AS p(table_name, policy_name)
    LOOP
        IF to_regclass(format('%I.%I', 'public', p.table_name)) IS NOT NULL THEN
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policy_name, p.table_name);
        END IF;
    END LOOP;
END $$;

-- Explicit engagement table policy drops
DO $$
DECLARE
    p RECORD;
BEGIN
    FOR p IN SELECT * FROM (VALUES
        ('engagement_timeline',            'engagement_timeline_company'),
        ('engagement_timeline',            'engagement_timeline_company_insert'),
        ('engagement_audit',               'engagement_audit_company'),
        ('engagement_audit',               'engagement_audit_company_insert'),
        ('engagement_points',              'engagement_points_company'),
        ('engagement_points',              'engagement_points_company_insert'),
        ('engagement_point_balances',      'engagement_balances_company'),
        ('engagement_point_balances',      'engagement_balances_company_insert'),
        ('engagement_cashback',            'engagement_cashback_company'),
        ('engagement_cashback',            'engagement_cashback_company_insert'),
        ('engagement_membership_tiers',    'engagement_tiers_company'),
        ('engagement_membership_tiers',    'engagement_tiers_company_insert'),
        ('engagement_customer_tiers',      'engagement_customer_tiers_company'),
        ('engagement_customer_tiers',      'engagement_customer_tiers_company_insert'),
        ('engagement_gift_cards',          'engagement_gift_cards_company'),
        ('engagement_gift_cards',          'engagement_gift_cards_company_insert'),
        ('engagement_gift_card_transactions', 'engagement_gc_tx_company'),
        ('engagement_gift_card_transactions', 'engagement_gc_tx_company_insert'),
        ('engagement_affiliates',          'engagement_affiliates_company'),
        ('engagement_affiliates',          'engagement_affiliates_company_insert'),
        ('engagement_affiliate_commissions', 'engagement_aff_comm_company'),
        ('engagement_affiliate_commissions', 'engagement_aff_comm_company_insert'),
        ('engagement_promotions',          'engagement_promotions_company'),
        ('engagement_promotions',          'engagement_promotions_company_insert'),
        ('engagement_customer_rewards',    'engagement_cust_rewards_company'),
        ('engagement_customer_rewards',    'engagement_cust_rewards_company_insert'),
        ('engagement_analytics',           'engagement_analytics_company'),
        ('engagement_analytics',           'engagement_analytics_company_insert')
    ) AS p(table_name, policy_name)
    LOOP
        IF to_regclass(format('%I.%I', 'public', p.table_name)) IS NOT NULL THEN
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policy_name, p.table_name);
        END IF;
    END LOOP;
END $$;

-- Explicit referral table policy drops
DO $$
DECLARE
    p RECORD;
BEGIN
    FOR p IN SELECT * FROM (VALUES
        ('customer_referrals', 'tenant_all'),
        ('customer_referrals', 'tenant_isolation_policy'),
        ('referral_rewards',   'tenant_all'),
        ('referral_rewards',   'tenant_isolation_policy')
    ) AS p(table_name, policy_name)
    LOOP
        IF to_regclass(format('%I.%I', 'public', p.table_name)) IS NOT NULL THEN
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policy_name, p.table_name);
        END IF;
    END LOOP;
END $$;

-- Explicit examination table policy drops (from supabase-rls-policies.sql)
DO $$
DECLARE
    p RECORD;
BEGIN
    FOR p IN SELECT * FROM (VALUES
        ('examination_batches',              'tenant_examination_batches'),
        ('examination_classes',              'tenant_examination_classes'),
        ('examination_subjects',             'tenant_examination_subjects'),
        ('examination_bom_calculations',     'tenant_examination_bom_calculations'),
        ('examination_class_adjustments',    'tenant_examination_class_adjustments'),
        ('examination_pricing_audit',        'tenant_examination_pricing_audit'),
        ('examination_batch_notifications',  'tenant_examination_batch_notifications'),
        ('notification_audit_logs',          'tenant_notification_audit_logs'),
        ('bom_default_materials',            'tenant_bom_default_materials'),
        ('work_centers',                     'tenant_work_centers'),
        ('production_resources',             'tenant_production_resources'),
        ('work_orders',                      'tenant_work_orders'),
        ('production_batches',               'tenant_production_batches'),
        ('inventory',                        'tenant_inventory_select'),
        ('inventory',                        'tenant_inventory_insert'),
        ('inventory',                        'tenant_inventory_update'),
        ('inventory',                        'tenant_inventory_delete'),
        ('inventory',                        'Users can view company inventory'),
        ('inventory',                        'Users can insert company inventory'),
        ('inventory',                        'Users can update company inventory'),
        ('inventory',                        'Users can delete company inventory')
    ) AS p(table_name, policy_name)
    LOOP
        IF to_regclass(format('%I.%I', 'public', p.table_name)) IS NOT NULL THEN
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policy_name, p.table_name);
        END IF;
    END LOOP;
END $$;

-- Dynamic: drop ALL remaining policies from ALL public tables
DO $$
DECLARE
    rec RECORD;
    v_count INT := 0;
BEGIN
    FOR rec IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', rec.policyname, rec.schemaname, rec.tablename);
        v_count := v_count + 1;
    END LOOP;

    RAISE NOTICE 'Dropped % remaining policies from public schema', v_count;
END $$;

-- ============================================================================
-- STEP 12: Create simplified PERMISSIVE policies for all authenticated users
--          (no tenant filtering — single-company architecture)
-- ============================================================================
-- For every table in the public schema that has RLS enabled, create a
-- single permissive policy that allows all authenticated users full access.

DO $$
DECLARE
    rec RECORD;
    v_count INT := 0;
BEGIN
    FOR rec IN
        SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relrowsecurity = true
    LOOP
        BEGIN
            EXECUTE format(
                'CREATE POLICY "permissive_all" ON %I AS PERMISSIVE FOR ALL '
                'TO authenticated '
                'USING (true) '
                'WITH CHECK (true)',
                rec.table_name
            );
            v_count := v_count + 1;
            RAISE NOTICE 'Created permissive_all policy on %', rec.table_name;
        EXCEPTION WHEN duplicate_object THEN
            RAISE NOTICE 'Policy already exists on %, skipping', rec.table_name;
        WHEN OTHERS THEN
            RAISE NOTICE 'Could not create policy on %: %', rec.table_name, SQLERRM;
        END;
    END LOOP;

    RAISE NOTICE 'Total permissive policies created: %', v_count;
END $$;

-- ============================================================================
-- STEP 13: Drop the remaining helper function set_user_app_metadata
--          (kept separate for clarity — already dropped in Step 2 above)
-- ============================================================================
-- Already handled: DROP FUNCTION IF EXISTS public.set_user_app_metadata(uuid, text, text);

-- ============================================================================
-- STEP 14: Verification
-- ============================================================================
SELECT '=== SINGLE-COMPANY MIGRATION COMPLETE ===' AS status;

-- Verify no company_id columns remain (excluding dropped tables)
SELECT 'Remaining tables with company_id column:' AS check_name,
       COUNT(*) AS count
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'company_id';

-- Verify get_user_company_id returns NULL
SELECT 'get_user_company_id() returns:' AS check_name,
       public.get_user_company_id() AS value;

-- Verify no policies reference company_id or get_user_company_id
SELECT 'Policies still referencing company_id or get_user_company_id():' AS check_name,
       COUNT(*) AS count
FROM pg_policies
WHERE schemaname = 'public'
  AND (
       qual::text ILIKE '%company_id%'
       OR with_check::text ILIKE '%company_id%'
       OR qual::text ILIKE '%get_user_company_id%'
       OR with_check::text ILIKE '%get_user_company_id%'
       OR qual::text ILIKE '%get_current_company_id%'
       OR with_check::text ILIKE '%get_current_company_id%'
  );

-- Verify companies, company_users, company_config tables are gone
SELECT 'Companies tables remaining:' AS check_name,
       COUNT(*) AS count
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('companies', 'company_users', 'company_config');

-- Verify no FK constraints reference companies, company_users, or company_config
SELECT 'FK constraints referencing company tables:' AS check_name,
       COUNT(*) AS count
FROM pg_constraint con
JOIN pg_namespace n ON n.oid = con.confrelid
WHERE con.contype = 'f'
  AND n.nspname = 'public'
  AND con.confrelid IN (
      (SELECT oid FROM pg_class WHERE relname = 'companies' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')),
      (SELECT oid FROM pg_class WHERE relname = 'company_users' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')),
      (SELECT oid FROM pg_class WHERE relname = 'company_config' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))
  );

-- List all remaining tables with RLS enabled and their policy counts
SELECT tablename AS table_name, COUNT(policyname) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policies p ON p.tablename = c.relname AND p.schemaname = 'public'
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = true
GROUP BY tablename
ORDER BY tablename;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
