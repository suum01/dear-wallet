import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountStore, accountCacheKey, firebaseConfigured, loginError } from '../src/account-store.js';
import { emptyState } from '../src/domain.js';
import { applyPatches } from '../src/sheets.js';
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k) ?? null,setItem:(k,v)=>map.set(k,v),map};};
const entry=(id,amount=1000)=>({id,date:'2026-11-06',type:'expense',amount,merchant:'식사',category:'식비',reason:'',fixedId:null});
function provider(){const users=new Map();return {users,async read(uid){return structuredClone(users.get(uid) || {state:emptyState(),onboardingComplete:false});},async write(uid,patches){const remote=await this.read(uid);remote.state=applyPatches(remote.state,patches);users.set(uid,remote);},async completeOnboarding(uid,settings){const remote=await this.read(uid);remote.state.settings=settings;remote.onboardingComplete=true;users.set(uid,remote);}};}
test('Firebase web config must be real configuration, not the old Sheets OAuth ID',()=>{
 assert.equal(firebaseConfigured(null),false);assert.equal(firebaseConfigured({clientId:'oauth'}),false);assert.equal(firebaseConfigured({apiKey:'YOUR_KEY',authDomain:'test',projectId:'test',appId:'test'}),false);assert.equal(firebaseConfigured({apiKey:'public',authDomain:'example.firebaseapp.com',projectId:'example',appId:'public-app'}),true);
});
test('account caches and writes are isolated by authenticated user ID',async()=>{
 const remote=provider(),storage=memory();const alice=new AccountStore({uid:'alice',provider:remote,storage}),bob=new AccountStore({uid:'bob',provider:remote,storage});
 await alice.initialize();let state=emptyState();state.entries=[entry('alice-food')];alice.save(state);await alice.sync();await bob.initialize();assert.equal(bob.local.entries.length,0);
 state=emptyState();state.entries=[entry('bob-food',2000)];bob.save(state);await bob.sync();assert.equal((await remote.read('alice')).state.entries[0].id,'alice-food');assert.equal((await remote.read('bob')).state.entries[0].id,'bob-food');assert.notEqual(accountCacheKey('alice'),accountCacheKey('bob'));alice.stop();bob.stop();
});
test('two devices under one user merge independent documents',async()=>{
 const remote=provider(),a=new AccountStore({uid:'same-user',provider:remote,storage:memory()}),b=new AccountStore({uid:'same-user',provider:remote,storage:memory()});await a.initialize();await b.initialize();
 const one=emptyState(),two=emptyState();one.entries=[entry('one')];two.entries=[entry('two')];a.save(one);b.save(two);await a.sync();await b.sync();await a.sync();assert.deepEqual(a.local.entries.map(e=>e.id).sort(),['one','two']);a.stop();b.stop();
});
test('signout during account loading prevents late data from opening the app',async()=>{
 let resolve;const remote={read:()=>new Promise(r=>{resolve=r;})};let applied=false;const store=new AccountStore({uid:'alice',provider:remote,storage:memory(),onApply:()=>{applied=true;}});const loading=store.initialize();store.stop();resolve({state:emptyState(),onboardingComplete:true});assert.equal(await loading,null);assert.equal(applied,false);
});
test('failed writes preserve queued account records for the next sign-in',async()=>{
 const remote=provider(),storage=memory(),a=new AccountStore({uid:'alice',provider:remote,storage});await a.initialize();const state=emptyState();state.entries=[entry('pending')];a.save(state);const write=remote.write;remote.write=async()=>{throw Object.assign(new Error('offline'),{code:'unavailable'});};assert.equal(await a.sync(),false);assert.equal(a.pending(),true);a.stop();
 remote.write=write;const next=new AccountStore({uid:'alice',provider:remote,storage});await next.initialize();assert.equal(next.local.entries[0].id,'pending');assert.equal(next.pending(),false);next.stop();
});
test('onboarding choices persist on the account for later devices',async()=>{
 const remote=provider(),a=new AccountStore({uid:'new-user',provider:remote,storage:memory()});assert.equal((await a.initialize()).onboardingComplete,false);await a.finishOnboarding({periodMode:'payday',payday:25});assert.equal((await remote.read('new-user')).onboardingComplete,true);assert.equal((await remote.read('new-user')).state.settings.payday,25);a.stop();
});
test('corrupt account cache fails before network writes and remains intact',async()=>{
 const storage=memory(),remote=provider();storage.setItem(accountCacheKey('alice'),'bad-json');const store=new AccountStore({uid:'alice',provider:remote,storage});await assert.rejects(store.initialize(),/원본을 유지/);assert.equal(storage.getItem(accountCacheKey('alice')),'bad-json');store.stop();
});
test('login cancellation and blocked popup have distinct recovery messages',()=>{
 assert.match(loginError({code:'auth/popup-closed-by-user'}),/취소/);assert.match(loginError({code:'auth/popup-blocked'}),/차단/);assert.match(loginError({code:'permission-denied'}),/계정 기록/);
});
