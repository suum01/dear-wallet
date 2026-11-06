import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/categorizer.js';
import { merchantKey, ruleKey, setRule } from '../src/category-rules.js';
import { emptyState, parseState, summarize } from '../src/domain.js';
import { stateDiff, applyPatches, decodeTables, encodePatch, TABLES, GoogleSheets } from '../src/sheets.js';
import { AccountStore } from '../src/account-store.js';
const TIME='2026-11-06T12:00:00Z';
const learned=(merchant,category,type='expense')=>({merchantKey:merchantKey(merchant),merchantLabel:merchant,category,type,updatedAt:TIME});
const input=(merchant,description='',type='expense')=>({merchant,description,type});
for(const [merchant,description,category] of [
 ['스타벅스 강남점','','카페'],['STARBUCKS GANGNAM','','카페'],['김밥천국','','식비'],['메가 커피','','카페'],['CU 강남점','삼각김밥과 우유','식비'],['CU 강남점','치약과 세제','생활용품'],['쿠팡','휴지','생활용품'],['쿠팡','운동화','쇼핑'],['쿠팡','생수','식비'],['카카오T','','교통'],['서울병원','주차비','교통'],['서울의원','감기 진료','의료'],['교보문고','','교육'],['스타벅스','커피머신 구입','쇼핑'],['모르는 곳','월세','주거'],['모르는 곳','휴대폰 요금','통신'],['모르는 곳','친구 결혼식 축의금','경조사'],['CGV 강남','','문화'],['친구에게 송금','저녁 식사 정산','식비']
])test(`categorize ${merchant} / ${description || '(no content)'} as ${category}`,()=>assert.equal(classify(input(merchant,description)).category,category));
for(const merchant of ['CU','GS25','쿠팡','다이소','네이버쇼핑','모르는 가게','culture club'])test(`do not guess from ambiguous merchant ${merchant}`,()=>assert.equal(classify(input(merchant)).category,'미분류'));
test('mixed-purpose purchases remain unclassified, including specific products',()=>{
 assert.equal(classify(input('이마트','우유랑 샴푸')).category,'미분류');assert.equal(classify(input('쿠팡','커피머신과 치약')).category,'미분류');
});
test('income and internal transfers respect the explicitly selected transaction type',()=>{
 assert.equal(classify(input('회사','11월 급여','income')).category,'급여');assert.equal(classify(input('은행','이자','income')).category,'이자');assert.equal(classify(input('부모님','용돈','income')).category,'용돈');assert.equal(classify(input('의뢰인','외주 원고료','income')).category,'부수입');assert.equal(classify(input('스타벅스','','transfer')).category,'내부 이체');assert.equal(classify(input('이자카야 환불','','income')).category,'기타 수입');
});
test('personal merchant rules override keywords only for the same normalized merchant and type',()=>{
 const rules=[learned('CU 강남점','생활용품')];const result=classify({...input('ＣＵ 강남점','김밥'),rules});assert.equal(result.category,'생활용품');assert.equal(result.source,'merchant-rule');assert.equal(classify({...input('CU 역삼점','김밥'),rules}).category,'식비');assert.equal(classify({...input('CU 강남점','','income'),rules}).category,'기타 수입');assert.equal(merchantKey('(주) 스타벅스 강남점'),'스타벅스강남점');
});
test('personal rules are validated, and existing saved records remain unchanged',()=>{
 const state=emptyState();state.entries=[{id:'old',date:'2026-11-06',type:'expense',amount:1000,merchant:'스타벅스',category:'기타',reason:'',fixedId:null}];
 const rule=learned('스타벅스','카페');setRule(state,ruleKey(rule),rule);assert.equal(state.entries[0].category,'기타');assert.ok(parseState(JSON.stringify(state)));state.settings.categoryRules[0].category='';assert.equal(parseState(JSON.stringify(state)),null);
});
test('rules are separate settings patches and can be removed without new Firestore permissions',()=>{
 const before=emptyState(),a=structuredClone(before),b=structuredClone(before);const first=learned('CU','생활용품'),second=learned('쿠팡','쇼핑');setRule(a,ruleKey(first),first);setRule(b,ruleKey(second),second);
 const merged=applyPatches(applyPatches(before,stateDiff(before,a)),stateDiff(before,b));assert.equal(merged.settings.categoryRules.length,2);const removed=structuredClone(merged);setRule(removed,ruleKey(first),null);const diff=stateDiff(merged,removed);assert.equal(diff.length,1);assert.equal(diff[0].table,'settings');assert.equal(diff[0].value,null);assert.equal(applyPatches(merged,diff).settings.categoryRules[0].merchantKey,second.merchantKey);
});
test('description and source roundtrip through Sheets while legacy ten-column data still reads',()=>{
 const state=emptyState();state.entries=[{id:'new',date:'2026-11-06',type:'expense',amount:1000,merchant:'CU',description:'치약',category:'생활용품',categorySource:'keyword',reason:'여행 준비',fixedId:null}];const rule=learned('CU','생활용품');setRule(state,ruleKey(rule),rule);
 const tables={entries:[TABLES.entries.headers],settings:[TABLES.settings.headers]};for(const p of stateDiff(emptyState(),state))tables[p.table].push(encodePatch(p,TIME));const read=decodeTables(tables);assert.equal(read.entries[0].description,'치약');assert.equal(read.entries[0].reason,'여행 준비');assert.equal(read.entries[0].categorySource,'keyword');assert.equal(read.settings.categoryRules[0].category,'생활용품');
 const legacy=decodeTables({entries:[TABLES.entries.headers.slice(0,10),['old','2026-11-06','지출',1000,'김밥천국','식비','','',TIME,'']]});assert.equal(legacy.entries[0].category,'식비');assert.equal(legacy.entries[0].description,undefined);
});
test('legacy Sheets headers are extended only in the new columns',async()=>{
 let requests;const sheets=new GoogleSheets({token:()=> 'test',fetcher:async(url,options)=>{requests=JSON.parse(options.body).requests;return {ok:true,json:async()=>({})};}});
 await sheets.write({id:'sheet',sheets:[{properties:{sheetId:1,title:'거래내역'}}],tables:{entries:[TABLES.entries.headers.slice(0,10)]}},[]);
 const update=requests.find(r=>r.updateCells?.start.sheetId===1);assert.equal(update.updateCells.start.columnIndex,10);assert.equal(update.updateCells.rows[0].values[0].userEnteredValue.stringValue,'내용');assert.ok(requests.every(r=>!r.deleteSheet && !r.deleteRange));
});
test('same account on two devices shares remembered rules and financial totals stay the same',async()=>{
 let remote=emptyState();const provider={async read(){return {state:structuredClone(remote),onboardingComplete:true};},async write(uid,patches){remote=applyPatches(remote,patches);}};
 const storage=()=>{const map=new Map();return {getItem:k=>map.get(k) ?? null,setItem:(k,v)=>map.set(k,v)};};const a=new AccountStore({uid:'same',provider,storage:storage()}),b=new AccountStore({uid:'same',provider,storage:storage()});await a.initialize();await b.initialize();const next=structuredClone(a.local),rule=learned('CU','생활용품');setRule(next,ruleKey(rule),rule);a.save(next);await a.sync();await b.sync();assert.equal(classify({...input('CU'),rules:b.local.settings.categoryRules}).category,'생활용품');assert.equal(summarize(b.local,'2026-11-06').spent,0);a.stop();b.stop();
});

test('unheaded extra columns in a legacy sheet stop migration instead of adopting unrelated data',()=>{
 assert.throws(()=>decodeTables({entries:[TABLES.entries.headers.slice(0,10),['old','2026-11-06','지출',1000,'가게','기타','','',TIME,'','사용자가 따로 적은 열']]}),/기록 형식/);
});
