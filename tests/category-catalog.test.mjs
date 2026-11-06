import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryOptions, customCategoryKey, setCustomCategory, validCustomCategories } from '../src/category-catalog.js';
import { emptyState, parseState } from '../src/domain.js';
import { stateDiff, applyPatches, mergeForConnection, encodePatch, decodeTables, TABLES } from '../src/sheets.js';
import { AccountStore } from '../src/account-store.js';
const added=(name,type='expense')=>({name,type,updatedAt:'2026-11-06T12:00:00Z'});

test('a confirmed category is scoped to its transaction type and does not rewrite old entries',()=>{
 const state=emptyState();state.entries=[{id:'old',date:'2026-11-06',type:'expense',amount:1000,merchant:'가게',category:'미분류',reason:'',fixedId:null}];
 const category=added('반려동물');setCustomCategory(state,customCategoryKey(category),category);
 assert.ok(categoryOptions('expense',state.settings.customCategories).includes('반려동물'));assert.ok(!categoryOptions('income',state.settings.customCategories).includes('반려동물'));
 assert.equal(state.entries[0].category,'미분류');assert.ok(parseState(JSON.stringify(state)));
});
test('duplicate, malformed and built-in custom definitions are rejected',()=>{
 assert.ok(validCustomCategories([added('반려동물')]));
 for(const list of [[added('식비')],[added('내부 이체')],[added('  반려동물')],[added('반려동물'),added('반려 동물')],[added('<img>')],[added('가'.repeat(41))],[added('종류','transfer')]])assert.equal(validCustomCategories(list),false);
});
test('different device additions merge as independent settings documents and deletions roundtrip',()=>{
 const before=emptyState(),a=structuredClone(before),b=structuredClone(before),pet=added('반려동물'),child=added('육아');
 setCustomCategory(a,customCategoryKey(pet),pet);setCustomCategory(b,customCategoryKey(child),child);
 const merged=applyPatches(applyPatches(before,stateDiff(before,a)),stateDiff(before,b));assert.equal(merged.settings.customCategories.length,2);
 assert.equal(mergeForConnection(a,b).settings.customCategories.length,2);
 const tables={settings:[TABLES.settings.headers]};for(const patch of stateDiff(before,merged))tables.settings.push(encodePatch(patch,pet.updatedAt));
 assert.equal(decodeTables(tables).settings.customCategories.length,2);
 const removed=structuredClone(merged);setCustomCategory(removed,customCategoryKey(pet),null);assert.equal(applyPatches(merged,stateDiff(merged,removed)).settings.customCategories[0].name,'육아');
});
test('two account devices share confirmed category options without an extra permission or collection',async()=>{
 let remote=emptyState();const provider={async read(){return {state:structuredClone(remote),onboardingComplete:true};},async write(uid,patches){assert.ok(patches.every(p=>p.table==='settings'));remote=applyPatches(remote,patches);}};
 const storage=()=>{const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};};
 const a=new AccountStore({uid:'same',provider,storage:storage()}),b=new AccountStore({uid:'same',provider,storage:storage()});await a.initialize();await b.initialize();
 const next=structuredClone(a.local),category=added('반려동물');setCustomCategory(next,customCategoryKey(category),category);a.save(next);await a.sync();await b.sync();assert.ok(categoryOptions('expense',b.local.settings.customCategories).includes('반려동물'));a.stop();b.stop();
});
