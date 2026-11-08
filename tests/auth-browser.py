"""UI integration with a simulated Firebase adapter. Does not authenticate a real Google account."""
import json
import os
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
TODAY=datetime.now(ZoneInfo("Asia/Seoul")).date().isoformat()
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
BASE_URL=os.environ.get('BASE_URL','http://127.0.0.1:4173/dear-wallet/').rstrip('/')+'/'
CONFIG="export const FIREBASE_CONFIG={apiKey:'test-public-key',authDomain:'demo.example.test',projectId:'demo-wallet-test',appId:'demo-app'};"
PROVIDER='''export async function createFirebaseProvider(){let callback;
const user=uid=>({uid,email:uid+'@example.test',displayName:uid==='alice'?'테스트 사용자':'다른 사용자'});
const request=async(uid,suffix='',body)=>{const r=await fetch(new URL('./__auth_test__/'+uid+suffix,location.href),{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Object.assign(new Error('denied'),{code:'permission-denied'});return r.json()};
return {subscribe(fn){callback=fn;queueMicrotask(()=>fn(localStorage.getItem('test.session')?user(localStorage.getItem('test.session')):null));return()=>{};},
signIn(){if(window.testLoginError)return Promise.reject(Object.assign(new Error('test'),{code:window.testLoginError}));const uid=window.testNextUser||'alice';localStorage.setItem('test.session',uid);if(!window.testSkipAuthEvent)queueMicrotask(()=>callback(user(uid)));return Promise.resolve({user:user(uid)});},
signOut(){localStorage.removeItem('test.session');callback(null);return Promise.resolve();},read:uid=>request(uid),write:(uid,patches)=>request(uid,'/write',{patches}),completeOnboarding:(uid,settings)=>request(uid,'/setup',{settings})};}'''
def empty():return {'version':1,'settings':{'periodMode':'calendar','payday':25},'budgets':{},'fixedCosts':[],'entries':[],'bookmarks':[]}
def fixture(name,amount):
 s=empty();s['entries']=[{'id':name,'type':'expense','amount':amount,'merchant':name,'date':TODAY,'category':'식비','reason':'','fixedId':None}];return {'state':s,'onboardingComplete':True}
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
 users={'alice':fixture('alice-only',10000),'bob':fixture('bob-only',23000),'new-user':{'state':empty(),'onboardingComplete':False}};errors=[];deny={'active':False}
 def endpoint(route):
  if deny['active']:route.fulfill(status=403,json={'error':'permission denied'});return
  parts=urlparse(route.request.url).path.split('/__auth_test__/')[1].split('/');uid=parts[0]
  record=users.setdefault(uid,{'state':empty(),'onboardingComplete':False})
  if route.request.method=='POST':
   data=route.request.post_data_json
   if parts[-1]=='setup':record['onboardingComplete']=True;record['state']['settings']=data['settings']
   else:
    for patch in data['patches']:
     table,key,value=patch['table'],patch['key'],patch['value'];state=record['state']
     if table=='entries':state['entries']=[e for e in state['entries'] if e['id']!=key]+[value]
     elif table=='budgets':
      if value is None:state['budgets'].pop(key,None)
      else:state['budgets'][key]=value
     elif table=='fixedCosts':state['fixedCosts']=[f for f in state['fixedCosts'] if f['id']!=key]+([value] if value else [])
     elif table=='settings':
      if key=='bookmarks':state['bookmarks']=value
      else:state['settings'][key]=value
  route.fulfill(json=record)
 def setup(context):
  context.route('**/src/firebase-config.js',lambda route:route.fulfill(content_type='text/javascript',body=CONFIG))
  context.route('**/src/firebase-provider.js',lambda route:route.fulfill(content_type='text/javascript',body=PROVIDER))
  context.route('**/__auth_test__/**',endpoint)
  context.on('page',lambda page:page.on('pageerror',lambda error:errors.append(str(error))))
 # Simulate a missing configuration to verify the recovery path; production now has real public config.
 raw=browser.new_page(viewport={'width':375,'height':812});raw.route('**/src/firebase-config.js',lambda route:route.fulfill(content_type='text/javascript',body='export const FIREBASE_CONFIG=null;'));raw.goto(BASE_URL)
 expect(raw.locator('#login-view')).to_be_visible();expect(raw.locator('#app-shell')).to_be_hidden();raw.locator('#google-sign-in').click();expect(raw.locator('#login-status')).to_contain_text('설정이 아직 완료')
 raw.locator('#preview-app').click();expect(raw.locator('#app-shell')).to_be_visible();expect(raw.locator('#ring-value')).to_have_text('62%');raw.locator('#exit-demo').click();expect(raw.locator('#login-view')).to_be_visible()
 raw.locator('#toast').evaluate("el=>el.classList.remove('visible')")
 Path('artifacts').mkdir(exist_ok=True)
 for width in [320,375,390,430,768,1024,1440]:
  raw.set_viewport_size({'width':width,'height':1000});assert raw.evaluate('document.documentElement.scrollWidth<=innerWidth'),f'Login overflow {width}'
  raw.screenshot(path=f'artifacts/login-{width}.png',full_page=True)
 context=browser.new_context(viewport={'width':390,'height':844});setup(context);page=context.new_page();page.goto(BASE_URL+'#home')
 expect(page.locator('#login-view')).to_be_visible();expect(page.locator('#google-sign-in')).to_be_enabled();expect(page.locator('#app-shell')).to_be_hidden()
 # Cancellation and blocked popup leave the home protected.
 page.evaluate("window.testLoginError='auth/popup-closed-by-user'");page.locator('#google-sign-in').click();expect(page.locator('#login-status')).to_contain_text('취소');expect(page.locator('#app-shell')).to_be_hidden()
 page.evaluate("window.testLoginError='auth/popup-blocked'");page.locator('#google-sign-in').click();expect(page.locator('#login-status')).to_contain_text('차단');expect(page.locator('#app-shell')).to_be_hidden()
 page.evaluate('window.testLoginError=null');page.locator('#google-sign-in').click();expect(page.locator('#app-shell')).to_be_visible();expect(page.locator('#login-view')).to_be_hidden();expect(page.locator('#spent')).to_have_text('10,000원')
 page.locator('.bottom-nav [data-nav=review]').click();expect(page.locator('#review-view')).to_be_visible();expect(page.locator('#review-total-expense')).to_have_text('10,000원');page.locator('.bottom-nav [data-nav=home]').click()
 # Session restoration opens the same account directly.
 page.reload();expect(page.locator('#app-shell')).to_be_visible();expect(page.locator('#spent')).to_have_text('10,000원')
 page.locator('.topbar [data-open=settings]').click();expect(page.locator('#account-email')).to_have_text('alice@example.test');page.locator('#session-sign-out').click();expect(page.locator('#login-view')).to_be_visible();expect(page.locator('#app-shell')).to_be_hidden()
 expect(page.locator('#review-total-expense')).to_have_text('0원');expect(page.locator('#review-expense-rows tr')).to_have_count(0)
 # Another account must never see Alice's local cache or remote records.
 page.evaluate("window.testNextUser='bob'");page.locator('#google-sign-in').click();expect(page.locator('#spent')).to_have_text('23,000원');expect(page.locator('#app-shell')).to_be_visible()
 page.locator('.bottom-nav [data-nav=review]').click();expect(page.locator('#review-total-expense')).to_have_text('23,000원');page.locator('.bottom-nav [data-nav=home]').click()
 page.locator('.mobile-record').click();form=page.locator('#record-form');form.locator('[name=amount]').fill('2000');form.locator('[name=merchant]').fill('bob new');form.get_by_role('button',name='기록 저장하기').click();expect(page.locator('#account-sync-text')).to_have_text('계정에 저장 완료',timeout=15000)
 assert len(users['alice']['state']['entries'])==1;assert len(users['bob']['state']['entries'])==2
 page.locator('.topbar [data-open=settings]').click();page.locator('#session-sign-out').click();page.evaluate("window.testNextUser='new-user'");page.locator('#google-sign-in').click();expect(page.locator('#onboarding-view')).to_be_visible();expect(page.locator('#app-shell')).to_be_hidden()
 page.locator('#onboarding-form [name=periodMode]').select_option('payday');page.locator('#onboarding-form [name=payday]').select_option('25');page.locator('#onboarding-submit').click();expect(page.locator('#app-shell')).to_be_visible();expect(page.locator('#spent')).to_have_text('0원');assert users['new-user']['state']['settings']['payday']==25
 page.reload();expect(page.locator('#app-shell')).to_be_visible();expect(page.locator('#onboarding-view')).to_be_hidden()
 # The private home must stay hidden when cloud data cannot be loaded.
 page.locator('.topbar [data-open=settings]').click();page.locator('#session-sign-out').click();deny['active']=True;page.evaluate("window.testNextUser='alice'");page.locator('#google-sign-in').click();expect(page.locator('#login-status')).to_contain_text('접근');expect(page.locator('#app-shell')).to_be_hidden();expect(page.locator('#retry-account')).to_be_visible();deny['active']=False;page.locator('#retry-account').click();expect(page.locator('#app-shell')).to_be_visible();expect(page.locator('#spent')).to_have_text('10,000원')
 page.locator('.topbar [data-open=settings]').click();page.locator('#session-sign-out').click();page.evaluate("window.testSkipAuthEvent=true;window.testNextUser='alice'");page.locator('#google-sign-in').click();expect(page.locator('#app-shell')).to_be_visible();expect(page.locator('#spent')).to_have_text('10,000원')
 slow_context=browser.new_context(viewport={'width':390,'height':844});setup(slow_context)
 slow_context.route('**/src/firebase-provider.js',lambda route:route.fulfill(content_type='text/javascript',body=PROVIDER.replace('let callback;','await new Promise(resolve=>setTimeout(resolve,700));let callback;')))
 slow=slow_context.new_page();slow.goto(BASE_URL);slow.locator('#loading-legacy-entry').click();expect(slow.locator('#app-shell')).to_be_visible();slow.wait_for_timeout(1000);expect(slow.locator('#app-shell')).to_be_visible();expect(slow.locator('#login-view')).to_be_hidden()
 assert not errors,errors
 print(json.dumps({'status':'passed','authentication':'simulated Firebase adapter; no real Google account used','checks':['unconfigured state','demo and return','login cancel','popup blocked','login to home','session restoration','logout','account isolation','review clears private totals and categories','account save','first-login onboarding to home','cloud denial keeps home hidden','retry','sign-in result without duplicate auth event','late SDK initialization preserves local mode'],'viewports':[320,375,390,430,768,1024,1440]}))
 browser.close()
