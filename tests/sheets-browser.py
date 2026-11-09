"""Browser integration against a simulated Google OAuth/Sheets service.
No real account login or real spreadsheet is accessed by this test.
"""
import json
import os
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

BASE_URL=os.environ.get('BASE_URL','http://127.0.0.1:3000/').rstrip('/')+'/'
HEADERS={
 '거래내역':['거래ID','거래일','종류','금액','사용처','카테고리','지출이유','고정비ID','수정시각','삭제시각'],
 '기간별예산':['기간시작일','예산','수정시각','삭제시각'],
 '예산배분':['예산ID','카테고리ID','금액'],
 '고정비':['고정비ID','이름','예상금액','매월예정일','수정시각','삭제시각'],
 '카테고리':['카테고리ID','종류','이름','사용여부'],
 '설정':['항목','값','수정시각']
}
SDK='''window.google={accounts:{oauth2:{initTokenClient:config=>({requestAccessToken:()=>setTimeout(()=>config.callback({access_token:'browser-test-only',expires_in:3600,scope:'https://www.googleapis.com/auth/spreadsheets'}),0)}),hasGrantedAllScopes:()=>true}}};'''
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
 errors=[];writes=[];network={'offline':False}
 a_context=browser.new_context(viewport={'width':390,'height':844})
 a=a_context.new_page();a.goto(BASE_URL);a.locator("#legacy-entry").click()
 date=a.evaluate("new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())")
 sheets={name:{'id':i,'rows':[]} for i,name in enumerate(HEADERS)}
 sheets['거래내역']['rows']=[HEADERS['거래내역'],['remote',date,'지출',5000,'시트에 있던 기록','식비','','','2026-11-01T00:00:00Z','']]
 sheets['개인 메모']={'id':99,'rows':[['절대 지우면 안 되는 내 메모']]}
 def endpoint(route):
  if network['offline']:route.abort();return
  request=route.request;url=urlparse(request.url)
  if request.method=='OPTIONS':route.fulfill(status=204,headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type'});return
  assert request.headers.get('authorization')=='Bearer browser-test-only'
  if url.path.endswith('/values:batchGet'):
   ranges=parse_qs(url.query)['ranges']
   route.fulfill(headers={'Access-Control-Allow-Origin':'*'},json={'valueRanges':[{'range':r,'values':sheets[r.strip("'")]['rows']} for r in ranges]});return
  if url.path.endswith(':batchUpdate'):
   body=request.post_data_json;writes.append(body)
   assert all('deleteSheet' not in op and 'deleteRange' not in op for op in body['requests'])
   for op in body['requests']:
    if 'addSheet' in op:
     props=op['addSheet']['properties'];assert props['title'] not in sheets;sheets[props['title']]={'id':props['sheetId'],'rows':[]}
    elif 'updateCells' in op:
     update=op['updateCells'];table=next(v for v in sheets.values() if v['id']==update['start']['sheetId'])
     for index,row in enumerate(update['rows']):
      values=[cell.get('userEnteredValue',{}).get('numberValue',cell.get('userEnteredValue',{}).get('stringValue','')) for cell in row['values']]
      while len(table['rows'])<=index:table['rows'].append([])
      column=update['start'].get('columnIndex',0)
      while len(table['rows'][index])<column:table['rows'][index].append('')
      table['rows'][index][column:column+len(values)]=values
    elif 'appendCells' in op:
     update=op['appendCells'];table=next(v for v in sheets.values() if v['id']==update['sheetId'])
     for row in update['rows']:
      assert all('formulaValue' not in cell.get('userEnteredValue',{}) for cell in row['values'])
      table['rows'].append([cell.get('userEnteredValue',{}).get('numberValue',cell.get('userEnteredValue',{}).get('stringValue','')) for cell in row['values']])
   route.fulfill(headers={'Access-Control-Allow-Origin':'*'},json={'replies':[]});return
  route.fulfill(headers={'Access-Control-Allow-Origin':'*'},json={'spreadsheetId':'test-sheet-id-00000000000000000000000000000000','properties':{'title':'Test wallet'},'sheets':[{'properties':{'sheetId':v['id'],'title':name}} for name,v in sheets.items()]})
 def setup(context,page):
  context.route('https://accounts.google.com/gsi/client',lambda route:route.fulfill(content_type='text/javascript',body=SDK))
  context.route('https://sheets.googleapis.com/**',endpoint)
  page.on('pageerror',lambda error:errors.append(str(error)))
 def settings(page):page.locator('.topbar [data-open=settings]').click()
 def login(page):
  if page.locator('#sheet-url').is_enabled():
   page.locator('#sheet-url').fill('test-sheet-id-00000000000000000000000000000000')
  page.locator('#google-connect').click()
 def close_settings(page):page.locator('#settings-dialog [data-close]').click()
 def wait_sync(page):expect(page.locator('#sync-banner-text')).to_contain_text('시트 저장 완료',timeout=15000)
 def add(page,name,amount):
  # Works on mobile and desktop without relying on which fixed record button is shown.
  if page.viewport_size['width']<=700:page.locator('.mobile-record').click()
  else:page.locator('.desktop-record').click()
  form=page.locator('#record-form');form.locator('[name=amount]').fill(str(amount));form.locator('[name=merchant]').fill(name);form.get_by_role('button',name='기록 저장하기').click()
 setup(a_context,a)
 initial={'version':1,'settings':{'periodMode':'calendar','payday':25},'budgets':{},'fixedCosts':[],'bookmarks':[],'entries':[{'id':'local','date':date,'type':'expense','amount':12000,'merchant':'이 기기 기록','reason':'','category':'미분류','fixedId':None}]}
 a.evaluate('(s)=>localStorage.setItem("dear-wallet.v1",JSON.stringify(s))',initial);a.reload()
 settings(a);expect(a.locator('#sheet-url')).to_have_value('');expect(a.locator('#google-connect')).to_be_enabled();login(a)
 expect(a.locator('#sheet-preview')).to_be_visible();expect(a.locator('#sheet-preview-description')).to_contain_text('Test wallet')
 # Inspection must be read-only until the user chooses how to connect.
 assert not writes
 a.locator('#sheet-merge').click();wait_sync(a);close_settings(a)
 expect(a.locator('#spent')).to_have_text('17,000원')
 assert len(sheets['카테고리']['rows'])==14
 assert sheets['개인 메모']['rows']==[['절대 지우면 안 되는 내 메모']]
 # Tokens must never enter local/session storage.
 assert a.evaluate('JSON.stringify({...localStorage,...sessionStorage})').find('browser-test-only')==-1
 b_context=browser.new_context(viewport={'width':1440,'height':1100});b=b_context.new_page();setup(b_context,b);b.goto(BASE_URL);b.locator("#legacy-entry").click()
 settings(b);expect(b.locator('#google-connect')).to_be_enabled();login(b);expect(b.locator('#sheet-preview')).to_be_visible();b.locator('#sheet-adopt').click();wait_sync(b);close_settings(b)
 expect(b.locator('#spent')).to_have_text('17,000원')
 add(a,'새 지출',3000);wait_sync(a)
 settings(b);b.locator('#sheet-sync-now').click();wait_sync(b);close_settings(b);expect(b.locator('#spent')).to_have_text('20,000원')
 # Editing and deletion synchronize as versions of an ID, not additional spending.
 a.locator('.bottom-nav [data-nav=history]').click();a.locator(f'[data-date="{date}"]').click();a.locator('#day-entries button').filter(has_text='이 기기 기록').click()
 a.locator('#record-form [name=amount]').fill('15000');a.get_by_role('button',name='수정 저장하기').click();wait_sync(a)
 expect(a.locator('#day-expense')).to_have_text('23,000원')
 a.locator('#day-entries button').filter(has_text='이 기기 기록').click();a.locator('#delete-record').click();a.locator('#confirm-delete').click();wait_sync(a);expect(a.locator('#day-expense')).to_have_text('8,000원')
 a.locator('#day-dialog [data-undo]').click();wait_sync(a);expect(a.locator('#day-expense')).to_have_text('23,000원');a.locator('#day-dialog [data-close]').click()
 # Reload requires fresh login, but offline local changes remain queued.
 b.reload();expect(b.locator('#sync-banner-text')).to_contain_text('다시 로그인')
 add(b,'로그인 전 기록',4000);expect(b.locator('#sync-banner-text')).to_contain_text('기다리고')
 settings(b);expect(b.locator('#google-connect')).to_be_enabled();login(b);wait_sync(b);close_settings(b);expect(b.locator('#spent')).to_have_text('27,000원')
 # Failed requests preserve records and are clearly distinguished from saved-to-sheet.
 network['offline']=True;add(b,'오프라인 기록',2000);expect(b.locator('#sync-banner-text')).not_to_contain_text('시트 저장 완료')
 expect(b.locator('#spent')).to_have_text('29,000원')
 network['offline']=False;settings(b);b.locator('#sheet-sync-now').click();wait_sync(b);close_settings(b)
 # Mobile settings must remain usable at every supported width.
 settings(a);a.locator('#sheet-sync-now').click();wait_sync(a)
 Path('artifacts').mkdir(exist_ok=True)
 for width in [320,375,390,430,768,1024,1440]:
  a.set_viewport_size({'width':width,'height':1000})
  assert a.locator('#settings-dialog').evaluate('el=>el.scrollWidth<=el.clientWidth'),f'Settings overflow {width}'
  a.locator('#sheet-heading').scroll_into_view_if_needed();a.screenshot(path=f'artifacts/sheets-settings-{width}.png',full_page=True)
 # Disconnect is local and leaves remote records intact.
 before=len(sheets['거래내역']['rows']);a.locator('#sheet-disconnect').click();a.locator('#sheet-confirm-disconnect').click();assert len(sheets['거래내역']['rows'])==before
 assert a.evaluate('localStorage.getItem("dear-wallet.sheets.v1")') is None
 assert a.evaluate('JSON.parse(localStorage.getItem("dear-wallet.v1")).entries.length')>=4
 assert not errors,errors
 print(json.dumps({'status':'passed','service':'mock Google OAuth and Sheets','checks':['inspect before write','preserve existing tabs','auto headers/categories','merge local records','two-device load','automatic save','edit/delete/undo','relogin with pending changes','network failure recovery','no persisted token','disconnect preserves records'],'viewports':[320,375,390,430,768,1024,1440],'errors':errors}))
 browser.close()
