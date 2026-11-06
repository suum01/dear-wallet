import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, summarize } from '../src/domain.js';
import { TABLES, stateDiff, applyPatches, mergeForConnection, encodePatch, decodeTables, spreadsheetId, GoogleSheets } from '../src/sheets.js';
import { SheetSync, readSyncMeta } from '../src/sheet-sync.js';
const ID='1SRhTmZ93acASOpeXKm-gZJuN-178ICvIL5VSBNwCIEo';
const TIME='2026-11-06T12:00:00Z';
const entry=(id,amount=12000)=>({id,date:'2026-11-06',type:'expense',amount,merchant:'=HYPERLINK("bad")',reason:'친구와 저녁',category:'식비',fixedId:null});
function tablesFor(patches){
 const tables=Object.fromEntries(Object.entries(TABLES).map(([key,t])=>[key,[t.headers]]));
 for(const patch of patches)tables[patch.table].push(encodePatch(patch,TIME));
 return tables;
}
function memoryStorage(){const data=new Map();return {getItem:key=>data.get(key) ?? null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key),data};}
function server(initial=emptyState()){
 let state=structuredClone(initial);const writes=[];
 return {writes,get state(){return structuredClone(state);},set state(s){state=structuredClone(s);},async read(id){return {id,title:'miczin dear-wallet',state:structuredClone(state),tables:{},sheets:[]};},async write(snapshot,patches){writes.push(patches);state=applyPatches(state,patches);}};
}
function device(remote,initial=emptyState()){
 let local=structuredClone(initial);const storage=memoryStorage();
 const sync=new SheetSync({getLocal:()=>local,applyLocal:s=>{local=structuredClone(s);},storage,client:remote});sync.token='test-token';sync.expires=Date.now()+100000;
 return {sync,storage,get local(){return structuredClone(local);},set local(s){local=structuredClone(s);}};
}
test('sheet URLs accept only Google Sheets document IDs',()=>{
 assert.equal(spreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`),ID);
 assert.equal(spreadsheetId(ID),ID);assert.equal(spreadsheetId(`https://evil.example/spreadsheets/d/${ID}/edit`),null);assert.equal(spreadsheetId('short'),null);
});
test('table roundtrip reconstructs financial state and append updates do not duplicate spending',()=>{
 const before=emptyState(),next=emptyState();next.entries=[entry('a')];next.budgets['2026-11-01']=100000;next.fixedCosts=[{id:'phone',name:'통신비',amount:10000,day:20}];next.settings={periodMode:'payday',payday:25};next.bookmarks=[1,4];
 const patches=stateDiff(before,next),tables=tablesFor(patches);
 tables.entries.push(encodePatch({table:'entries',key:'a',value:entry('a',15000)},TIME));
 const restored=decodeTables(tables);assert.equal(restored.entries.length,1);assert.equal(restored.entries[0].amount,15000);assert.deepEqual(restored.settings,next.settings);assert.deepEqual(restored.fixedCosts,next.fixedCosts);assert.deepEqual(restored.bookmarks,[1,4]);
 assert.equal(summarize(restored,'2026-11-06').spent,15000);
});
test('deletion events remove budgets/fixed costs and keep transaction tombstones',()=>{
 const state=emptyState();state.entries=[entry('a')];state.budgets['2026-11-01']=100000;state.fixedCosts=[{id:'phone',name:'통신비',amount:10000,day:20}];
 const next=structuredClone(state);next.entries[0].deletedAt=TIME;delete next.budgets['2026-11-01'];next.fixedCosts=[];
 const tables=tablesFor([...stateDiff(emptyState(),state),...stateDiff(state,next)]);const restored=decodeTables(tables);
 assert.equal(restored.entries[0].deletedAt,TIME);assert.equal(summarize(restored,'2026-11-06').spent,0);assert.deepEqual(restored.budgets,{});assert.deepEqual(restored.fixedCosts,[]);
});
test('unexpected headers and invalid existing financial rows fail before writes',()=>{
 assert.throws(()=>decodeTables({entries:[['기존 사용자의 다른 표'],['keep me']]}),/기존 내용은 바꾸지/);
 assert.throws(()=>decodeTables({entries:[TABLES.entries.headers,['a','2026-02-30','지출',100,'store']]}),/기록 형식/);
 assert.throws(()=>decodeTables({settings:[TABLES.settings.headers,['payday','99',TIME]]}),/설정/);
});
test('first connection merges by stable IDs and preserves remote values',()=>{
 const remote=emptyState(),local=emptyState();remote.entries=[entry('shared',100),entry('remote')];local.entries=[entry('shared',900),entry('local')];remote.budgets['2026-11-01']=100;local.budgets['2026-11-01']=900;
 const merged=mergeForConnection(remote,local);assert.equal(merged.entries.length,3);assert.equal(merged.entries.find(e=>e.id==='shared').amount,100);assert.equal(merged.budgets['2026-11-01'],100);
});
test('API batch writes literal text, never formulas, and leaves unrelated tabs untouched',async()=>{
 let request;const sheets=new GoogleSheets({token:()=> 'memory-only',fetcher:async(url,options)=>{request={url,options};return {ok:true,json:async()=>({})};}});
 const snapshot={id:ID,sheets:[{properties:{sheetId:1,title:'내 개인 메모'}}],tables:{}};
 await sheets.write(snapshot,[{table:'entries',key:'a',value:entry('a')}]);
 const requests=JSON.parse(request.options.body).requests;
 assert.equal(requests.filter(r=>r.addSheet).length,6);assert.ok(requests.every(r=>!r.deleteSheet && !r.deleteRange));
 const append=requests.find(r=>r.appendCells?.rows.some(row=>row.values.some(v=>v.userEnteredValue.stringValue?.startsWith('=HYPERLINK'))));
 assert.ok(append);assert.ok(append.appendCells.rows[0].values.every(v=>!v.userEnteredValue.formulaValue));
 assert.equal(request.options.headers.Authorization,'Bearer memory-only');
});
test('API failures identify login, access and quota errors',async()=>{
 for(const [status,message] of [[401,/로그인이 만료/],[403,/접근 권한/],[429,/잠시 많아요/]]){
  const sheets=new GoogleSheets({token:()=> 'token',fetcher:async()=>({ok:false,status})});await assert.rejects(sheets.read(ID),message);
 }
});
test('two devices append independent changes without replacing each other',async()=>{
 const remote=server(),a=device(remote),b=device(remote);
 await a.sync.adopt(await remote.read(ID),true);await b.sync.adopt(await remote.read(ID),true);
 let local=a.local;local.entries.push(entry('a'));a.local=local;
 local=b.local;local.entries.push(entry('b',3000));b.local=local;
 assert.equal(await a.sync.sync(),true);assert.equal(await b.sync.sync(),true);assert.equal(await a.sync.sync(),true);
 assert.deepEqual(a.local.entries.map(e=>e.id).sort(),['a','b']);assert.equal(summarize(a.local,'2026-11-06').spent,15000);
 assert.equal(a.sync.dirty(),false);assert.equal(b.sync.dirty(),false);
 assert.ok([...a.storage.data.values()].every(value=>!value.includes('test-token')));
});
test('connection backs up local data before a remote-only load',async()=>{
 const local=emptyState();local.entries=[entry('local')];const remoteState=emptyState();remoteState.entries=[entry('remote')];const remote=server(remoteState),a=device(remote,local);
 await a.sync.adopt(await remote.read(ID),false);assert.deepEqual(a.local.entries.map(e=>e.id),['remote']);
 const backup=[...a.storage.data.entries()].find(([key])=>key.startsWith('dear-wallet.beforeSheets.'));assert.equal(JSON.parse(backup[1]).entries[0].id,'local');
 assert.ok(readSyncMeta(a.storage));a.sync.disconnect();assert.equal(readSyncMeta(a.storage),null);assert.equal(a.local.entries[0].id,'remote');
});
test('failed remote writes preserve local pending changes and baseline for retry',async()=>{
 const remote=server(),a=device(remote);await a.sync.adopt(await remote.read(ID),true);
 const local=a.local;local.entries.push(entry('pending'));a.local=local;
 const write=remote.write;remote.write=async()=>{throw new Error('offline');};
 assert.equal(await a.sync.sync(),null);assert.equal(a.sync.dirty(),true);assert.equal(a.local.entries[0].id,'pending');assert.equal(remote.state.entries.length,0);
 remote.write=write;await a.sync.sync();assert.equal(remote.state.entries[0].id,'pending');assert.equal(a.sync.dirty(),false);
});
test('changes made during a request remain pending instead of being lost',async()=>{
 const remote=server(),a=device(remote);await a.sync.adopt(await remote.read(ID),true);
 let reads=0;const read=remote.read;remote.read=async id=>{const result=await read(id);if(++reads===2){const next=a.local;next.entries.push(entry('during'));a.local=next;}return result;};
 await a.sync.sync();a.sync.cancelTimer();assert.equal(a.local.entries[0].id,'during');assert.equal(a.sync.dirty(),true);
});
test('sample mode makes no remote writes and expired sessions keep pending data',async()=>{
 const remote=server(),a=device(remote);await a.sync.adopt(await remote.read(ID),true);const writes=remote.writes.length;
 a.sync.isDemo=()=>true;await a.sync.sync();assert.equal(remote.writes.length,writes);
 a.sync.isDemo=()=>false;a.sync.expires=0;const local=a.local;local.entries.push(entry('offline'));a.local=local;await a.sync.sync();assert.equal(remote.writes.length,writes);assert.equal(a.sync.dirty(),true);
});

test('object field ordering does not create false sync changes',()=>{
 const a=emptyState(),b=emptyState();a.entries=[entry('a')];b.entries=[Object.fromEntries(Object.entries(a.entries[0]).reverse())];assert.deepEqual(stateDiff(a,b),[]);
});
test('unreadable local data blocks network writes even when a sheet was connected',async()=>{
 const remote=server(),a=device(remote);await a.sync.adopt(await remote.read(ID),true);const count=remote.writes.length;
 a.sync.isLocalReady=()=>false;await a.sync.sync();assert.equal(remote.writes.length,count);assert.match(a.sync.lastError,/시트는 변경하지/);
});
