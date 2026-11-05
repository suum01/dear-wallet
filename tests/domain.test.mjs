import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, getPeriod, summarize, parseState, validDate, validAmount } from '../src/domain.js';
function entry(type, amount, date='2026-11-05', extra={}) { return {id:'test',type,amount,date,merchant:'테스트',reason:'',fixedId:null,...extra}; }
test('calendar and payday boundaries include the final day',()=>{
 assert.deepEqual(getPeriod('2026-11-05'),{start:'2026-11-01',end:'2026-11-30',days:30,daysLeft:26,elapsed:5});
 assert.equal(getPeriod('2026-11-24','payday',25).start,'2026-10-25');
 assert.equal(getPeriod('2026-11-25','payday',25).end,'2026-12-24');
 assert.equal(getPeriod('2026-01-01','payday',25).start,'2025-12-25');
});
test('paydays 29–31 clamp to the last day including leap years',()=>{
 assert.equal(getPeriod('2026-02-28','payday',31).start,'2026-02-28');
 assert.equal(getPeriod('2026-03-30','payday',31).end,'2026-03-30');
 assert.equal(getPeriod('2024-02-29','payday',31).start,'2024-02-29');
});
test('no budget keeps spending, income and internal transfers separate',()=>{
 const s=emptyState(); s.entries=[entry('expense',12000),entry('income',50000),entry('transfer',90000),entry('expense',5000,'2026-10-31'),entry('expense',3000,'2026-11-06')];
 const r=summarize(s,'2026-11-05'); assert.equal(r.spent,12000);assert.equal(r.income,50000);assert.equal(r.budget,null);assert.equal(r.available,null);
});
test('only linked paid fixed costs stop being reserved, without double counting',()=>{
 const s=emptyState();s.budgets['2026-11-01']=1000000;s.fixedCosts=[{id:'rent',name:'월세',amount:400000,day:1},{id:'phone',name:'통신',amount:50000,day:20}];
 s.entries=[entry('expense',400000,'2026-11-02',{fixedId:'rent'}),entry('expense',100000)];
 const r=summarize(s,'2026-11-05');assert.equal(r.unpaidFixed,50000);assert.equal(r.available,450000);assert.equal(r.percent,50);
});
test('paid fixed costs reset in the next period and budgets stay period-specific',()=>{
 const s=emptyState();s.budgets['2026-11-01']=1000000;s.fixedCosts=[{id:'rent',name:'월세',amount:400000,day:1}];s.entries=[entry('expense',400000,'2026-11-02',{fixedId:'rent'})];
 const r=summarize(s,'2026-12-02');assert.equal(r.unpaidFixed,400000);assert.equal(r.budget,null);
});
test('overspend and fixed-cost shortfall remain visible as negative amounts',()=>{
 const s=emptyState();s.budgets['2026-11-01']=100000;s.fixedCosts=[{id:'phone',name:'통신',amount:50000,day:20}];s.entries=[entry('expense',112000)];
 const r=summarize(s,'2026-11-05');assert.equal(r.percent,112);assert.equal(r.remaining,-12000);assert.equal(r.available,-62000);
});
test('restored storage must have valid financial amounts, dates and structure',()=>{
 assert.deepEqual(parseState(JSON.stringify(emptyState())),emptyState());assert.equal(parseState('{bad'),null);
 const s=emptyState();s.entries=[entry('expense',-100)];assert.equal(parseState(JSON.stringify(s)),null);
 assert.equal(validDate('2026-02-30'),false);assert.equal(validAmount(1.5),false);assert.equal(validAmount(100),true);
});
