export const MAX_AMOUNT = 999_999_999_999;
export function validAmount(value) { return Number.isSafeInteger(value) && value > 0 && value <= MAX_AMOUNT; }
export function validDate(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const d = new Date(value + 'T12:00:00Z'); return Number.isFinite(d.valueOf()) && d.toISOString().slice(0,10) === value; }
export function todayISO() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function at(year, month, day) { const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); return new Date(Date.UTC(year, month, Math.min(day, last))); }
const iso = d => d.toISOString().slice(0,10);
export function getPeriod(date, mode = 'calendar', payday = 25) {
  const now = new Date(date + 'T00:00:00Z'); const year = now.getUTCFullYear(), month = now.getUTCMonth();
  const day = mode === 'payday' ? Math.max(1, Math.min(31, Number(payday) || 25)) : 1;
  const thisStart = at(year, month, day); const startMonth = now < thisStart ? month - 1 : month;
  const start = at(year, startMonth, day), next = at(year, startMonth + 1, day); const end = new Date(next.valueOf() - 86400000);
  return { start: iso(start), end: iso(end), days: Math.round((next - start) / 86400000), daysLeft: Math.round((end - now) / 86400000) + 1, elapsed: Math.round((now - start) / 86400000) + 1 };
}
export const activeEntries = state => state.entries.filter(entry => !entry.deletedAt);
export function summarize(state, date = todayISO()) {
  const period = getPeriod(date, state.settings.periodMode, state.settings.payday);
  const entries = activeEntries(state).filter(e => e.date >= period.start && e.date <= period.end && e.date <= date);
  const spent = entries.filter(e => e.type === 'expense').reduce((sum,e) => sum + e.amount, 0);
  const income = entries.filter(e => e.type === 'income').reduce((sum,e) => sum + e.amount, 0);
  const budget = state.budgets[period.start] ?? null;
  const paid = new Set(entries.filter(e => e.type === 'expense' && e.fixedId).map(e => e.fixedId));
  const unpaidFixed = state.fixedCosts.filter(f => !paid.has(f.id)).reduce((sum,f) => sum + f.amount,0);
  return { period, spent, income, budget, unpaidFixed, remaining: budget === null ? null : budget - spent, available: budget === null ? null : budget - spent - unpaidFixed, percent: budget === null ? null : Math.round(spent / budget * 100) };
}
export function emptyState() { return { version: 1, settings: { periodMode: 'calendar', payday: 25 }, budgets: {}, fixedCosts: [], entries: [], bookmarks: [] }; }
export function parseState(raw) {
  try {
    const s = JSON.parse(raw); if (s?.version !== 1 || !['calendar','payday'].includes(s.settings?.periodMode) || !Number.isInteger(s.settings.payday) || s.settings.payday < 1 || s.settings.payday > 31 || !Array.isArray(s.entries) || !Array.isArray(s.fixedCosts) || !s.budgets || typeof s.budgets !== 'object' || Array.isArray(s.budgets) || !Array.isArray(s.bookmarks)) return null;
    if (!Object.entries(s.budgets).every(([key,value]) => validDate(key) && validAmount(value))) return null;
    if (!s.entries.every(e => typeof e.id === 'string' && ['expense','income','transfer'].includes(e.type) && validAmount(e.amount) && validDate(e.date) && typeof e.merchant === 'string' && typeof e.reason === 'string' && (e.fixedId === null || typeof e.fixedId === 'string') && (e.deletedAt == null || (typeof e.deletedAt === 'string' && Number.isFinite(Date.parse(e.deletedAt)))))) return null;
    if (!s.fixedCosts.every(f => typeof f.id === 'string' && typeof f.name === 'string' && validAmount(f.amount) && Number.isInteger(f.day) && f.day >= 1 && f.day <= 31)) return null;
    if (!s.bookmarks.every(id => Number.isInteger(id) && id >= 0 && id < 7)) return null;
    return s;
  } catch { return null; }
}
