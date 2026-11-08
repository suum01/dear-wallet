"""Income-aware fields and full category selection, using isolated local fixtures."""
import json
import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright,expect
BASE_URL=os.environ.get('BASE_URL','http://127.0.0.1:4173/dear-wallet/').rstrip('/')+'/'
TODAY=datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat()
LONG_EXPENSE='내가 직접 추가한 아주 긴 지출 카테고리'
LONG_INCOME='내가 직접 추가한 아주 긴 수입 카테고리'
state={'version':1,'settings':{'periodMode':'calendar','payday':25,'customCategories':[{'type':kind,'name':name,'updatedAt':'2026-11-08T12:00:00Z'} for kind,name in [('expense','반려동물'),('expense',LONG_EXPENSE),('income','중고판매'),('income',LONG_INCOME)]]},'budgets':{},'fixedCosts':[],'entries':[{'id':'old-income','type':'income','amount':7000,'date':TODAY,'merchant':'예전 회사','description':'예전 수입 내용','reason':'예전 입금 경위','category':'급여','categorySource':'manual','fixedId':None}],'bookmarks':[]}
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 page.add_init_script('localStorage.setItem("dear-wallet.v1",'+json.dumps(json.dumps(state,ensure_ascii=False))+');sessionStorage.setItem("dear-wallet.local-mode","legacy")')
 page.goto(BASE_URL);expect(page.locator('#app-shell')).to_be_visible();form=page.locator('#record-form')
 def open_record(kind='expense',merchant='스타벅스'):
  page.locator('.mobile-record' if page.viewport_size['width']<=700 else '.desktop-record').click();form.locator('[name=type]').select_option(kind);form.locator('[name=amount]').fill('5000');form.locator('[name=merchant]').fill(merchant)
 def entries():return page.evaluate('JSON.parse(localStorage.getItem("dear-wallet.v1")).entries')
 def close():form.locator('[data-close]').click()
 def choose(name):page.locator('#category-toggle').click();page.locator('#category-options').get_by_role('button',name=name,exact=True).click()
 open_record();expect(page.locator('#record-merchant-label')).to_have_text('사용처');expect(page.locator('#record-description-label')).to_have_text('내용');expect(page.locator('#record-reason-label')).to_have_text('왜 썼나요?');expect(form.locator('[name=category]')).to_have_value('카페')
 # All expense categories remain available even with an automatically filled value.
 page.locator('#category-toggle').click();expect(page.locator('#category-toggle')).to_have_attribute('aria-expanded','true');expect(page.locator('#category-options button')).to_have_count(16)
 expect(page.locator('#category-options').get_by_role('button',name='식비',exact=True)).to_be_visible();expect(page.locator('#category-options button[data-category-value="급여"]')).to_have_count(0)
 page.locator('#category-options').get_by_role('button',name='생활용품',exact=True).click();expect(form.locator('[name=category]')).to_have_value('생활용품');expect(page.locator('#category-mode-badge')).to_have_text('직접 선택');expect(page.locator('#category-options')).to_be_hidden();expect(page.locator('#remember-category-panel')).to_be_visible();assert len(entries())==1
 form.get_by_role('button',name='기록 저장하기').click();assert entries()[-1]['category']=='생활용품';assert entries()[-1]['categorySource']=='manual'
 # Arrow keys, Home/End and Enter choose without submitting; Escape only closes the list.
 open_record();form.locator('[name=category]').focus();page.keyboard.press('ArrowDown');expect(page.locator('#category-options')).to_be_visible();page.keyboard.press('End');page.keyboard.press('Enter');expect(form.locator('[name=category]')).to_have_value(LONG_EXPENSE);expect(page.locator('#record-dialog')).to_be_visible();assert len(entries())==2
 page.locator('#category-toggle').click();page.keyboard.press('Home');page.keyboard.press('ArrowDown');page.keyboard.press('Enter');expect(form.locator('[name=category]')).to_have_value('식비')
 page.locator('#category-toggle').click();page.keyboard.press('Escape');expect(page.locator('#category-options')).to_be_hidden();expect(page.locator('#record-dialog')).to_be_visible();expect(page.locator('#category-toggle')).to_be_focused();close()
 # Income uses the same stored fields with income-specific labels and examples.
 open_record('income','테스트 회사');expect(page.locator('#record-merchant-label')).to_have_text('입금처');expect(page.locator('#record-description-label')).to_have_text('수입 내용');expect(page.locator('#record-reason-label')).to_have_text('어떻게 들어온 돈인가요?');expect(form.locator('[name=merchant]')).to_have_attribute('placeholder','예: 회사, 부모님, 중고거래 구매자')
 form.locator('[name=description]').fill('11월 급여');form.locator('[name=reason]').fill('정기 상여가 함께 들어왔어요.')
 page.locator('#category-toggle').click();expect(page.locator('#category-options button')).to_have_count(7);expect(page.locator('#category-options button[data-category-value="식비"]')).to_have_count(0);expect(page.locator('#category-options button[data-category-value="반려동물"]')).to_have_count(0)
 page.locator('#category-options').get_by_role('button',name='급여',exact=True).click();expect(page.locator('#remember-category-label')).to_contain_text('입금처')
 form.locator('[name=type]').select_option('expense');expect(page.locator('#record-reason-label')).to_have_text('왜 썼나요?');expect(form.locator('[name=description]')).to_have_value('11월 급여');expect(form.locator('[name=reason]')).to_have_value('정기 상여가 함께 들어왔어요.')
 form.locator('[name=type]').select_option('income');choose('급여');form.get_by_role('button',name='기록 저장하기').click();saved=entries()[-1];assert saved['merchant']=='테스트 회사';assert saved['description']=='11월 급여';assert saved['reason']=='정기 상여가 함께 들어왔어요.';assert saved['category']=='급여';assert saved['type']=='income'
 # Existing income records are labelled correctly and their original content is preserved.
 page.locator('.bottom-nav [data-nav=history]').click();page.locator(f'[data-date="{TODAY}"]').click();page.locator('#day-entries button').filter(has=page.get_by_text('예전 회사',exact=True)).click();expect(page.locator('#record-merchant-label')).to_have_text('입금처');expect(form.locator('[name=reason]')).to_have_value('예전 입금 경위');close();page.locator('#day-dialog [data-close]').click();page.locator('.bottom-nav [data-nav=home]').click()
 open_record('income');page.locator('#category-toggle').click();form.locator('[name=type]').select_option('transfer');expect(page.locator('#category-options')).to_be_hidden();expect(page.locator('#category-label')).to_be_hidden();expect(page.locator('#record-merchant-label')).to_have_text('이체한 계좌');expect(page.locator('#record-reason-label')).to_have_text('이체 메모');close()
 # Direct input is preserved; opening the full catalog never filters or clears it.
 open_record();form.locator('[name=category]').fill('이번에 직접 정한 분류');page.locator('#category-toggle').click();expect(page.locator('#category-options button')).to_have_count(16);expect(form.locator('[name=category]')).to_have_value('이번에 직접 정한 분류');form.locator('[name=reason]').click();expect(page.locator('#category-options')).to_be_hidden();close()
 Path('artifacts').mkdir(exist_ok=True)
 for kind,count in [('income',7),('expense',16)]:
  open_record(kind);page.locator('#category-toggle').click()
  for width in [320,375,390,430,768,1024,1440]:
   page.set_viewport_size({'width':width,'height':1000});page.locator('#category-toggle').scroll_into_view_if_needed();assert form.evaluate('el=>el.scrollWidth<=el.clientWidth'),f'Form overflow {kind} {width}';assert page.locator('#category-options').evaluate('el=>el.scrollWidth<=el.clientWidth'),f'Category list overflow {kind} {width}';expect(page.locator('#category-options button')).to_have_count(count)
   page.screenshot(path=f'artifacts/record-picker-{kind}-{width}.png',full_page=True)
  page.locator('#category-options').get_by_role('button',name=LONG_INCOME if kind=='income' else LONG_EXPENSE,exact=True).click();expect(form.locator('[name=category]')).to_have_value(LONG_INCOME if kind=='income' else LONG_EXPENSE);close()
 assert not errors,errors
 print(json.dumps({'status':'passed','data':'isolated local fixtures; no account or AI calls','checks':['income labels and examples','all categories despite prefilled AI/local result','expense/income category separation','custom categories','manual choice and save','keyboard selection','Escape and focus','preserve typed fields on type change','edit legacy income','transfer context','free-form categories','outside close','responsive picker'],'viewports':[320,375,390,430,768,1024,1440]}))
 browser.close()
