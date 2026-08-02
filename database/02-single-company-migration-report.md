# Single-Company Migration — Final Validation Report

Status: **COMPLETE** — code migration done and `supabase-migrate-to-single-company.sql`
has been **executed successfully** in the Supabase SQL Editor (verified: every RLS
table now has exactly 1 permissive policy; companies/company_users/company_config
dropped; all company_id columns removed).

---

## 1. Verification Results

| Check | Result |
|-------|--------|
| Frontend `company_id` / `companyId` / `_companyId` references | **0** (all `*.{ts,tsx}`) |
| Supabase Edge Functions `company_id` / `companyId` references | **0** |
| Frontend `tenant` / `tenantId` / `tenant_id` references | **0** |
| Company switcher components (CompanySwitcher / switchCompany) | **0** |
| Frontend test suite | 431 passed / 5 failed — **failures are pre-existing** (verified by stashing all changes: identical 5 failures on clean HEAD) |
| Backend test suite (`npm test`, env from `.env`) | **11 suites, 79 tests — all pass** |
| TypeScript (`npx tsc --noEmit`) | Only pre-existing errors in untouched files (ErrorBoundary, KeyboardProvider, PDF components, etc.) |

Modified frontend tests all pass: `cloudDb.test.ts`, `conflictResolver.test.ts`,
`dbRouting.test.ts` — 18/18.

## 2. What Was Changed

### Backend (already migrated — no new changes)
- `backend/db.cjs` `migrateSingleOrganization()` drops company_id columns, the
  `companies` table, and tenant joins. Runs on boot for existing DBs.
- Fixed SQL syntax errors that surfaced during this session:
  - `backend/services/portalLifecycleService.cjs` — `FROM quotation_requests
    WHERE reviewed_at` (was missing space + WHERE)
  - `backend/services/referralService.cjs` — 5 analytics/aggregation queries
    missing `WHERE`
- `backend/middleware/companyValidation.cjs` deleted.

### Frontend (23 files)
- **Types**: `types.ts` (17× `company_id?: string`, `CompanyConfig.companyId`),
  `types/referral.ts` (2), `types/referral-extended.ts` (6),
  `types/engagement.ts` (20), `services/authApiClient.ts` (StaffUserInfo /
  PortalUserInfo), `services/adminPortalClient.ts` (3),
  `services/portalApiClient.ts` (3)
- **Services**: `cloudDb.ts` (removed company_id from read/write paths and the
  `_companyId` strip), `syncService.ts` (removed `_companyId` delete),
  `DataContext.tsx` (Realtime channel `primeerp-company-data:${companyId}` →
  `primeerp-data`, removed `company_id=eq.` filters)
- **Views**: `SetupWizard.tsx` (removed preGeneratedCompanyId, signup metadata,
  FY creation company_id), `Login.tsx`, `Settings.tsx` (Delete Company →
  Factory Reset; removed `cloudDb.deleteCompany()`), `FinancialYearContext.tsx`
- **Tests**: `cloudDb.test.ts`, `conflictResolver.test.ts`, `dbRouting.test.ts`

### Supabase Edge Functions
- `supabase/functions/referral-analytics/index.ts` — removed `body.companyId`
  and `p_company_id` RPC argument.

## 3. Database Migration (EXECUTED 2026-08-02)

**File**: `database/supabase-migrate-to-single-company.sql` — run in the Supabase
SQL Editor. Confirmed successful via the Step 14 verification output:
every RLS-enabled table (170+) has exactly 1 `permissive_all` policy, and the
`companies`/`company_users`/`company_config` tables are gone.

The migration:

1. Drops all company-scoped triggers and functions (incl. the
   `get_user_company_id()` helper and `handle_new_user_signup` company logic)
2. Drops all RLS policies and re-creates **permissive** single-tenant policies
   per table
3. Drops FKs, indexes, and `company_id` columns from **153 tables**
4. Drops `companies`, `company_users`, `company_config` tables
5. Fixes the `pcompany_id` parameter bug in engagement RPC functions
6. `profiles.company_id` column is dropped and the `company_id` JWT claim
   becomes irrelevant (RLS no longer references it)

> Note: the Supabase legacy typed schema (`erp_schema_postgresql.sql`) and the
> many piecemeal `supabase-fix-*.sql` patches are now obsolete. The migration
> SQL supersedes them.
>
> Robustness fixes applied during execution: table-scoped `DROP TRIGGER` /
> `DROP POLICY` statements guarded with `to_regclass()` (skip missing tables),
> `DROP FUNCTION ... CASCADE` (dependent tenant policies/views), constraint-
> backed indexes skipped in the index-drop step, `DROP COLUMN ... CASCADE`
> throughout, and engagement function recreation wrapped in
> `undefined_table`-guarded blocks.

## 4. Remaining Risks / Follow-ups

| Risk | Impact | Action |
|------|--------|--------|
| Stale `localStorage` key `prime-erp-supabase-auth` (old refresh token) | 401 "Invalid Refresh Token" on login | Clear browser storage or sign out/in; code now discards expired tokens cleanly |
| Backend SQLite user row missing (user exists only in Supabase) | `/api/auth/login` falls back to Supabase direct auth | Create the user row via `migrateSingleOrganization` boot path or signup flow |
| `backend/tests/integration/multiTenantCompanyResolution.test.js` and `tenant_isolation_security.test.js` reference removed behavior | Not run (intentionally ignored in jest config) | Delete or rewrite as single-tenant tests; kept ignored for now |
| 5 pre-existing frontend test failures | Unrelated to migration (verified on clean HEAD) | Fix separately: examinationBatchService offline, inventoryStore rawMaterial mocks, PDF/splitPayments/subjectTable suites |

## 5. Files Touched This Session (migration-specific)

```
database/supabase-migrate-to-single-company.sql   (new)
database/01-root-cause-analysis.md                (status banner added)
backend/services/portalLifecycleService.cjs       (SQL WHERE fix)
backend/services/referralService.cjs              (5× SQL WHERE fix)
frontend/services/cloudDb.ts, syncService.ts, authApiClient.ts,
           adminPortalClient.ts, portalApiClient.ts
frontend/context/DataContext.tsx, FinancialYearContext.tsx
frontend/views/auth/Login.tsx, SetupWizard.tsx, Settings.tsx
frontend/types.ts, types/referral.ts, types/referral-extended.ts, types/engagement.ts
supabase/functions/referral-analytics/index.ts
frontend/tests/unit/sync/cloudDb.test.ts, conflictResolver.test.ts
frontend/tests/unit/services/dbRouting.test.ts
```
