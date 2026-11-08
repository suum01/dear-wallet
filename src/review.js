import { activeEntries, getPeriod, todayISO } from './domain.js';
import { baseCategories } from './category-catalog.js';

const palette=['#e7c65e','#a6bc93','#dda58f','#b6a6cc','#93b9c2','#c5b28c','#99acd0','#cba4b5','#b5bf87','#dbb379','#9dc3b0','#b7aaa0','#a7afd3','#ccb66d','#a4b6a4','#c0a8bc'];
export const won = value => `${new Intl.NumberFormat('ko-KR').format(value)}원`;
export function categoryColor(category,type) {
  const index=baseCategories(type).indexOf(category);
  const hash=index<0?Array.from(category).reduce((value,char)=>(value*31+char.codePointAt(0))>>>0,0):index;
  return palette[hash%palette.length];
}
export function reviewModel(state,{anchor=todayISO(),today=todayISO()}={}) {
  const period=getPeriod(anchor,state.settings.periodMode,state.settings.payday);
  const entries=activeEntries(state).filter(entry=>entry.date>=period.start && entry.date<=period.end && entry.date<=today);
  function group(type){
    const totals=new Map();let total=0,count=0;
    for(const entry of entries){
      if(entry.type!==type)continue;
      const category=typeof entry.category==='string' && entry.category.trim()?entry.category.trim():type==='expense'?'미분류':'기타 수입';
      const previous=totals.get(category) || {category,amount:0,count:0,color:categoryColor(category,type)};
      previous.amount+=entry.amount;previous.count++;totals.set(category,previous);total+=entry.amount;count++;
    }
    const categories=[...totals.values()].sort((a,b)=>b.amount-a.amount || a.category.localeCompare(b.category,'ko')).map(category=>({...category,share:category.amount/total*100}));
    return {total,count,categories};
  }
  const expense=group('expense'),income=group('income');
  return {period,expense,income,net:income.total-expense.total};
}
export function periodNeighbor(period,direction) {
  return new Date(Date.parse(`${direction<0?period.start:period.end}T00:00:00Z`)+(direction<0?-1:1)*86400000).toISOString().slice(0,10);
}
export function chartGroups(categories,expanded=false) {
  if(expanded || categories.length<=6)return categories;
  const rest=categories.slice(5);
  return [...categories.slice(0,5),{category:`나머지 ${rest.length}개`,amount:rest.reduce((sum,category)=>sum+category.amount,0),count:rest.reduce((sum,category)=>sum+category.count,0),share:rest.reduce((sum,category)=>sum+category.share,0),color:'#c3c5b2',combined:true}];
}
export const shareLabel=share=>share>0 && share<.1?'0.1% 미만':`${new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}).format(share)}%`;

export function createReview({getState}) {
  const $=selector=>document.querySelector(selector),svgNS='http://www.w3.org/2000/svg';
  let anchor=null,settingsKey=null;
  const expanded={expense:false,income:false};
  function reset(){anchor=null;settingsKey=null;expanded.expense=false;expanded.income=false;}
  function renderChart(type,data){
    const name=type==='expense'?'지출':'수입';
    const svg=$(`#review-${type}-chart`);svg.replaceChildren();svg.setAttribute('aria-label',`${name} 카테고리별 원그래프, 총 ${won(data.total)}, ${data.categories.length}개 카테고리. 아래 표에서 금액과 비율을 확인할 수 있어요.`);
    const track=document.createElementNS(svgNS,'circle');
    for(const [key,value] of Object.entries({cx:120,cy:120,r:94,fill:'none',stroke:'#f0f0e7','stroke-width':28}))track.setAttribute(key,value);
    svg.append(track);let offset=0;
    for(const category of chartGroups(data.categories,expanded[type])){
      const circle=document.createElementNS(svgNS,'circle');
      for(const [key,value] of Object.entries({cx:120,cy:120,r:94,fill:'none',stroke:category.color,'stroke-width':28,pathLength:100,'stroke-dasharray':`${category.share} ${Math.max(0,100-category.share)}`,'stroke-dashoffset':-offset,transform:'rotate(-90 120 120)'}))circle.setAttribute(key,value);
      circle.dataset.category=category.category;svg.append(circle);offset+=category.share;
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
      const text=document.createElement('span');text.textContent=category.category;label.append(dot,text);
      const amount=document.createElement('td');amount.textContent=won(category.amount);amount.className='review-category-amount';
      const share=document.createElement('td');share.textContent=shareLabel(category.share);share.className='review-category-share';
      row.append(label,amount,share);list.append(row);
    }
    const toggle=$(`#review-${type}-expand`);toggle.hidden=data.categories.length<=6;toggle.setAttribute('aria-expanded',String(expanded[type]));toggle.textContent=expanded[type]?'큰 항목 위주로 접기':`카테고리 ${data.categories.length}개 모두 보기`;
  }
  function render(){
    const state=getState(),key=`${state.settings.periodMode}:${state.settings.payday}`,today=todayISO();
    if(key!==settingsKey){anchor=null;expanded.expense=false;expanded.income=false;settingsKey=key;}
    const current=getPeriod(today,state.settings.periodMode,state.settings.payday);
    if(anchor && getPeriod(anchor,state.settings.periodMode,state.settings.payday).start>current.start)anchor=null;
    const model=reviewModel(state,{anchor:anchor || today,today});
    $('#review-period-label').textContent=`${model.period.start.replaceAll('-','.')} — ${model.period.end.replaceAll('-','.')}`;
    $('#review-period-basis').textContent=state.settings.periodMode==='payday'?`월급날 기준 · 매월 ${state.settings.payday}일 시작`:'달력 기준 · 매월 1일 시작';
    $('#review-period-note').textContent=model.period.start===current.start?'진행 중인 기간은 오늘까지의 기록을 모았어요.':'선택한 기간의 기록을 모았어요.';
    $('#review-next').disabled=model.period.start>=current.start;
    $('#review-today').disabled=model.period.start===current.start;
    $('#review-total-expense').textContent=won(model.expense.total);$('#review-total-income').textContent=won(model.income.total);$('#review-net').textContent=won(model.net);
    $('#review-net').classList.toggle('review-negative',model.net<0);
    for(const type of ['expense','income'])renderChart(type,model[type]);
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
  return {render,reset};
}
