import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewModel, periodNeighbor, chartGroups, categoryColor, shareLabel } from '../src/review.js';
import { emptyState, getPeriod, summarize } from '../src/domain.js';
const row=(type,amount,category,date='2026-11-08',extra={})=>({id:`${type}-${amount}-${category}`,type,amount,category,date,merchant:'테스트',reason:'',fixedId:null,...extra});

test('review totals match home while including third-party spending and excluding transfers, deleted and future records',()=>{
 const state=emptyState();state.entries=[row('expense',12000,'식비'),row('expense',20000,'식비','2026-11-08',{merchant:'친구에게 송금'}),row('income',100000,'급여'),row('transfer',500000,'내부 이체'),row('expense',3000,'카페','2026-11-08',{deletedAt:'2026-11-08T12:00:00Z'}),row('expense',999,'교육','2026-11-09'),row('expense',888,'의료','2026-10-31')];
 const before=structuredClone(state),model=reviewModel(state,{anchor:'2026-11-08',today:'2026-11-08'}),home=summarize(state,'2026-11-08');
 assert.equal(model.expense.total,32000);assert.equal(model.income.total,100000);assert.equal(model.net,68000);assert.equal(model.expense.count,2);
 assert.equal(model.expense.total,home.spent);assert.equal(model.income.total,home.income);assert.deepEqual(state,before);
});
test('each chart uses its own denominator and groups repeated categories',()=>{
 const state=emptyState();state.entries=[row('expense',10000,'식비'),row('expense',20000,'식비'),row('expense',20000,'카페'),row('income',1000000,'급여')];
 const model=reviewModel(state,{anchor:'2026-11-08',today:'2026-11-08'});
 assert.equal(model.expense.categories.length,2);assert.equal(model.expense.categories[0].share,60);assert.equal(model.expense.categories[0].count,2);assert.equal(model.income.categories[0].share,100);
});
test('missing, user-created and historical categories remain visible without requiring a current definition',()=>{
 const state=emptyState();state.entries=[row('expense',1000,''),row('expense',2000,'반려동물'),row('expense',3000,'예전 분류'),row('income',4000,undefined)];
 const model=reviewModel(state,{anchor:'2026-11-08',today:'2026-11-08'});
 assert.ok(model.expense.categories.some(c=>c.category==='미분류'));assert.ok(model.expense.categories.some(c=>c.category==='반려동물'));assert.ok(model.expense.categories.some(c=>c.category==='예전 분류'));assert.equal(model.income.categories[0].category,'기타 수입');
});
test('empty and income-only periods have finite totals and no phantom chart categories',()=>{
 const state=emptyState();let model=reviewModel(state,{anchor:'2026-11-08',today:'2026-11-08'});assert.equal(model.net,0);assert.deepEqual(model.expense.categories,[]);assert.deepEqual(model.income.categories,[]);
 state.entries=[row('income',1000,'용돈')];model=reviewModel(state,{anchor:'2026-11-08',today:'2026-11-08'});assert.equal(model.net,1000);assert.equal(model.expense.total,0);assert.equal(model.income.categories[0].share,100);
});
test('payday periods include both boundaries, clamp leap dates and exclude neighboring days',()=>{
 const state=emptyState();state.settings={periodMode:'payday',payday:31};state.entries=[row('expense',1,'식비','2024-02-28'),row('expense',10,'식비','2024-02-29'),row('expense',20,'식비','2024-03-30'),row('expense',2,'식비','2024-03-31')];
 const model=reviewModel(state,{anchor:'2024-03-15',today:'2024-03-31'});assert.equal(model.period.start,'2024-02-29');assert.equal(model.period.end,'2024-03-30');assert.equal(model.expense.total,30);
});
test('period navigation roundtrips through short months, leap years and year boundaries',()=>{
 for(const [date,mode,payday] of [['2026-01-05','calendar',25],['2024-03-15','payday',31],['2026-03-15','payday',31],['2026-12-31','payday',25]]){
  const current=getPeriod(date,mode,payday),previous=getPeriod(periodNeighbor(current,-1),mode,payday),next=getPeriod(periodNeighbor(previous,1),mode,payday);
  assert.equal(next.start,current.start);assert.equal(next.end,current.end);
 }
});
test('small category grouping preserves every amount and percentage and expands without mutating the original',()=>{
 const state=emptyState();state.entries=Array.from({length:9},(_,i)=>row('expense',i+1,`항목${i}`));const categories=reviewModel(state,{anchor:'2026-11-08',today:'2026-11-08'}).expense.categories,before=structuredClone(categories),collapsed=chartGroups(categories);
 assert.equal(collapsed.length,6);assert.equal(collapsed[5].category,'나머지 4개');assert.equal(collapsed.reduce((sum,c)=>sum+c.amount,0),45);assert.ok(Math.abs(collapsed.reduce((sum,c)=>sum+c.share,0)-100)<1e-8);assert.equal(chartGroups(categories,true).length,9);assert.deepEqual(categories,before);
});
test('tiny shares and large exact amounts remain available without rounding amounts away',()=>{
 const state=emptyState();state.entries=[row('expense',999999999999,'주거'),row('expense',1,'식비')];const model=reviewModel(state,{anchor:'2026-11-08',today:'2026-11-08'});
 assert.equal(model.expense.total,1000000000000);assert.equal(model.expense.categories[1].amount,1);assert.equal(shareLabel(model.expense.categories[1].share),'0.1% 미만');assert.equal(shareLabel(0),'0%');assert.equal(categoryColor('주거','expense'),categoryColor('주거','expense'));
});
