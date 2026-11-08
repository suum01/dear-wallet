// A disclosure list alongside the editable input. Opening it always shows the
// entire catalog, including when an automatic category already fills the input.
export function createCategoryPicker({root,input,toggle,list,getOptions,getType,onSelect}) {
  let open=false,signature='',lastValue='',lastType=null,active=0;
  const choices=()=>Array.from(list.querySelectorAll('button[data-category-value]'));
  function close({restoreFocus=false}={}){
    open=false;list.hidden=true;toggle.setAttribute('aria-expanded','false');
    toggle.setAttribute('aria-label',`${getType()==='income'?'수입':'지출'} 카테고리 목록 펼치기`);
    if(restoreFocus)toggle.focus({preventScroll:true});
  }
  function markActive(index,{focus=false}={}){
    const buttons=choices();if(!buttons.length)return;
    active=(index+buttons.length)%buttons.length;
    buttons.forEach((button,i)=>button.tabIndex=i===active?0:-1);
    if(focus){buttons[active].focus({preventScroll:true});buttons[active].scrollIntoView({block:'nearest'});}
  }
  function update(){
    const type=getType(),options=type==='transfer'?[]:getOptions();
    if(type!==lastType){close();lastType=type;}
    const next=JSON.stringify(options);
    const focused=open && list.contains(document.activeElement)?document.activeElement.dataset.categoryValue:null;
    if(next!==signature){
      signature=next;list.replaceChildren();
      for(const value of options){
        const item=document.createElement('li'),button=document.createElement('button');
        button.type='button';button.className='category-choice';button.dataset.categoryValue=value;button.textContent=value;button.tabIndex=-1;
        item.append(button);list.append(item);
      }
    }
    const buttons=choices(),selected=options.indexOf(input.value.trim());
    buttons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.categoryValue===input.value.trim())));
    if(input.value!==lastValue || active>=buttons.length){active=selected<0?0:selected;lastValue=input.value;}
    markActive(active);
    if(focused){const index=buttons.findIndex(button=>button.dataset.categoryValue===focused);if(index>=0)markActive(index,{focus:document.activeElement!==buttons[index]});}
    const name=type==='income'?'수입':'지출';list.setAttribute('aria-label',`${name} 카테고리 전체 목록`);
    toggle.setAttribute('aria-label',`${name} 카테고리 목록 ${open?'접기':'펼치기'}`);
    if(!buttons.length)close();
  }
  function show({last=false}={}){
    update();if(!choices().length)return;
    open=true;list.hidden=false;toggle.setAttribute('aria-expanded','true');
    toggle.setAttribute('aria-label',`${getType()==='income'?'수입':'지출'} 카테고리 목록 접기`);
    const selected=choices().findIndex(button=>button.dataset.categoryValue===input.value.trim());
    markActive(selected>=0?selected:last?choices().length-1:0,{focus:true});
  }
  toggle.addEventListener('click',()=>open?close({restoreFocus:true}):show());
  list.addEventListener('click',event=>{
    const button=event.target.closest('button[data-category-value]');if(!button || !list.contains(button))return;
    close();onSelect(button.dataset.categoryValue);toggle.focus({preventScroll:true});
  });
  input.addEventListener('keydown',event=>{
    if(event.key==='ArrowDown' || event.key==='ArrowUp'){event.preventDefault();show({last:event.key==='ArrowUp'});}
  });
  root.addEventListener('keydown',event=>{
    if(!open)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close({restoreFocus:true});return;}
    if(!list.contains(event.target))return;
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();markActive(event.key==='Home'?0:event.key==='End'?choices().length-1:active+(event.key==='ArrowDown'?1:-1),{focus:true});
    }
  });
  document.addEventListener('pointerdown',event=>{if(open && !root.contains(event.target))close();});
  root.addEventListener('focusout',event=>{
    if(event.relatedTarget instanceof Node && root.contains(event.relatedTarget))return;
    // Native focus moves can run between microtask checkpoints. Let the new
    // button receive focus before deciding that focus has left the picker.
    setTimeout(()=>{if(open && !root.contains(document.activeElement))close();},0);
  });
  return {update,close};
}
