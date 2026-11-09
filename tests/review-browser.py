"""Review UI with local test records; no real account or AI requests."""
import calendar
import json
import os
from datetime import datetime,timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright,expect
BASE_URL=os.environ.get('BASE_URL','http://127.0.0.1:4173/dear-wallet/').rstrip('/')+'/'
TODAY=datetime.now(ZoneInfo('Asia/Seoul')).date()
PREVIOUS=TODAY.replace(day=1)-timedelta(days=1)
def empty():return {'version':1,'settings':{'periodMode':'calendar','payday':25},'budgets':{},'fixedCosts':[],'entries':[],'bookmarks':[]}
def entry(id,kind,amount,category='',date=None,**extra):return {'id':id,'type':kind,'amount':amount,'category':category,'date':str(date or TODAY),'merchant':id,'reason':'','fixedId':None,'categorySource':'manual',**extra}
state=empty();state['entries']=[entry('점심-1','expense',12000,'식비'),entry('점심-2','expense',18000,'식비'),entry('친구에게 송금','expense',10000,'식비'),entry('반려용품','expense',20000,'반려동물'),entry('모르는 가게','expense',1000),entry('월급','income',2000000,'급여'),entry('이자','income',5000,'이자'),entry('내 계좌 이동','transfer',9999999,'내부 이체'),entry('삭제한 기록','expense',33333,'의료',deletedAt=str(TODAY)+'T12:00:00Z'),entry('이전 기간 기록','expense',500,'교육',date=PREVIOUS),entry('미래 기록','expense',999990,'교육',date=TODAY+timedelta(days=1))]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 page.goto(BASE_URL+'#review');page.locator('#legacy-entry').click();expect(page.locator('#review-view')).to_be_visible();expect(page.locator('#home-view')).to_be_hidden();expect(page.locator('#history-view')).to_be_hidden()
 expect(page.locator('#review-total-expense')).to_have_text('0원');expect(page.locator('#review-expense-empty')).to_be_visible();expect(page.locator('#review-income-empty')).to_be_visible();assert 'NaN' not in page.locator('#review-view').inner_text()
 def seed(value):page.evaluate('value=>localStorage.setItem("dear-wallet.v1",JSON.stringify(value))',value);page.reload();expect(page.locator('#review-view')).to_be_visible()
 def nav(view):page.locator('.bottom-nav [data-nav='+view+']' if page.viewport_size['width']<700 else '.desktop-nav [data-nav='+view+']').click()
 seed(state);expect(page.locator('#review-total-expense')).to_have_text('61,000원');expect(page.locator('#review-total-income')).to_have_text('2,005,000원');expect(page.locator('#review-net')).to_have_text('1,944,000원')
 expect(page.locator('#review-expense-rows tr')).to_have_count(3);expect(page.locator('#review-income-rows tr')).to_have_count(2);expect(page.locator('#review-expense-rows')).to_contain_text('65.6%');expect(page.locator('#review-expense-rows')).to_contain_text('미분류');expect(page.locator('#review-expense-rows')).to_contain_text('반려동물')
 expect(page.locator('#review-expense-chart circle')).to_have_count(1);expect(page.locator('#review-expense-chart path[role=button]')).to_have_count(3);expect(page.locator('#review-next')).to_be_disabled()
 Path('artifacts').mkdir(exist_ok=True)
 for width in [320,375,390,430,768,1024,1440]:
  page.set_viewport_size({'width':width,'height':1000});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),f'Review overflow {width}'
  page.screenshot(path=f'artifacts/review-{width}.png',full_page=True)
 page.set_viewport_size({'width':390,'height':844});nav('home');expect(page.locator('#spent')).to_have_text('61,000원');nav('review')
 page.locator('#review-prev').click();expect(page.locator('#review-total-expense')).to_have_text('500원');expect(page.locator('#review-total-income')).to_have_text('0원');expect(page.locator('#review-income-empty')).to_be_visible();expect(page.locator('#review-next')).to_be_enabled()
 page.locator('#review-next').click();expect(page.locator('#review-total-expense')).to_have_text('61,000원');expect(page.locator('#review-next')).to_be_disabled();page.reload();expect(page.locator('#review-view')).to_be_visible()
 # Record edits and deletion from history must immediately update the review.
 nav('history');page.locator(f'[data-date="{TODAY}"]').click();page.locator('#day-entries button').filter(has=page.get_by_text('점심-1',exact=True)).click();form=page.locator('#record-form');form.locator('[name=amount]').fill('22000');form.get_by_role('button',name='수정 저장하기').click();expect(page.locator('#day-dialog')).to_be_visible();page.locator('#day-dialog [data-close]').click();nav('review');expect(page.locator('#review-total-expense')).to_have_text('71,000원')
 nav('history');page.locator(f'[data-date="{TODAY}"]').click();page.locator('#day-entries button').filter(has=page.get_by_text('반려용품',exact=True)).click();page.locator('#delete-record').click();page.locator('#confirm-delete').click();expect(page.locator('#day-dialog')).to_be_visible();page.locator('#day-dialog [data-close]').click();nav('review');expect(page.locator('#review-total-expense')).to_have_text('51,000원');expect(page.locator('#review-expense-rows')).not_to_contain_text('반려동물')
 # The review's own record action uses the same save flow.
 page.locator('.review-record').click();form.locator('[name=type]').select_option('income');form.locator('[name=amount]').fill('5000');form.locator('[name=merchant]').fill('급여 추가');form.get_by_role('button',name='기록 저장하기').click();expect(page.locator('#review-total-income')).to_have_text('2,010,000원')
 # Changing the month basis resets a historical selection and follows payday settings.
 page.locator('#review-prev').click();page.locator('.topbar [data-open=settings]').click();page.locator('#settings-form [name=periodMode]').select_option('payday');page.locator('#settings-form [name=payday]').select_option('25');page.get_by_role('button',name='설정 저장하기').click()
 expect(page.locator('#review-period-basis')).to_contain_text('월급날 기준');expect(page.locator('#review-next')).to_be_disabled();expect(page.locator('#review-total-expense')).to_have_text('51,500원' if TODAY.day<25 else '51,000원')
 # More than six categories group without losing money; large and unsafe labels stay safe.
 many=empty();many['entries']=[entry('항목'+str(i),'expense',999999999999 if i==0 else i+1,'아주긴카테고리이름을직접추가해서사용하는경우에도확인해볼게요' if i==0 else '항목'+str(i)) for i in range(10)]
 many['entries']+=[entry('수입'+str(i),'income',100*(i+1),'수입 항목'+str(i)) for i in range(8)]
 many['entries'].append(entry('안전한 문자열','expense',1,'<img src=x onerror="window.reviewInjected=true">'))
 seed(many);before=page.evaluate('localStorage.getItem("dear-wallet.v1")');expect(page.locator('#review-expense-rows tr')).to_have_count(6);expect(page.locator('#review-income-rows tr')).to_have_count(6);expect(page.locator('#review-net')).to_have_class('review-negative')
 page.locator('#review-expense-expand').click();expect(page.locator('#review-expense-rows tr')).to_have_count(11);expect(page.locator('#review-income-rows tr')).to_have_count(6);expect(page.locator('#review-expense-rows img')).to_have_count(0);assert not page.evaluate('window.reviewInjected||false')
 page.locator('#review-income-expand').click();expect(page.locator('#review-income-rows tr')).to_have_count(8);expect(page.locator('#review-expense-expand')).to_have_attribute('aria-expanded','true');expect(page.locator('#review-expense-rows')).to_contain_text('999,999,999,999원')
 for width in [320,375,390,430,768,1024,1440]:
  page.set_viewport_size({'width':width,'height':1000});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),f'Large review overflow {width}';assert page.locator('#review-view').evaluate('el=>el.scrollWidth<=el.clientWidth'),f'Chart overflow {width}'
  page.screenshot(path=f'artifacts/review-large-{width}.png',full_page=True)
 page.locator('#review-prev').click();page.locator('#review-today').click();assert page.evaluate('localStorage.getItem("dear-wallet.v1")')==before
 assert not errors,errors
 print(json.dumps({'status':'passed','data':'isolated local fixtures; no account or AI calls','checks':['empty charts','summary and two charts','transfer/deletion/future exclusion','missing/custom categories','period selection','hash reload','home totals agree','edits and deletion refresh charts','record from review','payday settings','independent category expansion','large exact amounts','safe category labels','read-only navigation','responsive review'],'viewports':[320,375,390,430,768,1024,1440]}))
 browser.close()
