import { activeEntries, getPeriod, todayISO } from './domain.js';
import { baseCategories } from './category-catalog.js';

const palette=['#e7c65e','#a6bc93','#dda58f','#b6a6cc','#93b9c2','#c5b28c','#99acd0','#cba4b5','#b5bf87','#dbb379','#9dc3b0','#b7aaa0','#a7afd3','#ccb66d','#a4b6a4','#c0a8bc'];
export const won = value => `${new Intl.NumberFormat('ko-KR').format(value)}원`;
const entryCategory=entry=>typeof entry.category==='string' && entry.category.trim()?entry.category.trim():entry.type==='expense'?'미분류':'기타 수입';
const periodEntries=(state,period,today)=>activeEntries(state).filter(entry=>entry.date>=period.start && entry.date<=period.end && entry.date<=today);
export function categoryColor(category,type) {
  const index=baseCategories(type).indexOf(category);
  const hash=index<0?Array.from(category).reduce((value,char)=>(value*31+char.codePointAt(0))>>>0,0):index;
  return palette[hash%palette.length];
}
export function reviewModel(state,{anchor=todayISO(),today=todayISO()}={}) {
  const period=getPeriod(anchor,state.settings.periodMode,state.settings.payday);
  const entries=periodEntries(state,period,today);
  function group(type){
    const totals=new Map();let total=0,count=0;
    for(const entry of entries){
      if(entry.type!==type)continue;
      const category=entryCategory(entry);
      const previous=totals.get(category) || {category,amount:0,count:0,color:categoryColor(category,type)};
      previous.amount+=entry.amount;previous.count++;totals.set(category,previous);total+=entry.amount;count++;
    }
    const categories=[...totals.values()].sort((a,b)=>b.amount-a.amount || a.category.localeCompare(b.category,'ko')).map(category=>({...category,share:category.amount/total*100}));
    return {total,count,categories};
  }
  const expense=group('expense'),income=group('income');
  return {period,expense,income,net:income.total-expense.total};
}
export function reviewDetailModel(state,{period,type,categories,today=todayISO()}) {
  const names=new Set(categories);
  const entries=['expense','income'].includes(type)?periodEntries(state,period,today).map((entry,index)=>({entry,index})).filter(({entry})=>entry.type===type && names.has(entryCategory(entry))).sort((a,b)=>b.entry.date.localeCompare(a.entry.date) || b.index-a.index).map(({entry})=>entry):[];
  return {entries,count:entries.length,total:entries.reduce((sum,entry)=>sum+entry.amount,0)};
}
function donutArc(start,share){
  const point=percent=>{const angle=(percent*3.6-90)*Math.PI/180;return `${120+94*Math.cos(angle)} ${120+94*Math.sin(angle)}`;};
  if(share>=100)return `M ${point(start)} A 94 94 0 1 1 ${point(start+50)} A 94 94 0 1 1 ${point(start+100)}`;
  return `M ${point(start)} A 94 94 0 ${share>50?1:0} 1 ${point(start+share)}`;
}
export function periodNeighbor(period,direction) {
  return new Date(Date.parse(`${direction<0?period.start:period.end}T00:00:00Z`)+(direction<0?-1:1)*86400000).toISOString().slice(0,10);
}
export function chartGroups(categories,expanded=false) {
  if(expanded || categories.length<=6)return categories;
  const rest=categories.slice(5);
  return [...categories.slice(0,5),{category:`나머지 ${rest.length}개`,amount:rest.reduce((sum,category)=>sum+category.amount,0),count:rest.reduce((sum,category)=>sum+category.count,0),share:rest.reduce((sum,category)=>sum+category.share,0),color:'#c3c5b2',combined:true,members:rest.map(category=>category.category)}];
}
export const shareLabel=share=>share>0 && share<.1?'0.1% 미만':`${new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}).format(share)}%`;

export function createReview({getState,onEdit}) {
  const $=selector=>document.querySelector(selector),svgNS='http://www.w3.org/2000/svg';
  const detailDialog=$('#review-detail-dialog');
  let anchor=null,settingsKey=null,shownPeriod=null,selection=null;
  const expanded={expense:false,income:false};
  function clearDetails(){
    selection=null;detailDialog.returnFocus=null;
    if(detailDialog.open)detailDialog.close();
    $('#review-detail-entries').replaceChildren();$('#review-detail-title').textContent='카테고리 내역';$('#review-detail-period').textContent='';$('#review-detail-total').textContent='0원';$('#review-detail-count').textContent='0건';$('#review-detail-empty').hidden=false;
  }
  function reset(){anchor=null;settingsKey=null;expanded.expense=false;expanded.income=false;clearDetails();}
  function currentTrigger(){
    if(!selection)return null;
    const trigger=Array.from($('#review-view').querySelectorAll('[data-detail-type]')).find(element=>element.dataset.detailType===selection.type && element.dataset.category===selection.label && element.dataset.combined===String(selection.combined) && element.dataset.detailSource===selection.source);
    const fallback=$(`#review-${selection.type}-title`);fallback.tabIndex=-1;
    return trigger || fallback;
  }
  function renderDetails(){
    if(!selection)return;
    const model=reviewDetailModel(getState(),selection),name=selection.type==='income'?'수입':'지출';
    detailDialog.returnFocus=currentTrigger();
    $('#review-detail-kind').textContent=`${name} 돌아보기`;
    $('#review-detail-title').textContent=`${selection.label} ${name} 내역`;
    $('#review-detail-period').textContent=`${selection.period.start.replaceAll('-','.')} — ${selection.period.end.replaceAll('-','.')}`;
    $('#review-detail-total').textContent=won(model.total);$('#review-detail-total').className=selection.type;
    $('#review-detail-count').textContent=`${model.count}건`;$('#review-detail-empty').hidden=model.count!==0;
    const list=$('#review-detail-entries');list.replaceChildren();
    for(const entry of model.entries){
      const row=document.createElement('li'),button=document.createElement('button');button.type='button';button.className=`day-entry ${entry.type}`;button.dataset.entryId=entry.id;button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-label',`${entry.date} ${entry.merchant} ${won(entry.amount)} 기록 수정`);
      const detail=document.createElement('div');detail.className='entry-detail';
      const title=document.createElement('strong');title.textContent=entry.merchant;
      const meta=document.createElement('p');meta.className='review-entry-meta';
      const date=document.createElement('time');date.dateTime=entry.date;date.textContent=entry.date.replaceAll('-','.');meta.append(date,document.createTextNode(` · ${entryCategory(entry)}`));detail.append(title,meta);
      if(entry.description){const description=document.createElement('p');description.className='entry-description';description.textContent=entry.description;detail.append(description);}
      if(entry.reason){const reason=document.createElement('p');reason.className='entry-reason';reason.textContent=entry.reason;detail.append(reason);}
      const amount=document.createElement('strong');amount.className='entry-amount';amount.textContent=`${entry.type==='income'?'+':'−'}${won(entry.amount)}`;
      button.append(detail,amount);button.addEventListener('click',()=>{detailDialog.close();onEdit(entry,currentTrigger());});row.append(button);list.append(row);
    }
  }
  function resumeDetails(){if(!selection)return false;renderDetails();if(!detailDialog.open)detailDialog.showModal();return true;}
  function connectTrigger(element,type,category,source){
    element.dataset.category=category.category;element.dataset.combined=String(!!category.combined);element.dataset.detailType=type;element.dataset.detailSource=source;
    element.setAttribute('aria-label',`${category.category} ${type==='income'?'수입':'지출'} ${won(category.amount)}, ${shareLabel(category.share)}, 내역 보기`);element.setAttribute('aria-haspopup','dialog');element.setAttribute('aria-controls','review-detail-dialog');
    const open=()=>{selection={type,label:category.category,combined:!!category.combined,categories:category.members || [category.category],period:{...shownPeriod},source};resumeDetails();};
    element.addEventListener('click',open);
    if(source==='chart')element.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();open();}});
  }
  function renderChart(type,data){
    const name=type==='expense'?'지출':'수입';
    const svg=$(`#review-${type}-chart`);svg.replaceChildren();svg.setAttribute('role','group');svg.setAttribute('aria-label',`${name} 카테고리별 원그래프, 총 ${won(data.total)}, ${data.categories.length}개 카테고리. 조각이나 아래 항목을 누르면 내역을 볼 수 있어요.`);
    const track=document.createElementNS(svgNS,'circle');
    for(const [key,value] of Object.entries({cx:120,cy:120,r:94,fill:'none',stroke:'#f0f0e7','stroke-width':28}))track.setAttribute(key,value);
    track.setAttribute('aria-hidden','true');svg.append(track);let offset=0;
    for(const category of chartGroups(data.categories,expanded[type])){
      const arc=document.createElementNS(svgNS,'path');
      for(const [key,value] of Object.entries({d:donutArc(offset,category.share),fill:'none',stroke:category.color,'stroke-width':28,role:'button',tabindex:0,class:'review-chart-segment'}))arc.setAttribute(key,value);
      connectTrigger(arc,type,category,'chart');svg.append(arc);offset+=category.share;
    }
    const center=$(`#review-${type}-center`);center.textContent=data.total>=100000000?`약 ${new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}).format(data.total/100000000)}억 원`:won(data.total);center.title=won(data.total);
    $(`#review-${type}-count`).textContent=`${data.count}건 · ${data.categories.length}개 카테고리`;
    $(`#review-${type}-empty`).hidden=data.total!==0;
    $(`#review-${type}-table`).hidden=data.total===0;
    const list=$(`#review-${type}-rows`);list.replaceChildren();
    for(const category of chartGroups(data.categories,expanded[type])){
      const row=document.createElement('tr');row.dataset.category=category.category;
      const label=document.createElement('th');label.scope='row';
      const dot=document.createElement('i');dot.className='review-color';dot.style.backgroundColor=category.color;dot.setAttribute('aria-hidden','true');
      const text=document.createElement('span');text.textContent=category.category;
      const button=document.createElement('button');button.type='button';button.className='review-category-button';
      const chevron=document.createElement('span');chevron.className='review-category-open';chevron.setAttribute('aria-hidden','true');chevron.textContent='›';button.append(dot,text,chevron);label.append(button);connectTrigger(button,type,category,'list');
      const amount=document.createElement('td');amount.textContent=won(category.amount);amount.className='review-category-amount';
      const share=document.createElement('td');share.textContent=shareLabel(category.share);share.className='review-category-share';
      row.append(label,amount,share);list.append(row);
      row.addEventListener('click',event=>{if(!button.contains(event.target))button.click();});
    }
    const toggle=$(`#review-${type}-expand`);toggle.hidden=data.categories.length<=6;toggle.setAttribute('aria-expanded',String(expanded[type]));toggle.textContent=expanded[type]?'큰 항목 위주로 접기':`카테고리 ${data.categories.length}개 모두 보기`;
  }
  function render(){
    const state=getState(),key=`${state.settings.periodMode}:${state.settings.payday}`,today=todayISO();
    if(key!==settingsKey){anchor=null;expanded.expense=false;expanded.income=false;settingsKey=key;}
    const current=getPeriod(today,state.settings.periodMode,state.settings.payday);
    if(anchor && getPeriod(anchor,state.settings.periodMode,state.settings.payday).start>current.start)anchor=null;
    const model=reviewModel(state,{anchor:anchor || today,today});
    shownPeriod=model.period;
    $('#review-period-label').textContent=`${model.period.start.replaceAll('-','.')} — ${model.period.end.replaceAll('-','.')}`;
    $('#review-period-basis').textContent=state.settings.periodMode==='payday'?`월급날 기준 · 매월 ${state.settings.payday}일 시작`:'달력 기준 · 매월 1일 시작';
    $('#review-period-note').textContent=model.period.start===current.start?'진행 중인 기간은 오늘까지의 기록을 모았어요.':'선택한 기간의 기록을 모았어요.';
    $('#review-next').disabled=model.period.start>=current.start;
    $('#review-today').disabled=model.period.start===current.start;
    $('#review-total-expense').textContent=won(model.expense.total);$('#review-total-income').textContent=won(model.income.total);$('#review-net').textContent=won(model.net);
    $('#review-net').classList.toggle('review-negative',model.net<0);
    for(const type of ['expense','income'])renderChart(type,model[type]);
    if(detailDialog.open)renderDetails();
  }
  function move(direction){
    const state=getState(),today=todayISO(),current=getPeriod(today,state.settings.periodMode,state.settings.payday);
    const period=getPeriod(anchor || today,state.settings.periodMode,state.settings.payday);
    if(direction>0 && period.start>=current.start)return;
    anchor=periodNeighbor(period,direction);expanded.expense=false;expanded.income=false;render();
  }
  $('#review-prev').addEventListener('click',()=>move(-1));$('#review-next').addEventListener('click',()=>move(1));
  $('#review-today').addEventListener('click',()=>{anchor=null;expanded.expense=false;expanded.income=false;render();});
  for(const type of ['expense','income'])$(`#review-${type}-expand`).addEventListener('click',()=>{expanded[type]=!expanded[type];render();});
  return {render,reset,resumeDetails,closeDetails:clearDetails};
}
