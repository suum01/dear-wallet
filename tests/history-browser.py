"""Run npm start, then python tests/history-browser.py with Python Playwright installed."""
import json
import os
from pathlib import Path
BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:3000/").rstrip("/") + "/"

from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':390,'height':844})
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(BASE_URL)
    page.locator("#legacy-entry").click()
    date=page.evaluate("new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())")
    previous=date[:8]+'01'
    page.locator('.bottom-nav [data-nav=history]').click()
    assert page.locator('#history-view').is_visible()
    assert page.locator('#home-view').is_hidden()
    page.locator(f'[data-date="{previous}"]').click()
    assert page.locator('#day-dialog').is_visible()
    assert page.locator('#day-empty').is_visible()
    # Escape returns focus to the selected date.
    page.keyboard.press('Escape')
    assert page.locator(f'[data-date="{previous}"]').evaluate('el => el === document.activeElement')
    def record(kind,amount,merchant):
        page.locator(f'[data-date="{previous}"]').click()
        page.locator('#record-selected-day').click()
        form=page.locator('#record-form')
        assert form.locator('[name=date]').input_value()==previous
        form.locator('[name=type]').select_option(kind)
        form.locator('[name=amount]').fill(str(amount))
        form.locator('[name=merchant]').fill(merchant)
        form.get_by_role('button',name='기록 저장하기').click()
        page.locator('#day-dialog').wait_for(state='visible')
        assert page.locator('#day-entries .entry-detail > strong').filter(has_text=merchant).is_visible()
        page.locator('#day-dialog [data-close]').click()
    record('expense',12000,'점심')
    record('expense',20000,'친구에게 송금')
    record('income',100000,'용돈')
    record('transfer',500000,'내 계좌 이동')
    cell=page.locator(f'[data-date="{previous}"]')
    assert '32,000원' in cell.get_attribute('aria-label')
    assert '100,000원' in cell.get_attribute('aria-label')
    # Month selection, year boundary, today shortcut, and browser navigation.
    month=page.locator('#calendar-month').inner_text()
    page.locator('#calendar-prev').click()
    assert page.locator('#calendar-month').inner_text()!=month
    page.locator('#calendar-next').click()
    assert page.locator('#calendar-month').inner_text()==month
    page.locator('#calendar-next').click()
    page.locator('#calendar-today').click()
    assert page.locator('#calendar-month').inner_text()==month
    page.reload()
    page.locator('.bottom-nav [data-nav=history]').click()
    assert page.locator('#history-view').is_visible()
    assert '32,000원' in page.locator(f'[data-date="{previous}"]').get_attribute('aria-label')
    Path('artifacts').mkdir(exist_ok=True)
    for width in [320,375,390,430,768,1024,1440]:
        page.set_viewport_size({'width':width,'height':1000})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Calendar overflow at {width}'
        page.screenshot(path=f'artifacts/history-{width}.png',full_page=True)
        page.locator(f'[data-date="{previous}"]').click()
        assert page.locator('#day-expense').inner_text()=='32,000원'
        assert page.locator('#day-income').inner_text()=='100,000원'
        assert page.locator('#day-entries li').count()==4
        assert page.evaluate('document.querySelector("#day-dialog").scrollWidth <= document.querySelector("#day-dialog").clientWidth'), f'Sheet overflow at {width}'
        page.screenshot(path=f'artifacts/day-sheet-{width}.png',full_page=True)
        page.locator('#day-dialog [data-close]').click()
    page.set_viewport_size({'width':375,'height':812})
    page.locator('.bottom-nav [data-nav=home]').click()
    assert page.locator('#ring-value').inner_text()=='32,000원'
    page.go_back()
    assert page.locator('#history-view').is_visible()
    # Future dates can be inspected, but not recorded.
    page.locator('#calendar-next').click()
    page.locator('#calendar-days button').first.click()
    assert page.locator('#record-selected-day').is_disabled()
    page.keyboard.press('Escape')
    # Empty state in a completely separate browser context must not inherit test records.
    clean=browser.new_page(viewport={'width':320,'height':812})
    clean.goto(BASE_URL + '#history')
    clean.locator('#legacy-entry').click()
    clean.locator('.bottom-nav [data-nav=history]').click()
    assert clean.locator('#history-expense').inner_text()=='0원'
    assert not errors, errors
    print(json.dumps({'status':'passed','viewports':[320,375,390,430,768,1024,1440],'checks':['calendar totals','internal transfers excluded','third-party spending','date prefill','sheet reopens after save','month navigation','reload','browser back','future dates','keyboard focus','empty state'],'errors':errors}))
    browser.close()
