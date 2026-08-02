# Root Cause Analysis: Missing Inventory (Company ID Mismatch)

> **STATUS: RESOLVED BY ARCHITECTURE CHANGE (single-company)**
>
> This document is a historical analysis of the multi-tenant (multi-company)
> design flaws that caused "missing" data. The resolution was not to patch
> tenant isolation further, but to **remove multi-tenancy entirely**:
>
> - Backend (SQLite): `backend/db.cjs` `migrateSingleOrganization()` drops
>   `company_id` columns, the `companies` table, and company-scoped queries.
> - Supabase (PostgreSQL): run `supabase-migrate-to-single-company.sql` in the
>   SQL Editor — drops `companies`/`company_users`/`company_config`, all
>   company_id columns, triggers, RLS policies and the `get_user_company_id()`
>   helper; replaces them with permissive policies for a single tenant.
> - Frontend: all `company_id`/`companyId`/`_companyId` references removed;
>   sync no longer tags records by company; Realtime channel is
>   `primeerp-data` (no company filter).
> - Edge Functions: `referral-analytics` no longer accepts `companyId`.
>
> After the migration, the failure modes described below (NULL company_id,
> RLS returning 0 rows, localStorage company context loss) cannot occur.

## Executive Summary

Inventory items are missing because the system has **no database-level enforcement** of company_id consistency. The entire tenant isolation relies on application-level code in both the frontend and backend, but:

1. **The database has no foreign keys** linking company_id to the companies table
2. **No CHECK constraints** prevent empty or cross-company references
3. **RLS policies can silently fail** when `get_user_company_id()` returns NULL (e.g., with PgBouncer transaction mode, or on fresh signup)
4. **Multiple fix files** (6+ migration files) have been applied trying to patch the same root issue

---

## Timeline of Vulnerabilities Found

### 1. No `company_users` Table in PostgreSQL

The `profiles` table has `UNIQUE(user_id)` — meaning one user CANNOT belong to multiple companies. The backend SQLite has a `user_companies` table supporting multi-company, but Supabase/PostgreSQL has no equivalent. Users signed up via Supabase Auth have only one company association.

**Impact**: When a user changes companies or gets re-assigned, their old profile data becomes orphaned.

### 2. `get_user_company_id()` Can Return NULL

The RLS helper function `get_user_company_id()` resolves company_id from:
1. `profiles.company_id`
2. JWT claim `company_id`
3. JWT claim `tenant_id`  
4. `auth.users.raw_user_meta_data.company_id`

**On Vercel deployments with PgBouncer (transaction mode)**, `auth.uid()` can return NULL because prepared statements bypass session state. This makes the entire RLS chain fail — **all queries return 0 rows**, making inventory appear empty.

### 3. Frontend Relies on localStorage for company_id

The `x-company-id` header is read from `localStorage` key `nexus_company_config`. This is:
- **Mutable by the user** (browser dev tools)
- **Not validated by the backend** beyond membership check
- **Fragile** — if localStorage is cleared (browser cache clear), company context is lost

### 4. Backend Routes Missing company_id Checks

| Route | File | Issue |
|-------|------|-------|
| `PUT /api/sales/:id` | `backend/index.cjs:891-913` | UPDATE without `AND company_id = ?` |
| `DELETE /api/sales/:id` | `backend/index.cjs:916-928` | Void (UPDATE) without `AND company_id = ?` |
| Referral edge function | `supabase/functions/referral-analytics/index.ts:38` | Accepts `companyId` from request body |

### 5. `_companyId` vs `company_id` Naming Inconsistency

Local IndexedDB stores `_companyId` (camelCase, underscore prefix).  
Supabase stores `company_id` (snake_case).  
TypeScript types inconsistently declare `company_id?: string` or omit it entirely.

If the mapping in `cloudDb.ts` between `_companyId` and `company_id` fails (e.g., the `_companyId` property is stripped by serialization), the cloud record is written without a company_id — and RLS hides it from all companies.

### 6. Dual Schema System Creates Gaps

The legacy typed schema (`erp_schema_postgresql.sql`) has proper columns and FKs.  
The Supabase JSONB schema stores everything in a `data` JSONB column with `company_id TEXT`.  
Items created via the legacy path may have company_id embedded in the JSONB `data` field instead of the dedicated `company_id` column, causing RLS filters to miss them.

---

## Confirmed Trigger Path for "Missing" Inventory

```
User signs up on Vercel deployment
  → Supabase Auth creates auth.users row
  → handle_new_user_signup() trigger fires
  → Creates profile with company_id = NULL (if trigger is not installed yet)
  → AuthContext.login() reads profile.company_id = NULL
  → Falls back to JWT user_metadata.company_id
  → If JWT also lacks it, companyId = ''
  → cloudDb.setActiveCompanyId('')  // Empty!
  → getAll('inventory') WHERE company_id = ''  // Returns nothing
  → Frontend shows empty inventory
  → Falls back to SEED_ITEMS (limited set)
  → "Some items are missing" — only seed items visible
```

Pull quote: *"RLS hardening migrations were applied piecemeal. Each fix addresses one symptom but the underlying architecture — company_id as a nullable TEXT column without FK enforcement — remains vulnerable to every edge case."*
