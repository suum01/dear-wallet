import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarModel, shiftMonth } from '../src/history.js';
const period = {start:'2026-10-25',end:'2026-11-24'};
test('calendar keeps the conventional month with correct weekday offset',()=>{
 const model=calendarModel('2026-11',[],period);
 assert.equal(model.offset,0);assert.equal(model.days.length,30);
 assert.equal(model.days[23].inPeriod,true);assert.equal(model.days[24].inPeriod,false);
});
test('daily totals include third-party spending and exclude internal transfers',()=>{
 const model=calendarModel('2026-11',[
  {date:'2026-11-05',type:'expense',amount:12000},
  {date:'2026-11-05',type:'expense',amount:20000,merchant:'친구에게 송금'},
  {date:'2026-11-05',type:'income',amount:100000},
  {date:'2026-11-05',type:'transfer',amount:500000},
  {date:'2026-10-05',type:'expense',amount:99999}
 ],period);
 assert.equal(model.days[4].expense,32000);assert.equal(model.days[4].income,100000);
 assert.equal(model.days[5].expense,0);
});
test('leap year and year navigation produce complete months',()=>{
 assert.equal(calendarModel('2024-02',[],period).days.length,29);
 assert.equal(calendarModel('2026-02',[],period).days.length,28);
 assert.equal(shiftMonth('2026-01',-1),'2025-12');assert.equal(shiftMonth('2026-12',1),'2027-01');
});

test('deleted rows remain absent from daily totals after reload',()=>{
 const model=calendarModel('2026-11',[
  {date:'2026-11-05',type:'expense',amount:12000,deletedAt:'2026-11-05T12:00:00Z'},
  {date:'2026-11-05',type:'expense',amount:3000}
 ],period);assert.equal(model.days[4].expense,3000);
});
