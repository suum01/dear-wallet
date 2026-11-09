import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparisonModel, amountChange, changeLabel, reviewDetailModel } from '../src/review.js';
import { emptyState } from '../src/domain.js';
const row=(id,type,amount,category,date,extra={})=>({id,type,amount,category,date,merchant:id,reason:'',fixedId:null,...extra});

test('ongoing calendar periods compare the same elapsed days and include today, not later prior-month records',()=>{
 const s=emptyState();s.entries=[row('current','expense',200,'식비','2026-11-09'),row('previous','expense',100,'식비','2026-10-09'),row('later-previous','expense',999,'식비','2026-10-10'),row('future','expense',888,'식비','2026-11-10'),row('transfer','transfer',700,'식비','2026-11-08'),row('deleted','expense',600,'식비','2026-10-08',{deletedAt:'2026-10-09T00:00:00Z'})];
 const before=structuredClone(s),m=comparisonModel(s,{today:'2026-11-09',anchor:'2026-11-09'});
 assert.deepEqual(m.current.period,{start:'2026-11-01',end:'2026-11-09'});assert.deepEqual(m.previous.period,{start:'2026-10-01',end:'2026-10-09'});assert.equal(m.currentDays,9);assert.equal(m.previousDays,9);assert.equal(m.current.expense.total,200);assert.equal(m.previous.expense.total,100);assert.deepEqual(m.changes.expense,{current:200,previous:100,delta:100,percent:100});assert.equal(m.isCurrent,true);assert.equal(m.previousShorter,false);assert.deepEqual(s,before);
});
test('completed periods compare whole months including month ends regardless of selected anchor day',()=>{
 const s=emptyState();s.entries=[row('selected-last','expense',200,'식비','2026-10-31'),row('prior-last','expense',100,'식비','2026-09-30'),row('outside','expense',999,'식비','2026-08-31')];
 const m=comparisonModel(s,{today:'2026-11-09',anchor:'2026-10-02'});
 assert.equal(m.isCurrent,false);assert.equal(m.current.period.end,'2026-10-31');assert.equal(m.previous.period.end,'2026-09-30');assert.equal(m.currentDays,31);assert.equal(m.previousDays,30);assert.equal(m.previous.expense.total,100);assert.equal(m.current.expense.total,200);
});
test('a shorter previous period clamps at its real end, including leap years and year boundaries',()=>{
 for(const [today,start,end,currentDays,previousDays] of [['2024-03-31','2024-02-01','2024-02-29',31,29],['2026-03-30','2026-02-01','2026-02-28',30,28],['2026-01-01','2025-12-01','2025-12-01',1,1]]){
  const m=comparisonModel(emptyState(),{today,anchor:today});assert.deepEqual(m.previous.period,{start,end});assert.equal(m.currentDays,currentDays);assert.equal(m.previousDays,previousDays);assert.equal(m.previousShorter,currentDays>previousDays);
 }
});
test('current payday comparisons use elapsed days from clamped payday starts, not day-of-month',()=>{
 const s=emptyState();s.settings={periodMode:'payday',payday:25};s.entries=[row('current','expense',10,'식비','2026-11-09'),row('previous','expense',20,'식비','2026-10-10'),row('excluded','expense',999,'식비','2026-10-11')];
 let m=comparisonModel(s,{today:'2026-11-09',anchor:'2026-11-09'});assert.deepEqual(m.current.period,{start:'2026-10-25',end:'2026-11-09'});assert.deepEqual(m.previous.period,{start:'2026-09-25',end:'2026-10-10'});assert.equal(m.currentDays,16);assert.equal(m.previous.expense.total,20);
 s.settings.payday=31;m=comparisonModel(s,{today:'2024-03-15',anchor:'2024-03-15'});assert.deepEqual(m.current.period,{start:'2024-02-29',end:'2024-03-15'});assert.deepEqual(m.previous.period,{start:'2024-01-31',end:'2024-02-15'});
});
test('income and expense changes are independent and zero baselines never produce infinity or an invented percentage',()=>{
 const s=emptyState();s.entries=[row('salary','income',1000,'급여','2026-11-09'),row('previous-salary','income',2000,'급여','2026-10-09'),row('food','expense',500,'식비','2026-11-09')];
 const m=comparisonModel(s,{today:'2026-11-09',anchor:'2026-11-09'});assert.deepEqual(m.changes.income,{current:1000,previous:2000,delta:-1000,percent:-50});assert.equal(m.changes.expense.percent,null);assert.equal(m.hasPreviousRecords,true);assert.equal(changeLabel(m.changes.expense),'500원 증가 · 이전 0원');assert.equal(changeLabel(m.changes.income),'1,000원 감소 · 50%');
 assert.equal(changeLabel(amountChange(0,0)),'변화 없음');assert.equal(changeLabel(amountChange(0,100)),'100원 감소 · 100%');assert.equal(changeLabel(amountChange(100001,100000)),'1원 증가 · 0.1% 미만');
});
test('category changes rank by absolute won increase or decrease, include disappeared and new categories, and limit each list to three',()=>{
 const s=emptyState();s.entries=[...Array.from({length:5},(_,i)=>row('up'+i,'expense',10*(i+1),'늘어남'+i,'2026-11-08')),...Array.from({length:4},(_,i)=>row('down'+i,'expense',20*(i+1),'줄어듦'+i,'2026-10-08')),row('income','income',999999,'급여','2026-11-08'),row('unchanged-a','expense',1,'그대로','2026-11-08'),row('unchanged-b','expense',1,'그대로','2026-10-08')];
 const m=comparisonModel(s,{today:'2026-11-09',anchor:'2026-11-09'});assert.deepEqual(m.increases.map(c=>c.delta),[50,40,30]);assert.deepEqual(m.decreases.map(c=>c.delta),[-80,-60,-40]);assert.equal(m.decreases[0].current,0);assert.equal(m.decreases[0].percent,-100);assert.equal(m.increases[0].percent,null);
});
test('historical, custom and missing categories compare by normalized names and preserve exact large amounts',()=>{
 const s=emptyState();s.entries=[row('a','expense',999999999999,' 미분류 ','2026-11-08'),row('b','expense',999999999998,undefined,'2026-10-08'),row('c','expense',40,'예전 반려동물','2026-10-08')];
 const m=comparisonModel(s,{today:'2026-11-09',anchor:'2026-11-09'});assert.equal(m.increases[0].delta,1);assert.equal(m.increases[0].category,'미분류');assert.equal(m.decreases[0].category,'예전 반려동물');assert.equal(m.current.expense.total,999999999999);
});
test('category details on each comparison side use exactly the displayed windows and re-evaluate edits',()=>{
 const s=emptyState();s.entries=[row('a','expense',300,'식비','2026-11-08'),row('b','expense',200,'식비','2026-10-08'),row('c','expense',999,'식비','2026-10-10')];
 const m=comparisonModel(s,{today:'2026-11-09',anchor:'2026-11-09'});
 for(const side of ['current','previous'])assert.equal(reviewDetailModel(s,{period:m[side].period,type:'expense',categories:['식비'],today:'2026-11-09'}).total,m[side].expense.total);
 s.entries[1].deletedAt='2026-11-09T00:00:00Z';const updated=comparisonModel(s,{today:'2026-11-09',anchor:'2026-11-09'});assert.equal(updated.previous.expense.total,0);assert.equal(updated.changes.expense.percent,null);
});
test('empty, current-only and prior-only data have explicit zero totals and record availability',()=>{
 const s=emptyState(),options={today:'2026-11-09',anchor:'2026-11-09'};let m=comparisonModel(s,options);assert.equal(m.hasPreviousRecords,false);assert.deepEqual(m.increases,[]);assert.deepEqual(m.decreases,[]);assert.equal(m.changes.expense.percent,null);
 s.entries=[row('new','expense',10,'식비','2026-11-09')];m=comparisonModel(s,options);assert.equal(m.hasPreviousRecords,false);assert.equal(m.increases[0].delta,10);
 s.entries=[row('old','expense',10,'식비','2026-10-09')];m=comparisonModel(s,options);assert.equal(m.hasPreviousRecords,true);assert.equal(m.decreases[0].delta,-10);assert.equal(m.changes.expense.percent,-100);
});
