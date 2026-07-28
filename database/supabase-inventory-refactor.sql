-- ============================================================================
-- Enterprise Cloud-Native Inventory Creation & ID Architecture Refactor Migration
-- ============================================================================

-- 1. Ensure extension for UUID generation is available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Create or alter the public.inventory table for PostgreSQL / Supabase
CREATE TABLE IF NOT EXISTS public.inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sku TEXT,
  material TEXT,
  type TEXT DEFAULT 'material',
  quantity NUMERIC DEFAULT 0,
  cost_per_unit NUMERIC DEFAULT 0,
  selling_price NUMERIC DEFAULT 0,
  unit TEXT DEFAULT 'units',
  category_id TEXT,
  min_stock_level NUMERIC DEFAULT 0,
  max_stock_level NUMERIC DEFAULT 0,
  reorder_point NUMERIC DEFAULT 0,
  warehouse_id TEXT,
  reserved NUMERIC DEFAULT 0,
  is_protected BOOLEAN DEFAULT false,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure columns exist if table was created previously with legacy schema
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory' AND column_name='created_by') THEN
    ALTER TABLE public.inventory ADD COLUMN created_by TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory' AND column_name='sku') THEN
    ALTER TABLE public.inventory ADD COLUMN sku TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory' AND column_name='selling_price') THEN
    ALTER TABLE public.inventory ADD COLUMN selling_price NUMERIC DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory' AND column_name='updated_at') THEN
    ALTER TABLE public.inventory ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- 3. Scoped unique constraint: UNIQUE(company_id, sku) where sku is not null and non-empty
DROP INDEX IF EXISTS idx_inventory_company_sku;
CREATE UNIQUE INDEX idx_inventory_company_sku 
  ON public.inventory (company_id, sku) 
  WHERE sku IS NOT NULL AND sku != '';

-- Index for tenant lookups
CREATE INDEX IF NOT EXISTS idx_inventory_company_id ON public.inventory (company_id);

-- Index for category lookups per tenant
CREATE INDEX IF NOT EXISTS idx_inventory_company_category ON public.inventory (company_id, category_id);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

-- 5. Drop old permissive or conflicting policies on inventory
DROP POLICY IF EXISTS "tenant_inventory_select" ON public.inventory;
DROP POLICY IF EXISTS "tenant_inventory_insert" ON public.inventory;
DROP POLICY IF EXISTS "tenant_inventory_update" ON public.inventory;
DROP POLICY IF EXISTS "tenant_inventory_delete" ON public.inventory;
DROP POLICY IF EXISTS "tenant_inventory_all" ON public.inventory;
DROP POLICY IF EXISTS "Users can view company inventory" ON public.inventory;
DROP POLICY IF EXISTS "Users can insert company inventory" ON public.inventory;
DROP POLICY IF EXISTS "Users can update company inventory" ON public.inventory;
DROP POLICY IF EXISTS "Users can delete company inventory" ON public.inventory;

-- 6. Helper function check: public.get_user_company_id()
CREATE OR REPLACE FUNCTION public.get_user_company_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.profiles WHERE user_id = auth.uid()::text LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_company_id() TO authenticated;

-- 7. Define tenant-isolated RLS policies
-- SELECT Policy
CREATE POLICY "tenant_inventory_select"
  ON public.inventory
  FOR SELECT
  TO authenticated
  USING (company_id = public.get_user_company_id());

-- INSERT Policy: enforce company_id matches user's authenticated tenant
CREATE POLICY "tenant_inventory_insert"
  ON public.inventory
  FOR INSERT
  TO authenticated
  WITH CHECK (company_id = public.get_user_company_id());

-- UPDATE Policy
CREATE POLICY "tenant_inventory_update"
  ON public.inventory
  FOR UPDATE
  TO authenticated
  USING (company_id = public.get_user_company_id())
  WITH CHECK (company_id = public.get_user_company_id());

-- DELETE Policy
CREATE POLICY "tenant_inventory_delete"
  ON public.inventory
  FOR DELETE
  TO authenticated
  USING (company_id = public.get_user_company_id());

-- 8. Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_inventory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_updated_at ON public.inventory;
CREATE TRIGGER trg_inventory_updated_at
  BEFORE UPDATE ON public.inventory
  FOR EACH ROW
  EXECUTE FUNCTION update_inventory_updated_at();
