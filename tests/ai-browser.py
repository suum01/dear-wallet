"""AI UI integration using simulated Firebase and model adapters; no real model calls."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE_URL=os.environ.get('BASE_URL','http://127.0.0.1:4173/dear-wallet/').rstrip('/')+'/'
PROVIDER='''import {emptyState} from './domain.js';import {applyPatches} from './sheets.js';
export async function createFirebaseProvider(){let callback;
const user=uid=>({uid,email:uid+'@example.test',displayName:uid});
const key=uid=>'test.ai.wallet.'+uid;
const read=uid=>JSON.parse(localStorage.getItem(key(uid))||JSON.stringify({...emptyState(),settings:{periodMode:"calendar",payday:25,aiCategorization:false}}));
window.testAIRequests=[];
return {subscribe(fn){callback=fn;queueMicrotask(()=>fn(localStorage.getItem('test.ai.session')?user(localStorage.getItem('test.ai.session')):null));},
signIn(){const uid=window.testNextAIUser||'alice';localStorage.setItem('test.ai.session',uid);queueMicrotask(()=>callback(user(uid)));return Promise.resolve({user:user(uid)});},
signOut(){localStorage.removeItem('test.ai.session');callback(null);return Promise.resolve();},
async read(uid){return {state:read(uid),onboardingComplete:true};},async write(uid,patches){localStorage.setItem(key(uid),JSON.stringify(applyPatches(read(uid),patches)));},
classifyWithAI(input){return new Promise((resolve,reject)=>window.testAIRequests.push({input,resolve:category=>resolve(JSON.stringify(typeof category==="string"?{category}:category)),reject:code=>reject(Object.assign(new Error(code),{code}))}));}};}'''

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('**/src/firebase-provider.js',lambda route:route.fulfill(content_type='text/javascript',body=PROVIDER))
 page.goto(BASE_URL);page.locator('#google-sign-in').click();expect(page.locator('#app-shell')).to_be_visible()
 form=page.locator('#record-form')
 def open_record(merchant,description='',kind='expense'):
  page.locator('.mobile-record' if page.viewport_size['width']<=700 else '.desktop-record').click()
  form.locator('[name=type]').select_option(kind);form.locator('[name=amount]').fill('1000');form.locator('[name=merchant]').fill(merchant)
  if description:form.locator('[name=description]').fill(description)
 def save(wait=True):
  form.get_by_role('button',name='기록 저장하기').click()
  if wait:expect(page.locator('#record-dialog')).not_to_be_visible()
 def close():form.locator('[data-close]').click()
 def count():return page.evaluate('window.testAIRequests.length')
 def wait_count(n):page.wait_for_function('n=>window.testAIRequests.length===n',arg=n)
 def respond(index,category):page.evaluate('([i,c])=>window.testAIRequests[i].resolve(c)',[index,category])
 def reject(index,code):page.evaluate('([i,c])=>window.testAIRequests[i].reject(c)',[index,code])
 def wallet(uid='alice'):return page.evaluate('uid=>JSON.parse(localStorage.getItem("dear-wallet.account."+uid+".v1")).state',uid)
 def propose(name,kind='expense'):
  index=count();open_record('분류가 필요한 가게','새로운 용도의 구매',kind);wait_count(index+1)
  respond(index,{'category':'기타 수입' if kind=='income' else '미분류','suggestedCategory':name,'suggestionReason':'기존 항목에 적합한 분류가 없어서 새 카테고리를 추천했어요.'})
  expect(page.locator('#category-suggestion')).to_be_visible();expect(page.locator('#category-suggestion-title')).to_contain_text(name)

 # AI starts by default, even for a legacy false preference; there is no toggle.
 open_record('씨유','반숙란');form.locator('[name=reason]').fill('AI에 보내지 않을 개인적인 이유')
 expect(page.locator('#ai-category-enabled')).to_have_count(0);wait_count(1)
 assert page.evaluate('window.testAIRequests[0].input')=={'merchant':'씨유','description':'반숙란','type':'expense'}
 expect(page.locator('#category-mode-badge')).to_have_text('임시 분류');respond(0,'식비');expect(page.locator('#category-mode-badge')).to_have_text('AI');save()
 assert wallet()['entries'][-1]['categorySource']=='ai';assert wallet()['settings']['aiCategorization'] is False

 # A manual choice wins over an in-flight response, even for a locally known item.
 open_record('씨유','치약');wait_count(2);form.locator('[name=category]').fill('생활용품');respond(1,'식비')
 expect(form.locator('[name=category]')).to_have_value('생활용품');expect(page.locator('#category-mode-badge')).to_have_text('직접 선택');save();assert wallet()['entries'][-1]['categorySource']=='manual'

 # Old text and old dialogs cannot receive a late response.
 open_record('지에스25','반숙란');wait_count(3);form.locator('[name=description]').fill('치약');wait_count(4)
 respond(2,'식비');expect(form.locator('[name=category]')).to_have_value('생활용품');expect(page.locator('#category-mode-badge')).to_have_text('임시 분류')
 respond(3,'생활용품');expect(page.locator('#category-mode-badge')).to_have_text('AI');close()
 open_record('세븐일레븐','반숙란');wait_count(5);close();open_record('모르는상점','새상품');wait_count(6);respond(4,'식비')
 expect(form.locator('[name=category]')).to_have_value('미분류');expect(page.locator('#category-mode-badge')).to_have_text('임시 분류')

 # Setup errors are honest and do not cause automatic retry loops.
 reject(5,'ai/api-not-enabled');expect(page.locator('#category-help')).to_contain_text('연결 설정');expect(page.locator('#ai-category-retry')).to_be_visible()
 page.wait_for_timeout(1100);assert count()==6
 page.locator('#ai-category-retry').click();wait_count(7);respond(6,'식비');expect(page.locator('#category-mode-badge')).to_have_text('AI');close()

 # Saving during the debounce flushes one request and waits for its actual result.
 open_record('씨유','반숙란');save(False);wait_count(8);expect(form.get_by_role('button',name='기록 저장하기')).to_be_disabled();respond(7,'식비');expect(page.locator('#record-dialog')).not_to_be_visible()
 assert wallet()['entries'][-1]['category']=='식비';assert wallet()['entries'][-1]['categorySource']=='ai'
 open_record('키움자동충전','','transfer');assert page.locator('#ai-category-disclosure').is_hidden();save();assert count()==8;assert wallet()['entries'][-1]['type']=='transfer'

 # Wrong-type model categories are rejected; a failed AI request still permits saving.
 open_record('씨유','반숙란');wait_count(9);respond(8,'급여');expect(page.locator('#ai-category-retry')).to_be_visible();expect(page.locator('#category-mode-badge')).to_have_text('임시 분류');save();assert wallet()['entries'][-1]['categorySource']=='keyword'
 open_record('회사','급여','income');wait_count(10);respond(9,'급여');expect(page.locator('#category-mode-badge')).to_have_text('AI');save();assert wallet()['entries'][-1]['type']=='income'

 # Remembered choices skip the model entirely.
 open_record('씨유','반숙란');form.locator('[name=category]').fill('생활용품');form.locator('[name=rememberCategory]').check();save()
 open_record('씨유','반숙란');expect(page.locator('#category-mode-badge')).to_have_text('기억한 분류');page.wait_for_timeout(1000);assert count()==10;close()

 # A logout and a different user cannot inherit an AI result or the first user's consent.
 open_record('새 가게','새 상품');wait_count(11);close();page.locator('.topbar [data-open=settings]').click();page.locator('#session-sign-out').click();respond(10,'식비')
 page.evaluate("window.testNextAIUser='bob'");page.locator('#google-sign-in').click();expect(page.locator('#app-shell')).to_be_visible();open_record('씨유','반숙란');wait_count(12);respond(11,'식비');expect(page.locator('#category-mode-badge')).to_have_text('AI');close();assert not wallet('bob')['settings'].get('customCategories')
 page.locator('.topbar [data-open=settings]').click();page.locator('#session-sign-out').click();page.evaluate("window.testNextAIUser='alice'");page.locator('#google-sign-in').click();expect(page.locator('#app-shell')).to_be_visible()
 # A recommendation always asks; neither a save nor a cancelled draft creates it.
 before=len(wallet()['entries']);propose('반려동물');assert not wallet()['settings'].get('customCategories');save(False)
 expect(form.locator('.form-error')).to_contain_text('먼저 선택');assert len(wallet()['entries'])==before
 page.locator('#accept-category-suggestion').click();expect(page.locator('#category-mode-badge')).to_have_text('추가 예정');assert not wallet()['settings'].get('customCategories');close()
 assert not wallet()['settings'].get('customCategories')
 propose('반려동물');page.locator('#decline-category-suggestion').click();save();assert not wallet()['settings'].get('customCategories');assert wallet()['entries'][-1]['category']=='미분류'
 # Confirmation is saved with the transaction and becomes an existing category.
 propose('반려동물');Path('artifacts').mkdir(exist_ok=True)
 for width in [320,375,390,430,768,1024,1440]:
  page.set_viewport_size({'width':width,'height':1000});page.locator('#category-suggestion').scroll_into_view_if_needed();assert form.evaluate('el=>el.scrollWidth<=el.clientWidth'),f'Suggestion overflow {width}'
  page.screenshot(path=f'artifacts/category-suggestion-{width}.png',full_page=True)
 page.set_viewport_size({'width':390,'height':844});page.locator('#accept-category-suggestion').click();save()
 assert wallet()['settings']['customCategories'][0]['name']=='반려동물';assert wallet()['entries'][-1]['category']=='반려동물'
 index=count();open_record('펫마트','반려동물 사료');wait_count(index+1);assert page.evaluate('window.testAIRequests.at(-1).input.customCategories')==['반려동물']
 respond(index,'반려동물');expect(page.locator('#category-mode-badge')).to_have_text('AI');expect(page.locator('#category-suggestion')).to_be_hidden();save()
 propose('중고판매','income');expect(page.locator('#category-options option[value="반려동물"]')).to_have_count(0);page.locator('#accept-category-suggestion').click();save()
 assert wallet()['entries'][-1]['type']=='income';assert len(wallet()['settings']['customCategories'])==2
 page.reload();expect(page.locator('#app-shell')).to_be_visible();open_record('다른 상점','새 상품');expect(page.locator('#ai-category-enabled')).to_have_count(0);wait_count(1);reject(0,'ai/api-not-enabled');expect(page.locator('#ai-category-retry')).to_be_visible()
 assert any(e.get('categorySource')=='ai' for e in wallet()['entries'])
 expect(page.locator('#category-options option[value="반려동물"]')).to_have_count(1);expect(page.locator('#category-options option[value="중고판매"]')).to_have_count(0)
 Path('artifacts').mkdir(exist_ok=True);page.locator('#toast').evaluate("el=>el.classList.remove('visible')")
 for width in [320,375,390,430,768,1024,1440]:
  page.set_viewport_size({'width':width,'height':1000});page.locator('#ai-category-disclosure').scroll_into_view_if_needed();assert form.evaluate('el=>el.scrollWidth<=el.clientWidth'),f'AI form overflow {width}'
  page.screenshot(path=f'artifacts/ai-classification-{width}.png',full_page=True)
 assert not errors,errors
 print(json.dumps({'status':'passed','AI':'simulated model adapter; no real Gemini call','checks':['automatic AI without a toggle','minimal payload','AI badge and save','manual correction wins','stale text and dialog responses','setup error','explicit retry','save flush','transfer exclusion','invalid output fallback','income','remembered rule priority','account isolation','new category confirmation','reject suggestion','cancel pending addition','confirmed category reuse','separate income categories','reload','responsive form'],'viewports':[320,375,390,430,768,1024,1440]}))
 browser.close()
