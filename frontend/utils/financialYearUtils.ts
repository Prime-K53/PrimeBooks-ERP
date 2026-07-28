function getCompanyId(): string {
  try {
    const config = localStorage.getItem('nexus_company_config');
    if (config) {
      const parsed = JSON.parse(config);
      return parsed.companyId || '';
    }
  } catch { /* non-fatal */ }
  return '';
}

function fyKey(key: string): string {
  const companyId = getCompanyId();
  return companyId ? `company:${companyId}:${key}` : key;
}

export function getDefaultDate(): string {
  try {
    const fyStart = localStorage.getItem(fyKey('selectedFinancialYearStart'));
    const fyEnd = localStorage.getItem(fyKey('selectedFinancialYearEnd'));
    if (fyStart && fyEnd) {
      const today = new Date().toISOString().slice(0, 10);
      if (today >= fyStart && today <= fyEnd) return today;
      return fyStart;
    }
  } catch { /* non-fatal */ }
  return new Date().toISOString().slice(0, 10);
}

export function isDateInFY(date: string): boolean {
  try {
    const fyStart = localStorage.getItem(fyKey('selectedFinancialYearStart'));
    const fyEnd = localStorage.getItem(fyKey('selectedFinancialYearEnd'));
    if (fyStart && fyEnd) {
      return date >= fyStart && date <= fyEnd;
    }
  } catch { /* non-fatal */ }
  return true;
}

export function validateDateInFY(date: string): string | null {
  try {
    const fyId = localStorage.getItem(fyKey('selectedFinancialYearId'));
    if (!fyId) return null;
    const fyStart = localStorage.getItem(fyKey('selectedFinancialYearStart'));
    const fyEnd = localStorage.getItem(fyKey('selectedFinancialYearEnd'));
    const fyName = localStorage.getItem(fyKey('selectedFinancialYearName'));
    if (fyStart && fyEnd && (date < fyStart || date > fyEnd)) {
      return `Selected date does not belong to the active Financial Year (${fyName || 'Unknown'}). Please switch Financial Year or choose a valid date within ${fyStart} to ${fyEnd}.`;
    }
    if (localStorage.getItem(fyKey('selectedFinancialYearClosed')) === '1') {
      return `Financial Year "${fyName || 'Unknown'}" is closed. No new transactions can be created.`;
    }
  } catch { /* non-fatal */ }
  return null;
}