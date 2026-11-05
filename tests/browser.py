"""Optional browser check: pip install playwright, then python tests/browser.py.
Uses system Chromium; run npm start first. Screenshots go to ignored artifacts/.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page(viewport={"width": 1440, "height": 1100}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto('http://127.0.0.1:3000')
    page.locator('#home-view h1').wait_for()
    assert page.locator('#ring-value').inner_text() == '0원'
    assert page.locator('#ring-progress').evaluate('(el) => el.style.strokeDashoffset') == '0'
    page.locator('.desktop-record').click()
    form=page.locator('#record-form')
    form.locator('[name=amount]').fill('12000')
    form.locator('[name=merchant]').fill('김밥천국')
    form.get_by_role('button', name='기록 저장하기').click()
    assert page.locator('#ring-value').inner_text() == '12,000원'
    page.reload()
    assert page.locator('#ring-value').inner_text() == '12,000원'
    page.locator('#budget-action').click()
    budget=page.locator('#budget-form')
    budget.locator('[name=budget]').fill('100000')
    page.locator('#add-fixed').click()
    budget.locator('[name=fixedName]').fill('통신비')
    budget.locator('[name=fixedAmount]').fill('10000')
    budget.locator('[name=fixedDay]').fill('20')
    budget.get_by_role('button', name='계획 저장하기').click()
    assert page.locator('#ring-value').inner_text() == '12%'
    assert page.locator('#available-value').inner_text() == '78,000원'
    page.locator('.desktop-record').click()
    form.locator('[name=amount]').fill('10000')
    form.locator('[name=merchant]').fill('통신비')
    form.locator('[name=fixedId]').select_option(label='통신비 · 10,000원')
    form.get_by_role('button', name='기록 저장하기').click()
    assert page.locator('#available-value').inner_text() == '78,000원'
    assert page.locator('#math-fixed').inner_text() == '0원'
    for kind in ['transfer','income']:
        page.locator('.desktop-record').click()
        form.locator('[name=type]').select_option(kind)
        form.locator('[name=amount]').fill('50000')
        form.locator('[name=merchant]').fill('합계 제외 테스트')
        form.get_by_role('button', name='기록 저장하기').click()
        assert page.locator('#ring-value').inner_text() == '22%'
    page.locator('.topbar [data-open=settings]').click()
    page.locator('#start-demo').click()
    assert page.locator('#ring-value').inner_text() == '62%'
    assert page.locator('#available-value').inner_text() == '280,000원'
    Path('artifacts').mkdir(exist_ok=True)
    page.locator('#toast').evaluate("el => el.classList.remove('visible')")
    for width in [320,375,390,430,768,1024,1440]:
        page.set_viewport_size({'width':width,'height':1000})
        page.wait_for_timeout(100)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Overflow at {width}'
        assert page.locator('#ring-value').is_visible()
        page.screenshot(path=f'artifacts/home-{width}.png',full_page=True)
    page.locator('#exit-demo').click()
    assert page.locator('#ring-value').inner_text() == '22%'
    page.set_viewport_size({'width':375,'height':812})
    page.locator('.mobile-record').click()
    form.locator('[name=amount]').fill('90000')
    form.locator('[name=merchant]').fill('예산 초과')
    form.get_by_role('button', name='기록 저장하기').click()
    assert page.locator('#ring-value').inner_text() == '112%'
    assert '12,000원 부족' in page.locator('#available-value').inner_text()
    page.locator('.topbar [data-open=settings]').click()
    page.locator('#settings-form [name=periodMode]').select_option('payday')
    page.locator('#settings-form [name=payday]').select_option('25')
    page.get_by_role('button', name='설정 저장하기').click()
    assert page.locator('#ring-caption').inner_text() == '이번 기간 쓴 돈'
    # Very large accepted values must wrap without causing overflow.
    page.locator('.mobile-record').click()
    form.locator('[name=amount]').fill('999999999999')
    form.locator('[name=merchant]').fill('<script>alert(1)</script>')
    form.get_by_role('button', name='기록 저장하기').click()
    for width in [320,375,768,1024,1440]:
        page.set_viewport_size({'width':width,'height':1000})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Large value overflow at {width}'
    assert not errors, errors
    print(json.dumps({'status':'passed','viewports':[320,375,390,430,768,1024,1440],'functional_checks':['empty state','record','reload persistence','budget ring','fixed cost payment','transfer/income excluded','demo isolation','overspend','payday settings','large amounts'],'page_errors':errors}))
    browser.close()
