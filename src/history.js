import { getPeriod, todayISO, activeEntries } from './domain.js';

const won = n => `${new Intl.NumberFormat('ko-KR').format(n)}원`;
export function shiftMonth(month, delta) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}
export function calendarModel(month, entries, period) {
  const first = new Date(`${month}-01T00:00:00Z`);
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const totals = new Map();
  for (const entry of entries) {
    if (entry.deletedAt) continue;
    if (!entry.date.startsWith(month)) continue;
    if (!totals.has(entry.date)) totals.set(entry.date, { expense: 0, income: 0 });
    if (entry.type === 'expense' || entry.type === 'income') totals.get(entry.date)[entry.type] += entry.amount;
  }
  return { offset: first.getUTCDay(), days: Array.from({ length: count }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    return { date, day: i + 1, ...totals.get(date) || { expense: 0, income: 0 }, inPeriod: date >= period.start && date <= period.end };
  }) };
}

export function createHistory({ getState, onRecord, onEdit, onOpenSheet }) {
  const $ = selector => document.querySelector(selector);
  let month = todayISO().slice(0, 7), selectedDate = null;
  function render() {
    const state = getState();
    const period = getPeriod(todayISO(), state.settings.periodMode, state.settings.payday);
    const model = calendarModel(month, state.entries, period);
    $('#calendar-month').textContent = `${Number(month.slice(0, 4))}년 ${Number(month.slice(5))}월`;
    $('#calendar-period').textContent = `현재 예산 기간 ${period.start} ~ ${period.end}`;
    const periodEntries = activeEntries(state).filter(e => e.date >= period.start && e.date <= period.end && e.date <= todayISO());
    for (const type of ['expense', 'income']) $('#history-' + type).textContent = won(periodEntries.filter(e => e.type === type).reduce((sum, e) => sum + e.amount, 0));
    const grid = $('#calendar-days'); grid.replaceChildren();
    for (let i = 0; i < model.offset; i++) {
      const blank = document.createElement('span'); blank.className = 'calendar-blank'; blank.setAttribute('aria-hidden', 'true'); grid.append(blank);
    }
    for (const day of model.days) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'calendar-day'; button.dataset.date = day.date;
      button.classList.toggle('in-period', day.inPeriod); button.classList.toggle('is-today', day.date === todayISO()); button.classList.toggle('is-selected', day.date === selectedDate);
      button.setAttribute('aria-label', `${day.date}${day.date === todayISO() ? ', 오늘' : ''}, 지출 ${won(day.expense)}, 수입 ${won(day.income)}${day.date >= period.start && day.date <= period.end ? ', 현재 예산 기간' : ''}`);
      button.setAttribute('aria-haspopup', 'dialog');
      const number = document.createElement('span'); number.className = 'day-number'; number.textContent = day.day; button.append(number);
      for (const type of ['expense', 'income']) {
        if (!day[type]) continue;
        const total = document.createElement('span'); total.className = `day-total ${type}`;
        // Full amounts remain visible in the sheet and accessible label; narrow calendars use 만/억 units.
        const full = document.createElement('span'); full.className = 'amount-full'; full.textContent = `${type === 'expense' ? '−' : '+'}${new Intl.NumberFormat('ko-KR').format(day[type])}`;
        const compact = document.createElement('span'); compact.className = 'amount-compact'; compact.textContent = `${type === 'expense' ? '−' : '+'}${compactAmount(day[type])}`;
        total.append(full, compact); button.append(total);
      }
      button.addEventListener('click', () => showDay(day.date)); grid.append(button);
    }
    if ($('#day-dialog').open && selectedDate) renderDay();
  }
  function compactAmount(amount) {
    if (amount < 10000) return new Intl.NumberFormat('ko-KR').format(amount);
    const unit = amount >= 100000000 ? 100000000 : 10000;
    return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(amount / unit)}${unit === 10000 ? '만' : '억'}`;
  }
  function renderDay() {
    const entries = activeEntries(getState()).filter(e => e.date === selectedDate).slice().reverse();
    $('#day-title').textContent = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC' }).format(new Date(selectedDate + 'T00:00:00Z'));
    $('#day-full-date').textContent = selectedDate;
    for (const type of ['expense', 'income']) $('#day-' + type).textContent = won(entries.filter(e => e.type === type).reduce((sum, e) => sum + e.amount, 0));
    const list = $('#day-entries'); list.replaceChildren();
    $('#day-empty').hidden = entries.length > 0;
    for (const entry of entries) {
      const row = document.createElement('li');
      const button = document.createElement('button'); button.type = 'button'; button.className = `day-entry ${entry.type}`;
      button.setAttribute('aria-label', `${entry.merchant} ${won(entry.amount)} 기록 수정`);
      button.setAttribute('aria-haspopup', 'dialog');
      button.addEventListener('click', () => {
        $('#day-dialog').close();
        onEdit(entry, selectedDate, $('#calendar-days').querySelector(`[data-date="${selectedDate}"]`));
      });
      const detail = document.createElement('div'); detail.className = 'entry-detail';
      const title = document.createElement('strong'); title.textContent = entry.merchant;
      const meta = document.createElement('p'); meta.textContent = entry.type === 'transfer' ? '내 계좌 간 이체 · 합계 제외' : entry.type === 'income' ? entry.category || '기타 수입' : entry.category || '미분류';
      detail.append(title, meta);
      if(entry.description){const description=document.createElement('p');description.className='entry-description';description.textContent=entry.description;detail.append(description);}
      if (entry.reason) { const reason = document.createElement('p'); reason.className = 'entry-reason'; reason.textContent = entry.reason; detail.append(reason); }
      const amount = document.createElement('strong'); amount.className = 'entry-amount'; amount.textContent = `${entry.type === 'expense' ? '−' : entry.type === 'income' ? '+' : ''}${won(entry.amount)}`;
      button.append(detail, amount); row.append(button); list.append(row);
    }
    $('#record-selected-day').disabled = selectedDate > todayISO();
    $('#future-day-note').hidden = selectedDate <= todayISO();
  }
  function showDay(date) {
    selectedDate = date; month = date.slice(0, 7); render(); renderDay();
    onOpenSheet($('#calendar-days').querySelector(`[data-date="${date}"]`));
    if (!$('#day-dialog').open) $('#day-dialog').showModal();
  }
  $('#calendar-prev').addEventListener('click', () => { month = shiftMonth(month, -1); render(); });
  $('#calendar-next').addEventListener('click', () => { month = shiftMonth(month, 1); render(); });
  $('#calendar-today').addEventListener('click', () => { month = todayISO().slice(0, 7); render(); });
  $('#record-selected-day').addEventListener('click', () => {
    $('#day-dialog').close();
    onRecord(selectedDate, $('#calendar-days').querySelector(`[data-date="${selectedDate}"]`));
  });
  return { render, showDay };
}
