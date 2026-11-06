"""Run npm start, then python tests/edit-browser.py with Python Playwright installed."""
import json
import os
from pathlib import Path
BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:3000/").rstrip("/") + "/"

from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
    context=browser.new_context(viewport={'width':390,'height':844})
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(BASE_URL)
    page.locator("#legacy-entry").click()
    date=page.evaluate("new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())")
    start=date[:8]+'01'
    def entry(id,type,amount,merchant,fixedId=None):
        return dict(id=id,type=type,amount=amount,merchant=merchant,fixedId=fixedId,date=date,reason='',category='식비' if type=='expense' else '기타 수입')
    state={'version':1,'settings':{'periodMode':'calendar','payday':25},'budgets':{start:100000},'fixedCosts':[{'id':'phone','name':'통신','amount':10000,'day':20}],'bookmarks':[], 'entries':[entry('food','expense',12000,'점심'),entry('phone','expense',10000,'통신비','phone')]}
    page.evaluate('(state)=>localStorage.setItem("dear-wallet.v1",JSON.stringify(state))',state)
    page.goto(BASE_URL + '#history')
    page.reload()
    page.locator('.bottom-nav [data-nav=history]').click()
    page.locator(f'[data-date="{date}"]').click()
    form=page.locator('#record-form')
    def open_edit(name):
        page.locator('#day-entries button').filter(has_text=name).click()
        expect(page.locator('#record-dialog')).to_be_visible()
    def save():
        form.get_by_role('button',name='수정 저장하기').click()
        expect(page.locator('#day-dialog')).to_be_visible()
    open_edit('점심')
    assert form.locator('[name=amount]').input_value()=='12000'
    assert form.locator('[name=category]').input_value()=='식비'
    # Closing the editor must discard the draft.
    form.locator('[name=amount]').fill('99999')
    page.keyboard.press('Escape')
    expect(page.locator('#day-expense')).to_have_text('22,000원')
    open_edit('점심')
    form.locator('[name=amount]').fill('15000')
    form.locator('[name=merchant]').fill('친구 저녁 정산')
    form.locator('[name=category]').fill('식사·약속')
    form.locator('[name=reason]').fill('<script>악성 코드 아님</script>')
    save()
    expect(page.locator('#day-expense')).to_have_text('25,000원')
    expect(page.locator('#day-entries')).to_contain_text('식사·약속')
    expect(page.locator('#day-entries')).to_contain_text('<script>악성 코드 아님</script>')
    assert page.locator('#day-entries script').count()==0
    # Type changes must immediately affect the right financial totals.
    open_edit('친구 저녁 정산'); form.locator('[name=type]').select_option('transfer'); save()
    expect(page.locator('#day-expense')).to_have_text('10,000원')
    open_edit('친구 저녁 정산'); form.locator('[name=type]').select_option('income'); save()
    expect(page.locator('#day-income')).to_have_text('15,000원')
    open_edit('친구 저녁 정산'); form.locator('[name=type]').select_option('expense'); save()
    # Moving across a month boundary must update the calendar and reopen the new date.
    previous=page.evaluate('(date)=>{const d=new Date(date.slice(0,7)+"-01T00:00:00Z");d.setUTCDate(0);return d.toISOString().slice(0,10)}',date)
    open_edit('친구 저녁 정산'); form.locator('[name=date]').fill(previous); save()
    expect(page.locator('#day-full-date')).to_have_text(previous)
    assert page.locator(f'[data-date="{previous}"]').count()==1
    page.locator('#day-dialog [data-close]').click();page.locator('#calendar-today').click();page.locator(f'[data-date="{date}"]').click()
    # Cancel deletion, then delete a paid fixed cost and undo without double counting.
    open_edit('통신비'); page.locator('#delete-record').click();page.locator('#cancel-delete').click()
    assert page.locator('#delete-confirm').is_hidden()
    page.locator('#delete-record').click();page.locator('#confirm-delete').click()
    expect(page.locator('#day-dialog')).to_be_visible()
    expect(page.locator('#day-expense')).to_have_text('0원')
    expect(page.locator('#day-empty')).to_be_visible()
    assert page.locator('#math-fixed').inner_text()=='10,000원'
    assert page.locator('#available-value').inner_text()=='90,000원'
    page.locator('#day-dialog [data-undo]').click()
    expect(page.locator('#day-expense')).to_have_text('10,000원')
    assert page.locator('#math-fixed').inner_text()=='0원'
    assert page.locator('#available-value').inner_text()=='90,000원'
    # Desktop and mobile editor and confirmation layouts.
    Path('artifacts').mkdir(exist_ok=True)
    open_edit('통신비')
    for width in [320,375,390,430,768,1024,1440]:
        page.set_viewport_size({'width':width,'height':1000})
        page.locator('#delete-record').click()
        assert page.locator('#record-dialog').evaluate('el=>el.contains(document.activeElement)'), 'Focus escaped edit dialog'
        assert page.locator('#record-dialog').evaluate('el=>el.scrollWidth<=el.clientWidth'), f'Editor overflow at {width}'
        page.screenshot(path=f'artifacts/edit-{width}.png',full_page=True)
        page.locator('#cancel-delete').click()
    # A second tab updates the record; the stale editor must not overwrite it.
    other=page.context.new_page();other.goto(BASE_URL)
    other.evaluate('()=>{let s=JSON.parse(localStorage.getItem("dear-wallet.v1"));s.entries.find(e=>e.id==="phone").amount=11000;localStorage.setItem("dear-wallet.v1",JSON.stringify(s));}')
    expect(page.locator('#spent')).to_have_text('11,000원')
    form.get_by_role('button',name='수정 저장하기').click()
    expect(form.locator('.form-error')).to_contain_text('다른 창에서 변경')
    page.keyboard.press('Escape')
    open_edit('통신비')
    # Storage failure leaves the editor and existing saved record intact.
    page.evaluate('()=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw new Error("quota")}}')
    form.locator('[name=amount]').fill('9000')
    form.get_by_role('button',name='수정 저장하기').click()
    expect(form.locator('.form-error')).to_contain_text('저장하지 못했어요')
    expect(page.locator('#record-dialog')).to_be_visible()
    page.evaluate('()=>{Storage.prototype.setItem=window.originalSetItem}')
    page.keyboard.press('Escape')
    # Delete survives reload; no phantom payments reappear.
    open_edit('통신비');page.locator('#delete-record').click();page.locator('#confirm-delete').click()
    expect(page.locator('#day-empty')).to_be_visible()
    page.reload();page.locator('[data-nav=history]:visible').first.click();page.locator(f'[data-date="{date}"]').click()
    expect(page.locator('#day-expense')).to_have_text('0원')
    assert page.locator('#day-entries li').count()==0
    assert not errors,errors
    print(json.dumps({'status':'passed','checks':['edit fields','cancel draft','category','safe text','type totals','move date across month','delete confirmation','delete fixed cost','undo','stale edit conflict','storage failure','reload deletion'],'viewports':[320,375,390,430,768,1024,1440],'errors':errors}))
    browser.close()
