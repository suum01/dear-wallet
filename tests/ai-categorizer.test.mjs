import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { aiInput, aiResult, aiError, createLiveClassifier } from '../src/ai-categorizer.js';
import { emptyState, parseState, summarize } from '../src/domain.js';
import { stateDiff, applyPatches, encodePatch, decodeTables, TABLES } from '../src/sheets.js';

const input = { merchant:'씨유', description:'반숙란', type:'expense' };
const deferred = () => { let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; };

test('AI receives only trimmed merchant, description and selected type, never financial/profile fields',()=>{
  assert.deepEqual(aiInput({...input,merchant:' 씨유 ',amount:1000,reason:'개인적인 사정',account:'secret',uid:'private'}),input);
  for(const raw of [{...input,type:'transfer'},{...input,merchant:''},{...input,description:'a'.repeat(201)},{...input,merchant:'a'.repeat(81)}])assert.throws(()=>aiInput(raw));
});
test('AI output is constrained to the existing categories and explicitly marked as AI',()=>{
  assert.deepEqual(aiResult('{"category":"식비"}','expense').category,'식비');
  assert.equal(aiResult({category:'급여'},'income').source,'ai');
  assert.throws(()=>aiResult({category:'급여'},'expense'));
  assert.throws(()=>aiResult({category:'주식'},'income'));
  assert.throws(()=>aiResult({category:'새로운 카테고리'},'expense'));
  assert.throws(()=>aiResult('not JSON','expense'));
});
test('an unknown category must be a suggestion and can never be silently chosen',()=>{
 const result=aiResult({category:'미분류',suggestedCategory:'반려동물',suggestionReason:'반려동물의 사료와 용품을 모아 볼 수 있어요.'},'expense');
 assert.equal(result.category,'미분류');assert.equal(result.suggestedCategory,'반려동물');
 assert.throws(()=>aiResult({category:'반려동물'},'expense'));
 assert.throws(()=>aiResult({category:'식비',suggestedCategory:'반려동물'},'expense'));
 assert.throws(()=>aiResult({category:'미분류',suggestedCategory:'급여'},'expense'));
 assert.throws(()=>aiResult({category:'미분류',suggestedCategory:'<script>alert(1)</script>'},'expense'));
 assert.throws(()=>aiResult({category:'미분류',suggestedCategory:'가'.repeat(41)},'expense'));
});
test('confirmed categories are usable by AI and equivalent names never prompt duplicate additions',()=>{
 assert.equal(aiResult({category:'반려동물'},'expense',['반려동물']).category,'반려동물');
 const duplicate=aiResult({category:'미분류',suggestedCategory:'반려 동물'},'expense',['반려동물']);assert.equal(duplicate.category,'반려동물');assert.equal(duplicate.suggestedCategory,undefined);
 assert.equal(aiResult({category:'미분류',suggestedCategory:'식 비'},'expense').category,'식비');
 assert.deepEqual(aiInput({...input,customCategories:['반려동물'],reason:'private'}),{...input,customCategories:['반려동물']});
});
test('editing rapidly is debounced into one request and re-rendering never repeats it',async()=>{
  const calls=[];const live=createLiveClassifier({debounceMs:10,request:async value=>{calls.push(value);return {category:'식비'};}});
  live.schedule({...input,description:'반'});live.schedule(input);live.schedule(input);
  await pause(30);assert.deepEqual(calls,[input]);assert.equal(live.state.status,'ready');
  live.schedule(input);await pause(20);assert.equal(calls.length,1);live.cancel();
});
test('saving can flush the debounce without issuing a second request',async()=>{
  let calls=0;const result=deferred();const live=createLiveClassifier({request:()=>{calls++;return result.promise;}});
  live.schedule(input);const first=live.flush(),second=live.flush();await pause(0);assert.equal(calls,1);
  result.resolve({category:'식비'});assert.equal((await first).category,'식비');assert.equal((await second).category,'식비');live.cancel();
});
test('late responses cannot overwrite new text even when the original text is typed again',async()=>{
  const requests=[];const live=createLiveClassifier({request:()=>{const d=deferred();requests.push(d);return d.promise;}});
  live.schedule(input);const old=live.flush();await pause(0);
  live.schedule({...input,description:'치약'});live.schedule(input);const latest=live.flush();await pause(0);
  requests[1].resolve({category:'생활용품'});await latest;requests[0].resolve({category:'식비'});await old;
  assert.equal(live.state.result.category,'생활용품');live.cancel();
});
test('manual choice, closing the form or switching accounts discards in-flight results',async()=>{
  const request=deferred();const live=createLiveClassifier({request:()=>request.promise});
  live.schedule(input);const waiting=live.flush();live.cancel();request.resolve({category:'식비'});await waiting;
  assert.equal(live.state.status,'idle');assert.equal(live.state.result,null);
});
test('a failed request is not retried on every render, but an explicit retry works',async()=>{
  let calls=0;const live=createLiveClassifier({request:async()=>{if(++calls===1)throw Object.assign(new Error('disabled'),{code:'ai/api-not-enabled'});return {category:'식비'};}});
  live.schedule(input);await live.flush();assert.equal(live.state.status,'error');assert.match(live.state.error,/연결 설정/);
  live.schedule(input);assert.equal(calls,1);live.schedule(input,{retry:true});await live.flush();assert.equal(calls,2);assert.equal(live.state.result.source,'ai');live.cancel();
});
test('timeouts and invalid model output allow a retry instead of saving an unvalidated AI label',async()=>{
  const slow=createLiveClassifier({timeoutMs:10,request:()=>new Promise(()=>{})});slow.schedule(input);await slow.flush();assert.equal(slow.state.status,'error');assert.match(slow.state.error,/늦어지고/);slow.cancel();
  const bad=createLiveClassifier({request:async()=>({category:'급여'})});bad.schedule(input);await bad.flush();assert.equal(bad.state.status,'error');assert.equal(bad.state.result,null);bad.cancel();
  assert.match(aiError(new Error('429 RESOURCE_EXHAUSTED')),/사용 한도/);
  assert.match(aiError(new Error('403 PERMISSION_DENIED')),/권한/);
});
test('AI source and legacy preference roundtrip through Sheets without changing totals',()=>{
  const before=emptyState(),state=structuredClone(before);state.settings.aiCategorization=true;
  state.entries.push({id:'ai',date:'2026-11-06',type:'expense',amount:1000,merchant:'씨유',description:'반숙란',category:'식비',categorySource:'ai',reason:'',fixedId:null});
  assert.ok(parseState(JSON.stringify(state)));assert.equal(summarize(state,'2026-11-06').spent,1000);
  const patches=stateDiff(before,state),tables={entries:[TABLES.entries.headers],settings:[TABLES.settings.headers]};
  for(const patch of patches)tables[patch.table].push(encodePatch(patch,'2026-11-06T12:00:00Z'));
  assert.equal(decodeTables(tables).entries[0].categorySource,'ai');assert.equal(decodeTables(tables).settings.aiCategorization,true);
  assert.equal(applyPatches(before,patches).settings.aiCategorization,true);
  state.settings.aiCategorization='yes';assert.equal(parseState(JSON.stringify(state)),null);
});
