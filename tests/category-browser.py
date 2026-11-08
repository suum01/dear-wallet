"""Functional classification checks in local mode; no external AI or real account data."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
BASE_URL=os.environ.get('BASE_URL','http://127.0.0.1:4173/dear-wallet/').rstrip('/')+'/'
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(BASE_URL);page.locator('#legacy-entry').click();form=page.locator('#record-form')
 def open_record(merchant,description='',kind='expense'):
  if page.viewport_size['width']<=700:page.locator('.mobile-record').click()
  else:page.locator('.desktop-record').click()
  form.locator('[name=type]').select_option(kind);form.locator('[name=amount]').fill('1000');form.locator('[name=merchant]').fill(merchant)
  if description:form.locator('[name=description]').fill(description)
 def save():form.get_by_role('button',name='기록 저장하기').click()
 def rules():return page.evaluate('JSON.parse(localStorage.getItem("dear-wallet.v1")).settings.categoryRules || []')
 def entries():return page.evaluate('JSON.parse(localStorage.getItem("dear-wallet.v1")).entries')
 open_record('스타벅스 강남점');expect(form.locator('[name=category]')).to_have_value('카페');save();assert entries()[-1]['categorySource']=='keyword'
 open_record('(주) 쏘카');expect(form.locator('[name=category]')).to_have_value('교통');form.locator('[data-close]').click()
 open_record('친구에게 송금','카셰어링 이용료');expect(form.locator('[name=category]')).to_have_value('교통');form.locator('[data-close]').click()
 open_record('CU','치약과 세제');expect(form.locator('[name=category]')).to_have_value('생활용품');form.locator('[name=reason]').fill('여행 준비');save();assert entries()[-1]['description']=='치약과 세제';assert entries()[-1]['reason']=='여행 준비'
 # A one-off correction does not silently teach a rule.
 open_record('CU');expect(form.locator('[name=category]')).to_have_value('미분류');form.locator('[name=category]').fill('여행 준비');expect(page.locator('#remember-category-panel')).to_be_visible();save();assert rules()==[]
 open_record('CU');expect(form.locator('[name=category]')).to_have_value('미분류');form.locator('[name=category]').fill('생활용품');form.locator('[name=rememberCategory]').check();save();assert len(rules())==1
 open_record('ＣＵ','김밥');expect(form.locator('[name=category]')).to_have_value('생활용품');expect(page.locator('#category-mode-badge')).to_have_text('기억한 분류');save()
 # Forgetting is staged until save. Closing the draft preserves the remembered rule.
 open_record('CU');page.locator('#forget-category-rule').click();expect(form.locator('[name=category]')).to_have_value('미분류');expect(page.locator('#category-help')).to_contain_text('저장하면');form.locator('[data-close]').click();assert len(rules())==1
 open_record('CU');expect(form.locator('[name=category]')).to_have_value('생활용품');page.locator('#forget-category-rule').click();save();assert rules()==[];assert entries()[1]['category']=='생활용품';assert entries()[2]['category']=='여행 준비'
 open_record('쿠팡','우유랑 샴푸');expect(form.locator('[name=category]')).to_have_value('미분류');save()
 open_record('회사','11월 급여','income');expect(form.locator('[name=category]')).to_have_value('급여');save()
 open_record('키움자동충전');expect(form.locator('[name=category]')).to_have_value('주식');expect(page.locator('#category-options button[data-category-value="주식"]')).to_have_count(1);expect(page.locator('#category-help')).to_contain_text('내 계좌 간 이체');page.set_viewport_size({'width':320,'height':844});assert form.evaluate('el=>el.scrollWidth<=el.clientWidth');save();assert entries()[-1]['category']=='주식';assert entries()[-1]['type']=='expense';page.set_viewport_size({'width':390,'height':844})
 open_record('키움자동충전','','transfer');assert page.locator('#category-label').is_hidden();save();assert entries()[-1]['category']=='내부 이체';assert entries()[-1]['type']=='transfer'
 open_record('스타벅스','','transfer');assert page.locator('#category-label').is_hidden();save();assert entries()[-1]['category']=='내부 이체';assert entries()[-1]['type']=='transfer'
 # Recorded categories remain stable on edit; explicit reset recomputes using current content.
 page.locator('.bottom-nav [data-nav=history]').click();date=entries()[2]['date'];page.locator(f'[data-date="{date}"]').click();page.locator('#day-entries button').filter(has=page.locator('.entry-detail > p:first-of-type',has_text='여행 준비')).click();expect(form.locator('[name=category]')).to_have_value('여행 준비');form.locator('[name=description]').fill('김밥');expect(form.locator('[name=category]')).to_have_value('여행 준비');page.locator('#auto-category-reset').click();expect(form.locator('[name=category]')).to_have_value('식비');form.get_by_role('button',name='수정 저장하기').click();expect(page.locator('#day-dialog')).to_be_visible();expect(page.locator('#day-entries')).to_contain_text('김밥');page.locator('#day-dialog [data-close]').click();page.locator('.bottom-nav [data-nav=home]').click()
 # Remembered rules survive normal settings changes and reload.
 open_record('다이소','치약');form.locator('[name=category]').fill('생활용품');form.locator('[name=rememberCategory]').check();save();page.locator('.topbar [data-open=settings]').click();page.locator('#settings-form [name=periodMode]').select_option('calendar');page.get_by_role('button',name='설정 저장하기').click();assert len(rules())==1;page.reload();open_record('다이소');expect(form.locator('[name=category]')).to_have_value('생활용품')
 Path('artifacts').mkdir(exist_ok=True);form.locator('[name=category]').fill('내가 직접 정한 생활과 여행 준비 카테고리');page.locator('#toast').evaluate("el=>el.classList.remove('visible')")
 for width in [320,375,390,430,768,1024,1440]:
  page.set_viewport_size({'width':width,'height':1000});page.locator('#category-label').scroll_into_view_if_needed();assert form.evaluate('el=>el.scrollWidth<=el.clientWidth'),f'Classification form overflow {width}';page.screenshot(path=f'artifacts/classification-{width}.png',full_page=True)
 assert not errors,errors
 print(json.dumps({'status':'passed','checks':['live prediction','content before merchant','separate description/reason','one-off override','remember consent','remembered rule priority','cancel staged forget','forget on save','mixed purpose fallback','stock funding classification and save','stock account transfer exclusion','income and internal transfer','preserve saved category','explicit recompute','settings preserve rules','reload','responsive form'],'viewports':[320,375,390,430,768,1024,1440]}))
 browser.close()
