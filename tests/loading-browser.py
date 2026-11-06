"""Loading view checks with delayed auth/account adapters; no real Google login."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
BASE_URL=os.environ.get('BASE_URL','http://127.0.0.1:4173/dear-wallet/').rstrip('/')+'/'
PROVIDER='''import {emptyState} from './domain.js';export async function createFirebaseProvider(){
await new Promise(resolve=>window.testFinishInit=resolve);
const user={uid:'loading-test',email:'loading@example.test',displayName:'로딩 테스트'};
return {subscribe(fn){window.testAuthState=fn;},signIn(){return new Promise(resolve=>window.testFinishLogin=()=>resolve({user}));},
read(){return new Promise(resolve=>window.testFinishLoad=()=>resolve({state:emptyState(),onboardingComplete:true}));},async write(){},async signOut(){window.testAuthState(null);}};}'''
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
 Path('artifacts').mkdir(exist_ok=True);errors=[]
 # Before any JS executes there is already a mascot, never a login-screen flash.
 context=browser.new_context(java_script_enabled=False,reduced_motion='reduce');static=context.new_page();static.goto(BASE_URL)
 expect(static.locator('#loading-view')).to_be_visible();expect(static.locator('#login-view')).to_be_hidden()
 for width in [320,375,390,430,768,1024,1440]:
  static.set_viewport_size({'width':width,'height':1000});static.screenshot(path=f'artifacts/loading-{width}.png',full_page=True)
 context.close()
 page=browser.new_page(viewport={'width':390,'height':844},reduced_motion='reduce');page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('**/src/firebase-provider.js',lambda route:route.fulfill(content_type='text/javascript',body=PROVIDER));page.goto(BASE_URL)
 page.wait_for_function('typeof window.testFinishInit==="function"');expect(page.locator('#loading-view')).to_be_visible();expect(page.locator('#google-sign-in')).to_be_hidden()
 assert page.locator('.loading-mascot').evaluate('el=>el.complete && el.naturalWidth>0')
 assert .6<float(page.locator('.loading-mascot').evaluate('el=>getComputedStyle(el).opacity'))<1
 page.evaluate('window.testFinishInit()');page.wait_for_function('typeof window.testAuthState==="function"');expect(page.locator('#loading-view')).to_be_visible()
 page.evaluate('window.testAuthState(null)');expect(page.locator('#login-view')).to_be_visible();expect(page.locator('#loading-view')).to_be_hidden()
 # Popup and account-read waits both use the same character screen.
 page.locator('#google-sign-in').click();expect(page.locator('#loading-view')).to_be_visible();expect(page.locator('#login-view')).to_be_hidden()
 page.evaluate('window.testFinishLogin()');page.wait_for_function('typeof window.testFinishLoad==="function"');expect(page.locator('#loading-view')).to_be_visible();expect(page.locator('#app-shell')).to_be_hidden()
 page.evaluate('window.testFinishLoad()');expect(page.locator('#app-shell')).to_be_visible();expect(page.locator('#loading-view')).to_be_hidden()
 # Restoring a signed-in account never displays the Google login page in between.
 page.reload();page.wait_for_function('typeof window.testFinishInit==="function"');page.evaluate('window.testFinishInit()');page.wait_for_function('typeof window.testAuthState==="function"')
 page.evaluate("window.testAuthState({uid:'loading-test',email:'loading@example.test'})");page.wait_for_function('typeof window.testFinishLoad==="function"');expect(page.locator('#loading-view')).to_be_visible();expect(page.locator('#login-view')).to_be_hidden()
 for width in [320,375,390,430,768,1024,1440]:
  page.set_viewport_size({'width':width,'height':1000});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),f'Loading overflow {width}'
 assert not errors,errors
 print(json.dumps({'status':'passed','authentication':'simulated delayed Firebase adapter','checks':['first paint mascot','translucent mascot only','SDK initialization wait','auth restoration wait','login popup wait','account loading wait','home transition','no Google login flash','reduced motion','responsive loading'],'viewports':[320,375,390,430,768,1024,1440]}))
 browser.close()
