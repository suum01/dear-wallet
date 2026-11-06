import { ruleKey, setRule } from './category-rules.js';
import { emptyState, parseState, validDate, validAmount } from './domain.js';

export const TABLES = {
  entries: { title:'거래내역', headers:['거래ID','거래일','종류','금액','사용처','카테고리','지출이유','고정비ID','수정시각','삭제시각','내용','분류방식'] },
  budgets: { title:'기간별예산', headers:['기간시작일','예산','수정시각','삭제시각'] },
  allocations: { title:'예산배분', headers:['예산ID','카테고리ID','금액'] },
  fixedCosts: { title:'고정비', headers:['고정비ID','이름','예상금액','매월예정일','수정시각','삭제시각'] },
  categories: { title:'카테고리', headers:['카테고리ID','종류','이름','사용여부'] },
  settings: { title:'설정', headers:['항목','값','수정시각'] }
};
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])) : value;
const SAME = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const clone = value => structuredClone(value);
const timestamp = value => value === '' || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
const defaultCategories = [
  ['expense-food','지출','식비','사용'],['expense-cafe','지출','카페','사용'],['expense-transport','지출','교통','사용'],['expense-home','지출','주거','사용'],['expense-household','지출','생활용품','사용'],['expense-shopping','지출','쇼핑','사용'],['expense-health','지출','의료','사용'],['expense-culture','지출','문화','사용'],['expense-other','지출','기타','사용'],['income-salary','수입','급여','사용'],['income-extra','수입','부수입','사용'],['income-allowance','수입','용돈','사용'],['income-other','수입','기타 수입','사용']
];
export function spreadsheetId(value) {
  const text = String(value).trim();
  if (/^[A-Za-z0-9_-]{20,}$/.test(text)) return text;
  try { const url = new URL(text); const match = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/); return url.hostname === 'docs.google.com' && match ? match[1] : null; } catch { return null; }
}

// Only changed IDs/keys are appended. Row order resolves concurrent edits to the
// same ID; independent additions from two devices are never replaced wholesale.
export function stateDiff(base, next) {
  const patches = [];
  for (const entry of next.entries) {
    if (!SAME(base.entries.find(e => e.id === entry.id), entry)) patches.push({table:'entries', key:entry.id, value:clone(entry)});
  }
  for (const key of new Set([...Object.keys(base.budgets), ...Object.keys(next.budgets)])) if (base.budgets[key] !== next.budgets[key]) patches.push({table:'budgets',key,value:next.budgets[key] ?? null});
  for (const key of new Set([...base.fixedCosts.map(f => f.id), ...next.fixedCosts.map(f => f.id)])) {
    const previous = base.fixedCosts.find(f => f.id === key), value = next.fixedCosts.find(f => f.id === key);
    if (!SAME(previous,value)) patches.push({table:'fixedCosts',key,value:value ? clone(value) : null});
  }
  for (const key of ['periodMode','payday']) if (base.settings[key] !== next.settings[key]) patches.push({table:'settings',key,value:next.settings[key]});
  const beforeRules=base.settings.categoryRules || [],afterRules=next.settings.categoryRules || [];
  for(const key of new Set([...beforeRules.map(ruleKey),...afterRules.map(ruleKey)])){const previous=beforeRules.find(rule=>ruleKey(rule)===key),value=afterRules.find(rule=>ruleKey(rule)===key);if(!SAME(previous,value))patches.push({table:'settings',key,value:value?clone(value):null});}
  if (!SAME(base.bookmarks,next.bookmarks)) patches.push({table:'settings',key:'bookmarks',value:clone(next.bookmarks)});
  return patches;
}
export function applyPatches(base, patches) {
  const result = clone(base);
  for (const p of patches) {
    if (p.table === 'entries') {
      const index = result.entries.findIndex(e => e.id === p.key);
      if (index === -1) result.entries.push(clone(p.value)); else result.entries[index] = clone(p.value);
    } else if (p.table === 'budgets') { if (p.value === null) delete result.budgets[p.key]; else result.budgets[p.key] = p.value; }
    else if (p.table === 'fixedCosts') { result.fixedCosts = result.fixedCosts.filter(f => f.id !== p.key); if (p.value !== null) result.fixedCosts.push(clone(p.value)); }
    else if (p.table === 'settings') { if (p.key === 'bookmarks') result.bookmarks = clone(p.value); else if(p.key.startsWith('categoryRule:'))setRule(result,p.key,p.value);else result.settings[p.key] = p.value; }
  }
  return result;
}
// First connection is additive: matching IDs and period budgets already on the
// sheet win. Importing local data must never silently replace remote records.
export function mergeForConnection(remote, local) {
  const result = clone(remote);
  for (const entry of local.entries) if (!result.entries.some(e => e.id === entry.id)) result.entries.push(clone(entry));
  for (const [key,value] of Object.entries(local.budgets)) if (!(key in result.budgets)) result.budgets[key] = value;
  for (const cost of local.fixedCosts) if (!result.fixedCosts.some(f => f.id === cost.id)) result.fixedCosts.push(clone(cost));
  const rules=clone(remote.settings.categoryRules || []);for(const rule of local.settings.categoryRules || [])if(!rules.some(saved=>ruleKey(saved)===ruleKey(rule)))rules.push(clone(rule));if(rules.length)result.settings.categoryRules=rules;
  result.bookmarks = [...new Set([...remote.bookmarks,...local.bookmarks])];
  return result;
}
export function encodePatch(p, time) {
  if (p.table === 'entries') { const e = p.value; return [e.id,e.date,{expense:'지출',income:'수입',transfer:'내부이체'}[e.type],e.amount,e.merchant,e.category || '',e.reason,e.fixedId || '',e.updatedAt || time,e.deletedAt || '',e.description || '',e.categorySource || '']; }
  if (p.table === 'budgets') return [p.key,p.value ?? '',time,p.value === null ? time : ''];
  if (p.table === 'fixedCosts') { const f = p.value; return [p.key,f?.name || '',f?.amount ?? '',f?.day ?? '',time,f === null ? time : '']; }
  return [p.key,JSON.stringify(p.value),time];
}
export function decodeTables(tables) {
  const state = emptyState();
  const fail = title => { throw new Error(`‘${title}’ 탭의 열 또는 기록 형식이 달라요. 기존 내용은 바꾸지 않았어요. 시트를 확인해주세요.`); };
  for (const [key,table] of Object.entries(TABLES)) {
    const rows = tables[key] || [];
    if (!rows.length) continue;
    if (!SAME(rows[0],table.headers) && !(key==='entries' && SAME(rows[0],table.headers.slice(0,10)))) fail(table.title);
    for (const raw of rows.slice(1)) {
      if (!raw.some(value => value !== '' && value != null)) continue;
      if (raw.length > (key==='entries' && rows[0].length===10?10:table.headers.length)) fail(table.title);
      const row = Array.from({length:table.headers.length}, (_,i) => raw[i] ?? '');
      if (key === 'entries') {
        const [id,date,rawType,amount,merchant,category,reason,fixedId,updatedAt,deletedAt,description,categorySource] = row;
        const type = {지출:'expense',수입:'income',내부이체:'transfer'}[rawType] || rawType;
        if (typeof id !== 'string' || !id || !validDate(date) || !['expense','income','transfer'].includes(type) || !validAmount(amount) || typeof merchant !== 'string' || !merchant.trim() || [category,reason,fixedId].some(v => typeof v !== 'string') || !timestamp(updatedAt) || !timestamp(deletedAt)) fail(table.title);
        const entry = {id,date,type,amount,merchant,category,reason,fixedId:fixedId || null};
        if(description)entry.description=description;if(categorySource)entry.categorySource=categorySource;
        if (updatedAt) entry.updatedAt = updatedAt; if (deletedAt) entry.deletedAt = deletedAt;
        const index = state.entries.findIndex(e => e.id === id); if (index === -1) state.entries.push(entry); else state.entries[index] = entry;
      } else if (key === 'budgets') {
        const [date,amount,updatedAt,deletedAt] = row;
        if (!validDate(date) || !timestamp(updatedAt) || !timestamp(deletedAt) || (!deletedAt && !validAmount(amount))) fail(table.title);
        if (deletedAt) delete state.budgets[date]; else state.budgets[date] = amount;
      } else if (key === 'fixedCosts') {
        const [id,name,amount,day,updatedAt,deletedAt] = row;
        if (typeof id !== 'string' || !id || !timestamp(updatedAt) || !timestamp(deletedAt) || (!deletedAt && (typeof name !== 'string' || !name.trim() || !validAmount(amount) || !Number.isInteger(day) || day < 1 || day > 31))) fail(table.title);
        state.fixedCosts = state.fixedCosts.filter(f => f.id !== id); if (!deletedAt) state.fixedCosts.push({id,name,amount,day});
      } else if (key === 'settings') {
        const [name,encoded,updatedAt] = row;
        if (!timestamp(updatedAt)) fail(table.title);
        if (!['periodMode','payday','bookmarks'].includes(name) && !String(name).startsWith('categoryRule:')) continue;
        let value; try { value = JSON.parse(encoded); } catch { fail(table.title); }
        if (name === 'bookmarks') state.bookmarks = value;else if(name.startsWith('categoryRule:'))setRule(state,name,value);else state.settings[name] = value;
      }
    }
  }
  if (!parseState(JSON.stringify(state))) fail('설정');
  return state;
}

export class GoogleSheets {
  constructor({token,fetcher=fetch}) { this.getToken=token; this.fetcher=fetcher; }
  async request(id, suffix='', options={}) {
    const response = await this.fetcher.call(globalThis,`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}${suffix}`, { ...options, headers:{ Authorization:`Bearer ${this.getToken()}`, 'Content-Type':'application/json' }, signal:AbortSignal.timeout(25000) });
    if (!response.ok) {
      if (response.status === 401) { const error=new Error('구글 로그인이 만료됐어요. 다시 로그인해주세요.');error.status=401;throw error; }
      if (response.status === 403) throw new Error('시트 접근 권한이 없거나 Sheets API가 꺼져 있어요. 시트 소유 계정과 API 사용 설정을 확인해주세요.');
      if (response.status === 404) throw new Error('시트를 찾지 못했어요. 시트 주소와 로그인 계정을 확인해주세요.');
      if (response.status === 429) throw new Error('구글 요청이 잠시 많아요. 잠시 후 다시 동기화해주세요. 기록은 이 기기에 남아 있어요.');
      throw new Error('시트에 연결하지 못했어요. 기록은 이 기기에 남아 있어요. 다시 동기화해주세요.');
    }
    return response.json();
  }
  async read(id) {
    const meta = await this.request(id,'?fields=spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties))');
    const ranges = Object.entries(TABLES).filter(([,table])=>meta.sheets?.some(s=>s.properties.title===table.title));
    const tables = {};
    if (ranges.length) {
      const query = new URLSearchParams({valueRenderOption:'UNFORMATTED_VALUE', dateTimeRenderOption:'FORMATTED_STRING'});
      for (const [,table] of ranges) query.append('ranges',`'${table.title}'`);
      const result = await this.request(id,`/values:batchGet?${query}`);
      if (result.valueRanges?.length !== ranges.length) throw new Error('시트 응답을 확인하지 못했어요. 다시 시도해주세요.');
      ranges.forEach(([key],index)=>{tables[key]=result.valueRanges[index].values || [];});
    }
    return {id,title:meta.properties.title,sheets:meta.sheets || [],tables,state:decodeTables(tables)};
  }
  async write(snapshot, patches) {
    const requests = [], ids = {};
    let nextId = 1;const usedIds = new Set(snapshot.sheets.map(s=>s.properties.sheetId));
    const rowData = values => ({values:values.map(value=>({userEnteredValue:typeof value === 'number' ? {numberValue:value} : {stringValue:String(value)}}))});
    for (const [key,table] of Object.entries(TABLES)) {
      const existing = snapshot.sheets.find(s=>s.properties.title===table.title);
      while(usedIds.has(nextId))nextId++;
      ids[key] = existing?.properties.sheetId ?? nextId++; usedIds.add(ids[key]);
      if (!existing) requests.push({addSheet:{properties:{sheetId:ids[key],title:table.title,gridProperties:{frozenRowCount:1}}}});
      if(key==='entries' && SAME(snapshot.tables[key]?.[0],table.headers.slice(0,10)))requests.push({updateCells:{start:{sheetId:ids[key],rowIndex:0,columnIndex:10},rows:[rowData(table.headers.slice(10))],fields:'userEnteredValue'}});
      if (!(snapshot.tables[key] || []).length) {
        requests.push({updateCells:{start:{sheetId:ids[key],rowIndex:0,columnIndex:0},rows:[{values:table.headers.map(value=>({userEnteredValue:{stringValue:value},userEnteredFormat:{textFormat:{bold:true},backgroundColor:{red:0.98,green:0.93,blue:0.75}}}))}],fields:'userEnteredValue,userEnteredFormat'}});
        if (key === 'categories') requests.push({appendCells:{sheetId:ids[key],rows:defaultCategories.map(rowData),fields:'userEnteredValue'}});
      }
    }
    const time = new Date().toISOString();
    for (const key of ['entries','budgets','fixedCosts','settings']) {
      const rows = patches.filter(p=>p.table===key).map(p=>rowData(encodePatch(p,time)));
      if (rows.length) requests.push({appendCells:{sheetId:ids[key],rows,fields:'userEnteredValue'}});
    }
    if (requests.length) await this.request(snapshot.id,':batchUpdate',{method:'POST',body:JSON.stringify({requests})});
  }
}
