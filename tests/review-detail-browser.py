"""Category drilldown and edit return flow, using isolated local data only."""
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
state=empty();state['entries']=[entry('점심 A','expense',12000,'식비',date=TODAY.replace(day=1),description='반숙란과 도시락',reason='출근 점심'),entry('점심 B','expense',18000,'식비'),entry('커피','expense',5000,'카페'),entry('월급','income',100000,'급여'),entry('수입 같은 이름','income',7000,'식비'),entry('내 계좌 이동','transfer',999999,'식비'),entry('이전 기간','expense',9000,'식비',date=PREVIOUS),entry('삭제한 기록','expense',8000,'식비',deletedAt=str(TODAY)+'T12:00:00Z'),entry('미래 기록','expense',9999,'식비',date=TODAY+timedelta(days=1))]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 page.add_init_script('sessionStorage.setItem("dear-wallet.local-mode","legacy")');page.goto(BASE_URL+'#review');expect(page.locator('#review-view')).to_be_visible()
 sheet=page.locator('#review-detail-dialog');form=page.locator('#record-form');records=page.locator('#review-detail-entries button')
 def seed(value):
  page.evaluate('value=>localStorage.setItem("dear-wallet.v1",JSON.stringify(value))',value);page.reload();expect(page.locator('#review-view')).to_be_visible()
 def category(name,kind='expense'):
  return page.locator(f'#review-{kind}-rows button').filter(has=page.get_by_text(name,exact=True))
 def open_category(name,kind='expense'):
  category(name,kind).click();expect(sheet).to_be_visible()
 def close():sheet.locator('[data-close]').click();expect(sheet).not_to_be_visible()
 def edit(id):
  page.locator(f'#review-detail-entries [data-entry-id="{id}"]').click();expect(page.locator('#record-dialog')).to_be_visible();expect(sheet).not_to_be_visible()
 def save():form.get_by_role('button',name='수정 저장하기').click();expect(sheet).to_be_visible();expect(page.locator('#record-dialog')).not_to_be_visible()
 def choose(name):page.locator('#category-toggle').click();page.locator('#category-options').get_by_role('button',name=name,exact=True).click()
 def tap_arc(index=0,kind='expense'):
  arc=page.locator(f'#review-{kind}-chart path[role=button]').nth(index);arc.evaluate("el=>el.closest('svg').scrollIntoView({block:'center',behavior:'instant'})")
  point=arc.evaluate('el=>{const p=el.getPointAtLength(el.getTotalLength()/2);const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y}}')
  page.mouse.click(point['x'],point['y']);expect(sheet).to_be_visible()
 Path('artifacts').mkdir(exist_ok=True)
 seed(state);before=page.evaluate('localStorage.getItem("dear-wallet.v1")')
 # Real taps on different arcs must open their own category, not an overlaid SVG path.
 tap_arc();expect(page.locator('#review-detail-title')).to_have_text('식비 지출 내역');expect(records).to_have_count(2);expect(page.locator('#review-detail-total')).to_have_text('30,000원')
 page.screenshot(path='artifacts/review-detail-food.png');assert records.evaluate_all('els=>els.map(e=>e.dataset.entryId)')==['점심 B','점심 A'];expect(sheet).to_contain_text('반숙란과 도시락');expect(sheet).to_contain_text('출근 점심');close()
 tap_arc(1);expect(page.locator('#review-detail-title')).to_have_text('카페 지출 내역');expect(records).to_have_count(1);close()
 # Keyboard, full-row taps, focus return, and read-only opening.
 arc=page.locator('#review-expense-chart path').first;arc.focus();page.keyboard.press('Enter');expect(sheet).to_be_visible();page.keyboard.press('Escape');expect(sheet).not_to_be_visible();expect(arc).to_be_focused()
 arc.focus();page.keyboard.press('Space');expect(sheet).to_be_visible();close()
 category('식비').focus();page.keyboard.press('Enter');expect(sheet).to_be_visible();page.keyboard.press('Escape');expect(category('식비')).to_be_focused()
 page.locator('#review-expense-rows tr[data-category="카페"] .review-category-amount').click();expect(sheet).to_be_visible();expect(page.locator('#review-detail-title')).to_have_text('카페 지출 내역');close();assert page.evaluate('localStorage.getItem("dear-wallet.v1")')==before
 # Saving and cancelling preserve category context; the chart and sums refresh together.
 open_category('식비');edit('점심 B');form.locator('[name=amount]').fill('28000');save();expect(page.locator('#review-detail-total')).to_have_text('40,000원');expect(page.locator('#review-total-expense')).to_have_text('45,000원');expect(category('식비')).to_have_attribute('aria-label','식비 지출 40,000원, 88.9%, 내역 보기')
 edit('점심 B');form.locator('[name=amount]').fill('1');form.locator('[data-close]').click();expect(sheet).to_be_visible();expect(page.locator('#review-detail-total')).to_have_text('40,000원')
 edit('점심 B');choose('생활용품');save();expect(records).to_have_count(1);expect(page.locator('#review-detail-total')).to_have_text('12,000원')
 edit('점심 A');form.locator('[name=type]').select_option('income');choose('급여');save();expect(records).to_have_count(0);expect(page.locator('#review-detail-empty')).to_be_visible();expect(page.locator('#review-detail-total')).to_have_text('0원');close();expect(page.locator('#review-expense-title')).to_be_focused()
 # Changing the date removes the entry from the captured period.
 seed(state);open_category('카페');edit('커피');form.locator('[name=date]').fill(str(PREVIOUS));save();expect(records).to_have_count(0);expect(page.locator('#review-detail-empty')).to_be_visible();close()
 # Delete the final entry and undo from the empty detail sheet.
 seed(state);open_category('카페');edit('커피');page.locator('#delete-record').click();page.locator('#confirm-delete').click();expect(sheet).to_be_visible();expect(records).to_have_count(0);expect(sheet.locator('[data-undo-notice]')).to_be_visible();expect(page.locator('#review-total-expense')).to_have_text('30,000원')
 sheet.locator('[data-undo]').click();expect(records).to_have_count(1);expect(page.locator('#review-detail-total')).to_have_text('5,000원');expect(page.locator('#review-total-expense')).to_have_text('35,000원');expect(sheet.locator('[data-undo-notice]')).to_be_hidden();close()
 # An income category stays separate even if expenses have the same label.
 open_category('식비','income');expect(page.locator('#review-detail-total')).to_have_text('7,000원');expect(records).to_have_count(1);edit('수입 같은 이름');expect(page.locator('#record-merchant-label')).to_have_text('입금처');form.locator('[data-close]').click();expect(sheet).to_be_visible();close()
 # A normal new-record action must not reopen the previous detail sheet.
 page.locator('.review-record').click();form.locator('[data-close]').click();expect(sheet).not_to_be_visible()
 # Historical detail edits return to the selected historical period.
 page.locator('#review-prev').click();period=page.locator('#review-period-label').inner_text();open_category('식비');edit('이전 기간');form.locator('[name=amount]').fill('10000');save();expect(page.locator('#review-detail-total')).to_have_text('10,000원');expect(page.locator('#review-period-label')).to_have_text(period);expect(page.locator('#review-detail-period')).to_have_text(period);close()
 # Combined groups retain their original membership while an edit changes chart ranking.
 many=empty();many['entries']=[entry('항목'+str(i),'expense',100-i,'항목'+str(i)) for i in range(8)];seed(many);open_category('나머지 3개');expect(records).to_have_count(3);expect(page.locator('#review-detail-total')).to_have_text('282원')
 edit('항목7');form.locator('[name=amount]').fill('1000');save();expect(records).to_have_count(3);expect(page.locator('#review-detail-total')).to_have_text('1,189원');assert set(records.evaluate_all('els=>els.map(e=>e.dataset.entryId)'))=={'항목5','항목6','항목7'};close()
 page.locator('#review-expense-expand').click();open_category('항목7');expect(records).to_have_count(1);expect(page.locator('#review-detail-total')).to_have_text('1,000원');close()
 # A full-circle 100% arc is interactive, with exact large amounts and safe wrapping.
 large=empty();label='아주길게직접지은카테고리이름도잘리지않고읽을수있어야해요';merchant='<img src=x onerror="window.injected=true"> '+('아주 긴 사용처 이름 '*5)
 large['entries']=[entry('large','income',999999999999,label,merchant=merchant,description='설명 '*40,reason='입금 경위 '*30)]
 seed(large);tap_arc(kind='income');expect(records).to_have_count(1);expect(page.locator('#review-detail-total')).to_have_text('999,999,999,999원');expect(sheet.locator('img')).to_have_count(0);assert not page.evaluate('window.injected||false')
 Path('artifacts').mkdir(exist_ok=True)
 for width in [320,375,390,430,768,1024,1440]:
  page.set_viewport_size({'width':width,'height':1000});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),f'Page overflow {width}';assert sheet.evaluate('el=>el.scrollWidth<=el.clientWidth'),f'Sheet overflow {width}';assert records.evaluate('el=>el.scrollWidth<=el.clientWidth'),f'Entry overflow {width}'
  page.screenshot(path=f'artifacts/review-detail-{width}.png')
 close();assert not errors,errors
 print(json.dumps({'status':'passed','data':'isolated local fixtures; no account or AI calls','checks':['physical arc taps','100% arc','keyboard and focus return','category and period filtering','newest first','description and reason','read-only opening','edit/cancel return','amount and chart refresh','type/category/date changes','delete last and undo','income fields','new-record independence','historical period retention','stable combined membership','exact large amounts','safe labels','responsive sheet'],'viewports':[320,375,390,430,768,1024,1440]}))
 browser.close()
