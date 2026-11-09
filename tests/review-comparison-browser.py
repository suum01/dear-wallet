"""Period comparisons and two-sided category details with isolated local fixtures."""
import calendar
import json
import os
from datetime import datetime,timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright,expect
BASE_URL=os.environ.get('BASE_URL','http://127.0.0.1:4173/dear-wallet/').rstrip('/')+'/'
TODAY=datetime.now(ZoneInfo('Asia/Seoul')).date();START=TODAY.replace(day=1);PRIOR_LAST=START-timedelta(days=1);PRIOR_START=PRIOR_LAST.replace(day=1);PRIOR_END=PRIOR_LAST.replace(day=min(TODAY.day,PRIOR_LAST.day));OLDER=PRIOR_START-timedelta(days=1)
def empty():return {'version':1,'settings':{'periodMode':'calendar','payday':25},'budgets':{},'fixedCosts':[],'entries':[],'bookmarks':[]}
def entry(id,kind,amount,category='',date=None,**extra):return {'id':id,'type':kind,'amount':amount,'category':category,'date':str(date or TODAY),'merchant':id,'reason':'','fixedId':None,'categorySource':'manual',**extra}
def dates(start,end):return f'{str(start).replace("-",".")} — {str(end).replace("-",".")}'
state=empty();state['entries']=[entry('이번 식사','expense',30000,'식비'),entry('이전 식사','expense',10000,'식비',PRIOR_END),entry('이번 커피','expense',5000,'카페'),entry('이전 커피','expense',15000,'카페',PRIOR_END),entry('이전 쇼핑','expense',20000,'쇼핑',PRIOR_END),entry('이번 생필품','expense',9000,'생활용품'),entry('이전 생필품','expense',1000,'생활용품',PRIOR_END),entry('이번 교통','expense',7000,'교통'),entry('이전 교통','expense',1000,'교통',PRIOR_END),entry('이번 교육','expense',6000,'교육'),entry('이전 교육','expense',1000,'교육',PRIOR_END),entry('이번 월급','income',1000000,'급여'),entry('이전 월급','income',2000000,'급여',PRIOR_END),entry('내 계좌','transfer',99999999,'식비'),entry('삭제한 지출','expense',777777,'식비',deletedAt=str(TODAY)+'T12:00:00Z'),entry('미래 지출','expense',888888,'식비',TODAY+timedelta(days=1)),entry('두 기간 전','expense',2000,'카페',OLDER)]
if PRIOR_END<PRIOR_LAST:state['entries'].append(entry('이전 구간 밖','expense',99999,'식비',PRIOR_END+timedelta(days=1)))
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda error:errors.append(str(error)));page.add_init_script('sessionStorage.setItem("dear-wallet.local-mode","legacy")');page.goto(BASE_URL+'#review');expect(page.locator('#review-view')).to_be_visible()
 sheet=page.locator('#review-detail-dialog');form=page.locator('#record-form');sides=page.locator('#review-detail-sides');records=page.locator('#review-detail-entries button');current=page.locator('[data-review-detail-side=current]');previous=page.locator('[data-review-detail-side=previous]')
 def seed(value):page.evaluate('value=>localStorage.setItem("dear-wallet.v1",JSON.stringify(value))',value);page.reload();expect(page.locator('#review-view')).to_be_visible()
 def change(name,group):return page.locator(f'#review-compare-{group} button').filter(has=page.get_by_text(name,exact=True))
 def open_change(name,group):change(name,group).click();expect(sheet).to_be_visible();expect(sides).to_be_visible()
 def close():sheet.locator('[data-close]').click();expect(sheet).not_to_be_visible()
 def edit(id):page.locator(f'#review-detail-entries [data-entry-id="{id}"]').click();expect(page.locator('#record-dialog')).to_be_visible()
 def save():form.get_by_role('button',name='수정 저장하기').click();expect(sheet).to_be_visible();expect(page.locator('#record-dialog')).not_to_be_visible()
 seed(state);before=page.evaluate('localStorage.getItem("dear-wallet.v1")')
 expect(page.locator('#review-compare-current-range')).to_have_text(dates(START,TODAY));expect(page.locator('#review-compare-previous-range')).to_have_text(dates(PRIOR_START,PRIOR_END));expect(page.locator('#review-compare-basis')).to_contain_text('같은 경과일')
 expect(page.locator('#review-compare-expense-current')).to_have_text('57,000원');expect(page.locator('#review-compare-expense-previous')).to_have_text('48,000원');expect(page.locator('#review-compare-expense-change')).to_have_text('9,000원 증가 · 18.8%');expect(page.locator('#review-compare-income-change')).to_have_text('1,000,000원 감소 · 50%');expect(page.locator('#review-compare-no-baseline')).to_be_hidden()
 expect(page.locator('#review-compare-increase button')).to_have_count(3);assert page.locator('#review-compare-increase .review-change-category strong').all_text_contents()==['식비','생활용품','교통'];assert page.locator('#review-compare-decrease .review-change-category strong').all_text_contents()==['쇼핑','카페']
 Path('artifacts').mkdir(exist_ok=True)
 for width in [320,390,768,1024,1440]:
  page.set_viewport_size({'width':width,'height':1000});page.locator('#review-compare-title').evaluate("el=>el.scrollIntoView({block:'start',behavior:'instant'})");assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert page.locator('.review-comparison').evaluate('el=>el.scrollWidth<=el.clientWidth');page.screenshot(path=f'artifacts/review-comparison-{width}.png')
 page.set_viewport_size({'width':390,'height':844})
 # Accessible buttons open two exact, independently filtered windows.
 change('식비','increase').focus();page.keyboard.press('Enter');expect(sheet).to_be_visible();expect(current).to_have_attribute('aria-pressed','true');expect(page.locator('#review-detail-period')).to_have_text(dates(START,TODAY));expect(page.locator('#review-detail-total')).to_have_text('30,000원');expect(records).to_have_count(1)
 previous.click();expect(previous).to_have_attribute('aria-pressed','true');expect(page.locator('#review-detail-period')).to_have_text(dates(PRIOR_START,PRIOR_END));expect(page.locator('#review-detail-total')).to_have_text('10,000원');expect(records).to_have_count(1);expect(records).to_contain_text('이전 식사')
 page.keyboard.press('Escape');expect(sheet).not_to_be_visible();expect(change('식비','increase')).to_be_focused();assert page.evaluate('localStorage.getItem("dear-wallet.v1")')==before
 # Editing a previous-side record preserves side and period even when its category changes ranking.
 open_change('식비','increase');previous.click();edit('이전 식사');form.locator('[name=amount]').fill('40000');save();expect(previous).to_have_attribute('aria-pressed','true');expect(page.locator('#review-detail-total')).to_have_text('40,000원');expect(page.locator('#review-compare-expense-previous')).to_have_text('78,000원');expect(page.locator('#review-compare-expense-change')).to_have_text('21,000원 감소 · 26.9%');expect(change('식비','decrease')).to_have_count(1)
 # Cancel and deletion return to the same side; undo refreshes comparison and detail together.
 edit('이전 식사');form.locator('[name=amount]').fill('1');form.locator('[data-close]').click();expect(sheet).to_be_visible();expect(previous).to_have_attribute('aria-pressed','true');expect(page.locator('#review-detail-total')).to_have_text('40,000원')
 edit('이전 식사');page.locator('#delete-record').click();page.locator('#confirm-delete').click();expect(sheet).to_be_visible();expect(page.locator('#review-detail-empty')).to_be_visible();expect(page.locator('#review-compare-expense-previous')).to_have_text('38,000원');sheet.locator('[data-undo]').click();expect(page.locator('#review-detail-total')).to_have_text('40,000원');expect(page.locator('#review-compare-expense-previous')).to_have_text('78,000원')
 edit('이전 식사');page.locator('#category-toggle').click();page.locator('#category-options').get_by_role('button',name='카페',exact=True).click();save();expect(records).to_have_count(0);current.click();expect(page.locator('#review-detail-total')).to_have_text('30,000원');close();expect(change('식비','increase')).to_be_focused()
 # A disappeared category opens the previous side; the current side stays explicitly empty.
 open_change('쇼핑','decrease');expect(previous).to_have_attribute('aria-pressed','true');expect(page.locator('#review-detail-total')).to_have_text('20,000원');current.click();expect(records).to_have_count(0);expect(page.locator('#review-detail-empty')).to_be_visible();previous.click();expect(records).to_have_count(1);close()
 # Ordinary chart drilldown keeps the full selected period and has no comparison switch.
 page.locator('#review-expense-rows tr[data-category="식비"] button').click();expect(sheet).to_be_visible();expect(sides).to_be_hidden();expect(page.locator('#review-detail-period')).to_have_text(dates(START,START.replace(day=calendar.monthrange(START.year,START.month)[1])));close()
 # Completed periods use the whole period, not today's elapsed day count.
 seed(state);page.locator('#review-prev').click();expect(page.locator('#review-compare-basis')).to_have_text('완료된 기간 전체 기준');expect(page.locator('#review-compare-current-range')).to_have_text(dates(PRIOR_START,PRIOR_LAST));expect(page.locator('#review-compare-previous-range')).to_have_text(dates(OLDER.replace(day=1),OLDER));expect(page.locator('#review-compare-expense-previous')).to_have_text('2,000원')
 open_change('식비','increase');expect(page.locator('#review-detail-total')).to_have_text('109,999원' if PRIOR_END<PRIOR_LAST else '10,000원');edit('이전 식사');form.locator('[data-close]').click();expect(sheet).to_be_visible();expect(page.locator('#review-compare-current-range')).to_have_text(dates(PRIOR_START,PRIOR_LAST));close();page.locator('#review-today').click()
 # Payday windows and a shorter previous month use the same rules as the model.
 payday=empty();payday['settings']={'periodMode':'payday','payday':25};seed(payday);expected=page.evaluate("async()=>{const {comparisonModel}=await import('./src/review.js');const s=JSON.parse(localStorage.getItem('dear-wallet.v1'));return comparisonModel(s)}")
 expect(page.locator('#review-compare-current-range')).to_have_text(dates(expected['current']['period']['start'],expected['current']['period']['end']));expect(page.locator('#review-compare-previous-range')).to_have_text(dates(expected['previous']['period']['start'],expected['previous']['period']['end']));expect(page.locator('#review-compare-note')).to_contain_text(str(expected['currentDays'])+'일')
 # Explicit no-data and zero-baseline states, plus safe long user-defined labels and exact amounts.
 seed(empty());expect(page.locator('#review-compare-no-baseline')).to_be_visible();expect(page.locator('#review-compare-expense-change')).to_have_text('변화 없음');expect(page.locator('#review-compare-increase-empty')).to_be_visible();expect(page.locator('#review-compare-decrease-empty')).to_be_visible();assert 'NaN' not in page.locator('.review-comparison').inner_text();assert 'Infinity' not in page.locator('.review-comparison').inner_text()
 long=empty();label='<img src=x onerror="window.injected=true"> 아주아주긴카테고리이름';long['entries']=[entry('large','expense',999999999999,label),entry('older-large','expense',999999999998,label,PRIOR_END),entry('old-custom','expense',999999999999,'예전에만기록한아주길게만든카테고리이름을여기서도읽을수있어야해요',PRIOR_END)]
 seed(long);expect(page.locator('#review-compare-increase')).to_contain_text('1원 증가 · 0.1% 미만');expect(page.locator('#review-compare-decrease')).to_contain_text('999,999,999,999원 감소 · 100%');expect(page.locator('.review-comparison img')).to_have_count(0)
 for width in [320,375,390,430,768,1024,1440]:
  page.set_viewport_size({'width':width,'height':1000});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),f'Page overflow {width}';assert page.locator('.review-comparison').evaluate('el=>el.scrollWidth<=el.clientWidth'),f'Comparison overflow {width}';assert page.locator('#review-compare-increase button').evaluate('el=>el.scrollWidth<=el.clientWidth'),f'Button overflow {width}'
  if width in [320,1440]:page.locator('#review-compare-title').evaluate("el=>el.scrollIntoView({block:'start',behavior:'instant'})");page.screenshot(path=f'artifacts/review-comparison-large-{width}.png')
 open_change(label,'increase');expect(records).to_have_count(1);previous.click();expect(page.locator('#review-detail-total')).to_have_text('999,999,999,998원');assert sheet.evaluate('el=>el.scrollWidth<=el.clientWidth');close()
 assert not page.evaluate('window.injected||false');assert not errors,errors
 print(json.dumps({'status':'passed','data':'isolated local fixtures; no account or AI calls','checks':['same elapsed days','income and expense totals and percentages','top three changes','safe exact date windows','keyboard and focus','two-sided drilldown','edit previous side','side retained after cancel/delete/undo','ranking changes and focus fallback','previous-only category','ordinary charts unchanged','whole historical periods','payday windows','empty and zero baseline','tiny differences and exact large amounts','safe long labels','responsive comparison'],'viewports':[320,375,390,430,768,1024,1440]}))
 browser.close()
