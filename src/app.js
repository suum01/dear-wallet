import { classify } from './categorizer.js';
import { categoryOptions, categoryIdentity, customCategoryKey, setCustomCategory } from './category-catalog.js';
import { merchantKey, findRule, ruleKey, setRule } from './category-rules.js';
import { createLiveClassifier, aiKey } from './ai-categorizer.js';
import { mergeForConnection } from './sheets.js';
import { mountAuthGate } from './auth-gate.js';
import { mountSheetSync } from './sheet-sync.js';
import { createHistory } from './history.js';
import { createReview } from './review.js';
import { emptyState, parseState, summarize, todayISO, validAmount, validDate, getPeriod } from './domain.js';
const $ = s => document.querySelector(s);
const sameEntry = (a,b) => a && b && [...new Set([...Object.keys(a),...Object.keys(b)])].filter(key=>key!=='updatedAt').every(key=>a[key]===b[key]);
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const icons = {
 home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',
 chart:'<path d="M12 3v9h9A9 9 0 1 1 12 3Z"/><path d="M16 3.9a9 9 0 0 1 4.1 4.1H16Z"/>',
 wallet:'<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18m-4 4h4v4h-4a2 2 0 0 1 0-4Z"/>',
 settings:'<path d="m9 3-1 3-3 1-2 4 2 2v4l4 3 3-1 3 1 4-3v-4l2-2-2-4-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
 plus:'<path d="M12 5v14M5 12h14"/>', chevron:'<path d="m8 10 4 4 4-4"/>',
 sprout:'<path d="M12 21v-9M12 15C3 15 3 7 3 7s9-1 9 8Zm0-4c0-8 9-8 9-8s1 9-9 9"/>',
 arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
 bulb:'<path d="M8 16c0-3-3-3-3-7a7 7 0 0 1 14 0c0 4-3 4-3 7Zm1 4h6m-5 3h4"/>',
 bookmark:'<path d="M6 3h12v18l-6-4-6 4Z"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>'
};
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[el.dataset.icon] || ''}</svg>`; });
let sheetUI,authGate,activeAccount,legacyImport=null;
let categoryMode='auto',pendingForgetKey=null;
let pendingCategory=null,declinedSuggestionKey=null;
let recordVersion=0;
const liveAI=createLiveClassifier({request:input=>authGate.classifyWithAI(input),onChange:()=>{if($('#record-dialog').open)refreshCategory();}});
const KEY = 'dear-wallet.v1'; let state = emptyState(), storageBlocked = false, demo = null, cacheMissing = false;
try { const raw = localStorage.getItem(KEY); cacheMissing = raw === null; if (raw !== null) { const loaded = parseState(raw); if (loaded) state = loaded; else storageBlocked = true; } } catch { storageBlocked = true; }
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 5000); }
function persist(next) {
  if (demo) { demo = next; return true; }
  if (authGate?.mode==='account' && activeAccount) {try{activeAccount.save(next);return true;}catch(error){toast(error.message);return false;}}
  if(authGate && authGate.mode!=='legacy'){toast('로그인 상태를 확인해주세요.');return false;}
  if (storageBlocked) { toast('저장 공간을 사용할 수 없거나 기존 데이터 확인이 필요해요. 기존 기록은 덮어쓰지 않았어요.'); return false; }
  try { localStorage.setItem(KEY, JSON.stringify(next)); state = next; sheetUI?.sync.changed(); return true; } catch { toast('저장하지 못했어요. 브라우저 저장 공간과 권한을 확인해주세요.'); return false; }
}
const current = () => demo || state;
const reviewUI=createReview({getState:current});
let activeView = 'home', recordReturnDate = null, editingEntry = null, undoDeletion = null;
const historyUI = createHistory({ getState: current, onOpenSheet: trigger => { $('#day-dialog').returnFocus = trigger; }, onRecord: (date, trigger) => {
  openDialog('record', trigger); $('#record-form').elements.date.value = date; recordReturnDate = date;
}, onEdit: (entry, date, trigger) => {
  openDialog('record', trigger, entry); recordReturnDate = date;
} });
const money = n => `${new Intl.NumberFormat('ko-KR').format(n)}원`;
const shortDate = s => `${Number(s.slice(5,7))}.${Number(s.slice(8,10))}`;
const tips = [
 ['카드 생활','카드를 쓴 날과 돈이 나가는 날은 달라요.','신용카드 사용은 소비가 발생한 날에 기록하고, 나중의 카드대금 출금은 같은 소비로 다시 더하지 않아요. 카드사별 이용 기간도 함께 확인해보세요.','https://www.fss.or.kr/'],
 ['이자 한 조각','단리와 복리, 이자가 붙는 방식이 달라요.','단리는 원금에만, 복리는 원금과 쌓인 이자에 이자가 붙는 방식이에요. 상품을 비교할 땐 금리뿐 아니라 이자 계산 방식과 기간도 살펴보세요.','https://www.fss.or.kr/'],
 ['통장 정리','내 통장끼리 옮긴 돈은 소비가 아니에요.','내 계좌 사이의 이동은 전체 자산을 바꾸지 않아요. 가계부에서 내부 이체로 구분하면 지출이 부풀려지는 일을 줄일 수 있어요.','https://www.fss.or.kr/'],
 ['예적금','표시 금리보다 실제 조건을 살펴봐요.','우대금리는 조건을 충족해야 적용돼요. 기본 금리, 내가 받을 수 있는 우대 조건, 중도해지 시 금리를 함께 확인하세요.','https://finlife.fss.or.kr/'],
 ['안전한 금융','예금자보호 여부도 상품마다 확인해요.','같은 금융회사에서 판매하더라도 모든 상품이 예금자보호 대상인 것은 아니에요. 가입 전 상품 설명서와 예금보험공사의 최신 안내를 확인하세요.','https://www.kdic.or.kr/'],
 ['금융사기 예방','송금을 재촉할수록, 잠깐 멈춰봐요.','가족이나 지인을 사칭해 급하게 송금을 요구한다면 기존에 알고 있던 연락처로 직접 확인하세요. 메시지 속 링크나 연락처만 믿지 않는 게 좋아요.','https://www.fss.or.kr/'],
 ['나의 소비','고정비와 변동비를 나눠보세요.','월세처럼 정기적으로 나가는 돈과 식비처럼 달라지는 돈을 구분하면 계획을 세우기 쉬워요. 이미 낸 고정비를 남은 예산에서 또 빼지 않도록 주의하세요.','https://www.fss.or.kr/']
];
function tipIndex() { return Math.floor(Date.parse(todayISO() + 'T00:00:00Z') / 86400000) % tips.length; }
function render() {
  const s = current(), v = summarize(s), { period, budget, spent, remaining, available, unpaidFixed, percent } = v;
  $('#today-label').textContent = new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(new Date());
  $('#period-label').textContent = `${shortDate(period.start)} — ${shortDate(period.end)}`;
  $('#ring-caption').textContent = budget === null ? '이번 기간 쓴 돈' : '예산 사용률';
  $('#ring-value').textContent = budget === null ? money(spent) : `${percent}%`;
  $('#ring-detail').textContent = budget === null ? '차곡차곡 알아가는 중' : percent > 100 ? `${money(spent - budget)} 초과` : '나의 속도로 차근차근';
  $('#ring-progress').style.strokeDashoffset = budget === null ? 0 : 100 - Math.min(100, spent / budget * 100);
  $('#ring-progress').style.stroke = percent > 100 ? '#da9675' : '#f5d46e';
  $('.ring-button').setAttribute('aria-label', budget === null ? `이번 기간 지출 ${money(spent)}, 예산 정하기` : `예산 ${percent}% 사용, 예산 확인 및 수정`);
  $('#remaining-label').textContent = budget === null ? '이번 기간 쓴 돈' : remaining < 0 ? '예산보다 더 쓴 돈' : '남은 예산';
  $('#remaining-value').textContent = money(budget === null ? spent : Math.abs(remaining));
  $('#days-left').textContent = `${period.daysLeft}일 남았어요`;
  $('#total-budget').textContent = budget === null ? '아직 정하지 않았어요' : money(budget);
  $('#spent').textContent = money(spent); $('#remaining').textContent = budget === null ? '—' : money(remaining);
  $('#budget-action').textContent = budget === null ? '예산 정하기 ↗' : '예산 조정하기 ↗';
  $('#pace-text').textContent = budget === null ? '예산이 없어도 괜찮아요. 작은 기록부터 시작해봐요.' : `기간은 ${Math.round(period.elapsed / period.days * 100)}% 지났고, 예산은 ${percent}% 사용했어요.`;
  $('#available-intro').textContent = budget === null ? '예산을 정하면 여기서 알려드릴게요.' : available < 0 ? '예정된 고정비까지 고려하면 부족해요.' : '아직 나갈 고정비를 미리 빼두었어요.';
  $('#available-value').textContent = available === null ? '얼마나 남을까요?' : available < 0 ? `${money(Math.abs(available))} 부족` : money(available);
  $('#math-remaining').textContent = remaining === null ? '—' : money(remaining); $('#math-fixed').textContent = money(unpaidFixed);
  $('#gentle-copy').innerHTML = spent > 0 ? '오늘도 나를 위한 기록을 남겼네요.<br>완벽하게 쓰기보다, 꾸준히 알아가요.' : '카테고리는 나중에 고쳐도 돼요.<br>금액과 사용처만 가볍게 남겨보세요.';
  const tip = tips[tipIndex()]; $('#tip-category').textContent = tip[0]; $('#tip-title').textContent = tip[1]; $('#tip-body').textContent = tip[2]; $('#tip-source').href = tip[3];
  const bookmarked = s.bookmarks.includes(tipIndex()); $('#bookmark-tip').setAttribute('aria-pressed', String(bookmarked)); $('#bookmark-tip').setAttribute('aria-label', bookmarked ? '오늘의 금융 상식 저장 해제' : '오늘의 금융 상식 저장'); $('#bookmark-tip svg').style.fill = bookmarked ? '#f8df83' : 'none';
  $('#demo-banner').hidden = !demo;
  historyUI.render();
  reviewUI.render();
  renderUndo();
  sheetUI?.render();
  authGate?.status();
  if($('#record-dialog').open)refreshCategory();
}
function openDialog(name, trigger, entry = null) {
  $(`#${name}-dialog`).returnFocus = trigger;
  if (name === 'record') {
    liveAI.cancel();recordVersion++;$('#record-form [type=submit]').disabled=false;
    pendingCategory=null;declinedSuggestionKey=null;
    recordReturnDate = null; editingEntry = entry ? structuredClone(entry) : null;
    $('#record-title').textContent = entry ? '기록을 다듬어요' : '오늘의 작은 기록';
    $('#record-dialog .dialog-description').textContent = entry ? '바뀐 내용은 달력과 예산에 함께 반영돼요.' : '카테고리 고민 없이, 쓴 만큼만 남겨요.';
    $('#record-form [type=submit]').textContent = entry ? '수정 저장하기' : '기록 저장하기';
    $('#delete-record').hidden = !entry; $('#delete-confirm').hidden = true;
    categoryMode=entry?'existing':'auto';pendingForgetKey=null;
    const form = $('#record-form'); form.reset(); form.elements.date.value = todayISO();
    const select = form.elements.fixedId; select.replaceChildren(new Option('아니요', ''));
    current().fixedCosts.forEach(f => select.add(new Option(`${f.name} · ${money(f.amount)}`, f.id)));
    if (entry?.fixedId && !current().fixedCosts.some(cost => cost.id === entry.fixedId)) select.add(new Option('이전에 연결한 고정비 · 현재 목록 없음', entry.fixedId));
    if (entry) for (const field of ['type', 'amount', 'date', 'merchant', 'description', 'reason', 'category', 'fixedId']) form.elements[field].value = entry[field] ?? '';
    updateRecordFields();
  }
  if (name === 'budget') {
    const v = summarize(current()); $('#budget-form').elements.budget.value = v.budget ?? '';
    $('#budget-period').textContent = `${v.period.start} ~ ${v.period.end} · 전체 예산부터 가볍게 정해요.`;
    $('#fixed-rows').replaceChildren(); current().fixedCosts.forEach(addFixedRow);
  }
  if (name === 'settings') {
    if(authGate?.mode==='legacy')void sheetUI?.prepare();
    $('#settings-form').elements.periodMode.value = current().settings.periodMode;
    $('#settings-form').elements.payday.value = current().settings.payday;
    $('#payday-label').hidden = current().settings.periodMode !== 'payday';
  }
  const dialog = $(`#${name}-dialog`); const error = dialog.querySelector('.form-error'); if (error) error.textContent = '';
  dialog.showModal();
  if(name==='record')refreshCategory();
}
document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openDialog(b.dataset.open, b)));
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
  dialog.addEventListener('close', () => {
    if(dialog.id==='record-dialog'){liveAI.cancel();recordVersion++;}
    if (dialog.id === 'record-dialog' && recordReturnDate && activeView === 'history') {
      const date = recordReturnDate; recordReturnDate = null; historyUI.showDay(date); return;
    }
    if (!document.querySelector('dialog[open]')) dialog.returnFocus?.focus();
  });
});
function navigate(view, focus = false) {
  activeView = ['history','review'].includes(view) ? view : 'home';
  for(const name of ['home','history','review'])$(`#${name}-view`).hidden=activeView!==name;
  $('.mobile-record').hidden=activeView==='review';
  const title={home:'홈',history:'내역',review:'돌아보기'}[activeView];
  $('.breadcrumb strong').textContent=title;document.title=`${title} — Dear Wallet`;
  document.querySelectorAll('[data-nav]').forEach(button => {
    const selected = button.dataset.nav === activeView;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  historyUI.render();
  reviewUI.render();
  if (focus) {
    window.scrollTo({top:0, behavior:'instant'});
    const heading = document.querySelector(activeView === 'home' ? '#home-view h1' : `#${activeView}-title`);
    heading.tabIndex = -1; heading.focus({preventScroll:true});
  }
}
document.querySelectorAll('[data-nav]').forEach(button => button.addEventListener('click', () => {
  const view = button.dataset.nav;
  if (location.hash !== `#${view}`) location.hash = view; else navigate(view, true);
}));
window.addEventListener('hashchange', () => navigate(location.hash.slice(1), true));
$('#record-form').addEventListener('submit', async e => {
  e.preventDefault(); const form=e.currentTarget,button=form.querySelector('[type=submit]');
  if(button.disabled)return;
  if(shouldUseAI()){
    const version=recordVersion,key=aiKey(recordAIInput());button.disabled=true;
    try{await liveAI.flush();}finally{if(version===recordVersion)button.disabled=false;}
    if(version!==recordVersion || !$('#record-dialog').open)return;
    if(!shouldUseAI() || aiKey(recordAIInput())!==key){form.querySelector('.form-error').textContent='입력 내용이 바뀌었어요. 확인한 뒤 다시 저장해주세요.';return;}
  }
  const data = new FormData(form); const amount = Number(data.get('amount')), date = data.get('date'), merchant = data.get('merchant').trim(), type = data.get('type');
  const error = form.querySelector('.form-error');
  if (!validAmount(amount) || !validDate(date) || !merchant) { error.textContent = '금액, 날짜와 사용처를 확인해주세요.'; return; }
  if (date > todayISO()) { error.textContent = '미래의 거래는 아직 기록할 수 없어요. 예정 지출은 고정비로 등록해주세요.'; return; }
  const next = structuredClone(current());
  const index = editingEntry ? next.entries.findIndex(entry => entry.id === editingEntry.id) : -1;
  if (editingEntry && (index < 0 || next.entries[index].deletedAt || !sameEntry(next.entries[index],editingEntry))) {
    error.textContent = '이 기록이 다른 창에서 변경됐어요. 닫고 다시 열어 최신 내용을 확인해주세요.'; return;
  }
  const prediction=categoryPrediction();
  if(currentSuggestion()){error.textContent='새 카테고리를 추가할지 먼저 선택해주세요.';$('#accept-category-suggestion').focus();return;}
  let category = type === 'transfer' ? '내부 이체' : categoryMode==='auto'?prediction.category:data.get('category').trim() || (type === 'expense' ? '미분류' : '기타 수입');
  if(pendingCategory?.type===type && pendingCategory.name===category){
    const existing=categoryOptions(type,next.settings.customCategories).find(name=>categoryIdentity(name)===categoryIdentity(category));
    if(existing)category=existing;
    else{try{const added={...pendingCategory,updatedAt:new Date().toISOString()};setCustomCategory(next,customCategoryKey(added),added);}catch(problem){error.textContent=problem.message;return;}}
  }
  const categorySource=type==='transfer'?'transfer':categoryMode==='auto'?prediction.source:categoryMode==='existing'?(editingEntry.categorySource || (['미분류','기타 수입'].includes(category)?'unclassified':'manual')):'manual';
  if(pendingForgetKey)setRule(next,pendingForgetKey,null);
  const remember=type!=='transfer' && categoryMode==='manual' && data.has('rememberCategory') && merchantKey(merchant) && merchantKey(merchant).length<=200;
  if(remember){const rule={type,merchantKey:merchantKey(merchant),merchantLabel:merchant,category,updatedAt:new Date().toISOString()};setRule(next,ruleKey(rule),rule);}
  const entry = { ...(editingEntry || {}), id:editingEntry?.id || newId(), amount, date, merchant, type, description:data.get('description').trim(), reason:data.get('reason').trim(), categorySource, fixedId: type === 'expense' ? data.get('fixedId') || null : null, category, updatedAt:new Date().toISOString() };
  if (editingEntry) next.entries[index] = entry; else next.entries.push(entry);
  if (!persist(next)) { error.textContent = '저장하지 못했어요. 입력한 내용은 유지했으니 브라우저 저장 공간과 권한을 확인해주세요.'; return; }
  const wasEditing = !!editingEntry;
  if (recordReturnDate) recordReturnDate = date;
  $('#record-dialog').close(); render();
  const p = summarize(next).period;
  toast(remember?`${category}로 기록하고, 다음에도 같은 사용처를 기억할게요.`:wasEditing ? '수정했어요. 달력과 예산에도 반영했어요.' : date < p.start || date > p.end ? '저장했어요. 현재 집계 기간 밖의 기록이에요.' : type === 'transfer' ? '내 계좌 간 이체로 저장했어요. 소비 합계에는 포함하지 않아요.' : type === 'expense' ? `${category}로 기록했어요.${category==='미분류'?' 분류는 나중에 바꿔도 돼요.':''}` : `${category}로 수입을 기록했어요. 지출 합계에는 포함하지 않아요.`);
});
function updateRecordFields() {
  const form = $('#record-form'), type = form.elements.type.value;
  $('#record-type-help').textContent=type==='transfer'?'내 계좌 간 이체는 소비·수입 합계에서 제외해요.':type==='income'?'수입은 지출 합계에 포함하지 않아요.':'다른 사람에게 보낸 돈도 지출에 포함해요.';
  const expense = type === 'expense';
  $('#fixed-link-label').hidden = !expense || (!current().fixedCosts.length && !editingEntry?.fixedId);
  $('#category-label').hidden = type === 'transfer';
  refreshCategory();
}
$('#record-form').elements.type.addEventListener('change', () => {
  pendingCategory=null;declinedSuggestionKey=null;
  const form = $('#record-form'), type = form.elements.type.value;
  form.elements.category.value = editingEntry?.type === type ? editingEntry.category || '' : '';
  categoryMode=editingEntry?.type===type?'existing':'auto';pendingForgetKey=null;form.elements.rememberCategory.checked=false;
  updateRecordFields();
});
function categoryPrediction(){
  const form=$('#record-form');
  const rules=(current().settings.categoryRules || []).filter(rule=>ruleKey(rule)!==pendingForgetKey);
  const local=classify({merchant:form.elements.merchant.value,description:form.elements.description.value,type:form.elements.type.value,rules});
  if(shouldUseAI(local) && liveAI.state.status==='ready' && liveAI.state.key===aiKey(recordAIInput()))return liveAI.state.result;
  return local;
}
function recordAIInput(){const form=$('#record-form'),type=form.elements.type.value,customCategories=(current().settings.customCategories || []).filter(category=>category.type===type).map(category=>category.name);return {merchant:form.elements.merchant.value,description:form.elements.description.value,type,...(customCategories.length?{customCategories}:{})};}
function shouldUseAI(local){
  const input=recordAIInput();
  const saved=findRule(current(),input.merchant,input.type);
  return !!(authGate?.aiAvailable && categoryMode==='auto' && input.type!=='transfer' && input.merchant.trim() && input.merchant.length<=80 && input.description.length<=200 && local?.source!=='merchant-rule' && (!saved || ruleKey(saved)===pendingForgetKey));
}
function syncAI(){
  const type=$('#record-form').elements.type.value,available=!!authGate?.aiAvailable;
  $('#ai-category-disclosure').hidden=type==='transfer';
  $('#ai-category-disclosure').textContent=available?'AI가 자동으로 분류해요. 사용처·내용·카테고리 이름을 Google AI로 보내며 금액·계좌정보·지출 이유는 보내지 않아요.':'AI 자동 분류는 Google 로그인 후 사용할 수 있어요.';
  if(shouldUseAI() && $('#record-dialog').open)liveAI.schedule(recordAIInput());else liveAI.cancel();
}
function refreshCategory(){
  syncAI();
  const form=$('#record-form'),type=form.elements.type.value,prediction=categoryPrediction();
  $('#category-options').replaceChildren(...categoryOptions(type,current().settings.customCategories).map(value=>new Option(value,value)));
  if(categoryMode==='auto')form.elements.category.value=prediction.category;
  const saved=findRule(current(),form.elements.merchant.value,type);
  $('#category-feedback').hidden=type==='transfer';
  const usingAI=shouldUseAI(prediction),pending=usingAI && ['waiting','loading'].includes(liveAI.state.status);
  $('#category-mode-badge').textContent=categoryMode==='manual'?'직접 선택':categoryMode==='existing'?'저장된 분류':prediction.source==='merchant-rule'?'기억한 분류':prediction.source==='ai'?'AI':usingAI?'임시 분류':'자동';
  $('#category-help').textContent=pendingForgetKey?'저장하면 이 사용처의 기억을 해제해요.':categoryMode==='manual'?'내가 고른 분류로 저장해요.':categoryMode==='existing'?'저장된 분류를 유지해요. 필요하면 자동 분류를 다시 볼 수 있어요.':prediction.message;
  if(pending)$('#category-help').textContent=liveAI.state.status==='waiting'?'입력을 마치면 AI가 사용처와 내용을 읽고 분류해요.':'AI가 사용처와 내용을 살펴보고 있어요…';
  else if(usingAI && liveAI.state.status==='error')$('#category-help').textContent=liveAI.state.error;
  if(pendingCategory?.type===type && pendingCategory.name===form.elements.category.value){$('#category-mode-badge').textContent='추가 예정';$('#category-help').textContent=`‘${pendingCategory.name}’ 카테고리를 기록과 함께 저장해요.`;}
  const suggestion=currentSuggestion();$('#category-suggestion').hidden=!suggestion;
  if(suggestion){$('#category-suggestion-title').textContent=`‘${suggestion.suggestedCategory}’ 카테고리를 추가할까요?`;$('#category-suggestion-reason').textContent=suggestion.suggestionReason || '이 지출에 더 잘 맞는 분류를 추천했어요.';}
  $('#ai-category-retry').hidden=!usingAI || liveAI.state.status!=='error';
  $('#auto-category-reset').hidden=type==='transfer' || categoryMode==='auto';
  $('#forget-category-rule').hidden=!saved || !!pendingForgetKey || type==='transfer';
  const key=merchantKey(form.elements.merchant.value);
  $('#remember-category-panel').hidden=type==='transfer' || categoryMode!=='manual' || !key || key.length>200;
  $('#remember-category-label').textContent=`이 사용처는 다음에도 ‘${form.elements.category.value.trim() || (type==='income'?'기타 수입':'미분류')}’로 기억하기`;
}
function currentSuggestion(){return shouldUseAI() && liveAI.state.status==='ready' && liveAI.state.key===aiKey(recordAIInput()) && declinedSuggestionKey!==liveAI.state.key && liveAI.state.result?.suggestedCategory?liveAI.state.result:null;}
$('#accept-category-suggestion').addEventListener('click',()=>{
  const suggestion=currentSuggestion();if(!suggestion)return;
  const type=$('#record-form').elements.type.value;
  const existing=categoryOptions(type,current().settings.customCategories).find(name=>categoryIdentity(name)===categoryIdentity(suggestion.suggestedCategory));
  pendingCategory=existing?null:{type,name:suggestion.suggestedCategory};
  categoryMode='manual';$('#record-form').elements.category.value=existing || suggestion.suggestedCategory;$('#record-form .form-error').textContent='';refreshCategory();
});
$('#decline-category-suggestion').addEventListener('click',()=>{declinedSuggestionKey=liveAI.state.key;$('#record-form .form-error').textContent='';refreshCategory();});
$('#ai-category-retry').addEventListener('click',()=>{if(shouldUseAI()){liveAI.schedule(recordAIInput(),{retry:true});refreshCategory();}});
for(const name of ['merchant','description'])$('#record-form').elements[name].addEventListener('input',()=>{
  const originalManual=editingEntry && (editingEntry.categorySource==='manual' || !editingEntry.categorySource && !['미분류','기타 수입',''].includes(editingEntry.category || ''));
  if(categoryMode==='existing')categoryMode=originalManual?'manual':'auto';
  if(name==='merchant'){$('#record-form').elements.rememberCategory.checked=false;pendingForgetKey=null;}
  refreshCategory();
});
$('#record-form').elements.category.addEventListener('input',()=>{pendingCategory=null;categoryMode='manual';refreshCategory();});
$('#auto-category-reset').addEventListener('click',()=>{pendingCategory=null;declinedSuggestionKey=null;categoryMode='auto';$('#record-form').elements.rememberCategory.checked=false;refreshCategory();});
$('#forget-category-rule').addEventListener('click',()=>{const form=$('#record-form'),saved=findRule(current(),form.elements.merchant.value,form.elements.type.value);if(saved){pendingForgetKey=ruleKey(saved);categoryMode='auto';form.elements.rememberCategory.checked=false;refreshCategory();}});
$('#delete-record').addEventListener('click', () => { $('#delete-confirm').hidden = false; $('#cancel-delete').focus(); });
$('#cancel-delete').addEventListener('click', () => { $('#delete-confirm').hidden = true; $('#delete-record').focus(); });
$('#confirm-delete').addEventListener('click', () => {
  if (!editingEntry) return;
  const next = structuredClone(current()); const entry = next.entries.find(entry => entry.id === editingEntry.id);
  const error = $('#record-form .form-error');
  if (!entry || entry.deletedAt || !sameEntry(entry,editingEntry)) { error.textContent = '이 기록이 다른 창에서 변경됐어요. 닫고 다시 열어 최신 내용을 확인해주세요.'; return; }
  const deletedAt = new Date().toISOString(); entry.deletedAt = deletedAt; entry.updatedAt = deletedAt;
  if (!persist(next)) { error.textContent = '삭제하지 못했어요. 기존 기록은 유지했어요.'; return; }
  undoDeletion = { id:entry.id, deletedAt, merchant:entry.merchant, date:entry.date };
  $('#record-dialog').close(); render(); toast('기록을 삭제했어요. 실행 취소로 되돌릴 수 있어요.');
});
function renderUndo() {
  if (undoDeletion && !current().entries.some(entry => entry.id === undoDeletion.id && entry.deletedAt === undoDeletion.deletedAt)) undoDeletion = null;
  document.querySelectorAll('[data-undo-notice]').forEach(notice => {
    notice.hidden = !undoDeletion;
    if (undoDeletion) notice.querySelector('span').textContent = `‘${undoDeletion.merchant}’ 기록을 삭제했어요.`;
  });
}
document.querySelectorAll('[data-undo]').forEach(button => button.addEventListener('click', () => {
  if (!undoDeletion) return;
  const next = structuredClone(current()); const entry = next.entries.find(entry => entry.id === undoDeletion.id && entry.deletedAt === undoDeletion.deletedAt);
  if (!entry) { undoDeletion = null; render(); toast('이미 변경된 기록이라 복원하지 않았어요.'); return; }
  delete entry.deletedAt; entry.updatedAt = new Date().toISOString();
  if (!persist(next)) return;
  undoDeletion = null; render(); toast('기록을 되돌렸어요.');
}));
document.querySelectorAll('[data-dismiss-undo]').forEach(button => button.addEventListener('click', () => { undoDeletion = null; renderUndo(); }));
function addFixedRow(cost = {}) {
  const row = document.createElement('div'); row.className = 'fixed-row'; row.dataset.id = cost.id || newId();
  row.innerHTML = '<label>이름<input name="fixedName" maxlength="40" required placeholder="월세"></label><label>금액 (원)<input name="fixedAmount" type="number" inputmode="numeric" min="1" max="999999999999" step="1" required placeholder="400000"></label><label>매월 (일)<input name="fixedDay" type="number" inputmode="numeric" min="1" max="31" step="1" required placeholder="25"></label><button type="button" class="icon-button" aria-label="고정비 삭제">×</button>';
  row.querySelector('[name=fixedName]').value = cost.name || ''; row.querySelector('[name=fixedAmount]').value = cost.amount || ''; row.querySelector('[name=fixedDay]').value = cost.day || '';
  row.querySelector('button').addEventListener('click', () => row.remove()); $('#fixed-rows').append(row);
}
$('#add-fixed').addEventListener('click', () => { addFixedRow(); $('#fixed-rows').lastElementChild.querySelector('input').focus(); });
$('#budget-form').addEventListener('submit', e => {
  e.preventDefault(); const form = e.currentTarget, error = form.querySelector('.form-error');
  const raw = form.elements.budget.value, budget = raw === '' ? null : Number(raw);
  const costs = [...$('#fixed-rows').children].map(row => ({id:row.dataset.id,name:row.querySelector('[name=fixedName]').value.trim(),amount:Number(row.querySelector('[name=fixedAmount]').value),day:Number(row.querySelector('[name=fixedDay]').value)}));
  if ((budget !== null && !validAmount(budget)) || costs.some(c => !c.name || !validAmount(c.amount) || !Number.isInteger(c.day) || c.day < 1 || c.day > 31)) { error.textContent = '예산과 고정비의 이름·금액·날짜를 확인해주세요.'; return; }
  const next = structuredClone(current()), key = summarize(next).period.start; if (budget === null) delete next.budgets[key]; else next.budgets[key] = budget; next.fixedCosts = costs;
  if (!persist(next)) return; $('#budget-dialog').close(); render(); toast('계획을 저장했어요. 나에게 맞는 속도로 시작해요.');
});
for(let i=1;i<=31;i++) $('#settings-form').elements.payday.add(new Option(`매월 ${i}일`,i));
$('#settings-form').elements.periodMode.addEventListener('change', e => { $('#payday-label').hidden = e.target.value !== 'payday'; });
$('#settings-form').addEventListener('submit', e => { e.preventDefault(); const next = structuredClone(current()); next.settings = { ...next.settings, periodMode:e.currentTarget.elements.periodMode.value, payday:Number(e.currentTarget.elements.payday.value) }; if (!persist(next)) return; $('#settings-dialog').close(); render(); toast('한 달의 기준을 저장했어요.'); });
function startDemo() {
  reviewUI.reset();
  sheetUI?.sync.cancelTimer(); undoDeletion = null; demo = emptyState(); demo.settings = {periodMode:'payday',payday:25}; const p = getPeriod(todayISO(),'payday',25); demo.budgets[p.start] = 1000000;
  demo.fixedCosts = [{id:'sample-fixed',name:'관리비',amount:100000,day:20}]; demo.entries = [{id:'sample',amount:620000,date:todayISO(),merchant:'예시 누적 지출',reason:'홈 둘러보기용 데이터',type:'expense',fixedId:null}]; $('#settings-dialog').close(); render(); toast('샘플 모드예요. 여기서 한 변경은 내 기록에 저장되지 않아요.');
}
$('#start-demo').addEventListener('click',()=>authGate.enterDemo());
$('#exit-demo').addEventListener('click',()=>{undoDeletion=null;demo=null;authGate.exitDemo();render();});
$('#bookmark-tip').addEventListener('click', () => { const next = structuredClone(current()), id=tipIndex(); next.bookmarks = next.bookmarks.includes(id) ? next.bookmarks.filter(b=>b!==id) : [...next.bookmarks,id]; if (persist(next)) { render(); toast(next.bookmarks.includes(id) ? '상식을 저장했어요. 기록 파일에도 함께 보관돼요.' : '상식 저장을 해제했어요.'); } });
$('#export-data').addEventListener('click', () => { const blob = new Blob([JSON.stringify(current(), null, 2)],{type:'application/json'}); const url=URL.createObjectURL(blob), link=document.createElement('a'); link.href=url; link.download=`dear-wallet-${todayISO()}${demo?'-sample':''}.json`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); toast('기록 파일을 내려받았어요. 현재 앱에는 파일 복원 기능이 없어요.'); });
window.addEventListener('storage', e => { if (e.key !== KEY || demo || authGate?.mode!=='legacy') return; const loaded=e.newValue === null ? emptyState() : parseState(e.newValue); if (loaded) {state=loaded; render();} else {storageBlocked=true; toast('다른 창의 데이터를 확인할 수 없어 저장을 중지했어요.');} });
let lastDay=todayISO(); setInterval(()=>{if(todayISO()!==lastDay){lastDay=todayISO();render();}},60000);
sheetUI = mountSheetSync({getLocal:()=>state,isDemo:()=>!!demo || authGate?.mode!=='legacy',isLocalReady:()=>!storageBlocked,applyLocal:next=>{
  if(storageBlocked || !parseState(JSON.stringify(next))) throw new Error('브라우저 저장 공간이나 기존 데이터를 확인해주세요. 시트 내용은 덮어쓰지 않았어요.');
  localStorage.setItem(KEY,JSON.stringify(next)); state=next;
},onApplied:render,onToast:toast});
if(cacheMissing && sheetUI.sync.meta && !storageBlocked){try{state=structuredClone(sheetUI.sync.meta.baseline);localStorage.setItem(KEY,JSON.stringify(state));}catch{storageBlocked=true;}}
navigate(location.hash.slice(1));
render(); if (storageBlocked) toast('브라우저 저장 공간이나 기존 데이터를 확인해주세요. 기록을 덮어쓰지 않도록 저장을 중지했어요.');

function clearSessionView(){
  reviewUI.reset();
  liveAI.cancel();recordVersion++;pendingCategory=null;declinedSuggestionKey=null;
  sheetUI?.sync.cancelTimer();activeAccount=null;demo=null;undoDeletion=null;recordReturnDate=null;editingEntry=null;legacyImport=null;activeView='home';state=emptyState();$('#account-import-preview').hidden=true;
  document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());render();
}
function openLegacy(){
  reviewUI.reset();
  sheetUI?.sync.cancelTimer();activeAccount=null;demo=null;undoDeletion=null;
  try{const raw=localStorage.getItem(KEY);state=raw?parseState(raw):emptyState();if(!state){storageBlocked=true;state=emptyState();}}
  catch{storageBlocked=true;state=emptyState();}
  render();
}
let authStorage;try{authStorage=localStorage;}catch{authStorage={getItem:()=>null,setItem:()=>{throw new Error('브라우저 저장 권한을 확인해주세요.');}};}
authGate=mountAuthGate({storage:authStorage,onAccount:(next,store)=>{activeAccount=store;state=structuredClone(next);if(authGate?.mode!=='demo')demo=null;render();},onClear:clearSessionView,onDemo:startDemo,onLegacy:openLegacy,onHome:()=>{const view=['home','history','review'].includes(location.hash.slice(1))?location.hash.slice(1):'home';navigate(view);if(location.hash!==`#${view}`)location.hash=view;render();}});
render();

$('#account-import-local').addEventListener('click',()=>{
  try{
    const raw=localStorage.getItem(KEY);legacyImport=raw?parseState(raw):emptyState();
    if(!legacyImport)throw new Error('기존 기록을 확인하지 못했어요. 원본은 그대로 보관했어요.');
    $('#account-import-description').textContent=`이 기기의 기존 기록 ${legacyImport.entries.filter(entry=>!entry.deletedAt).length}건을 계정에 합칠까요? 같은 ID와 기간 예산은 계정의 값을 유지해요.`;
    $('#account-import-preview').hidden=false;
  }catch(error){toast(error.message);}
});
$('#account-import-cancel').addEventListener('click',()=>{$('#account-import-preview').hidden=true;legacyImport=null;});
$('#account-import-confirm').addEventListener('click',()=>{
  if(authGate.mode!=='account' || !activeAccount || !legacyImport)return;
  try{activeAccount.save(mergeForConnection(activeAccount.local,legacyImport));$('#account-import-preview').hidden=true;legacyImport=null;toast('기존 기록을 합쳤어요. 원본도 이 기기에 유지해요.');}catch(error){toast(error.message);}
});
