import { DataLayer, EventID, type TextModel } from './model';
import { KeyedDOM } from './dom';
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const normalize=(s:string)=>s.normalize('NFKC').toLocaleLowerCase();
/** Shared search UI. The local index follows DataLayer events; no cloud reads. */
export class Search {
  private models=new Map<string,TextModel>();
  private host!:HTMLElement;
  private input!:HTMLInputElement;
  private list!:HTMLElement;
  private dom!:KeyedDOM;
  private ids:string[]=[];
  private index=0;
  private returnFocus:HTMLElement|null=null;
  constructor(data:DataLayer,private select:(id:string)=>void){
    for(const model of data.all())if(model.type==='text')this.models.set(model.id,model);
    for(const event of Object.values(EventID))data.streamEvent(event,e=>{
      if(e.model?.type==='text')this.models.set(e.id,e.model);else this.models.delete(e.id);
      if(this.host&&!this.host.hidden&&(e.model?.type==='text'||e.previous?.type==='text'))this.render();
    });
  }
  init(parent:HTMLElement){
    this.host=document.createElement('section');this.host.className='search-panel';this.host.hidden=true;this.host.setAttribute('aria-label','ノートを検索');
    this.host.innerHTML='<div class="search-bar"><input type="search" placeholder="検索" aria-label="タイトル・本文を検索" autocomplete="off"><button type="button" aria-label="検索を閉じる">×</button></div><div class="search-results" role="listbox" aria-label="検索結果"></div><p class="search-status" role="status"></p>';
    parent.append(this.host);this.input=this.host.querySelector('input')!;this.list=this.host.querySelector('.search-results')!;this.dom=new KeyedDOM(this.list);
    this.host.querySelector('button')!.addEventListener('click',()=>this.close());
    this.input.addEventListener('input',()=>{this.index=0;this.render();});
    this.list.addEventListener('click',e=>{const button=(e.target as HTMLElement).closest<HTMLElement>('[data-result]');if(button)this.choose(button.dataset.result!);});
    this.host.addEventListener('keydown',e=>{
      if(e.isComposing)return;
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.close();}
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();e.stopPropagation();this.index=(this.index+(e.key==='ArrowDown'?1:-1)+this.ids.length)%Math.max(1,this.ids.length);this.mark();this.dom.get(this.ids[this.index])?.scrollIntoView({block:'nearest'});}
      if(e.key==='Enter'&&e.target===this.input&&this.ids[this.index]){e.preventDefault();this.choose(this.ids[this.index]);}
    });
    window.addEventListener('keydown',e=>{if(!parent.hidden&&(e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='f'&&!e.altKey){e.preventDefault();this.open();}},true);
  }
  open(){if(this.host.hidden)this.returnFocus=document.activeElement as HTMLElement;this.host.hidden=false;this.render();this.input.focus();this.input.select();}
  close(){this.host.hidden=true;if(this.returnFocus?.isConnected)this.returnFocus.focus();this.returnFocus=null;}
  reset(){this.close();this.input.value='';this.dom.clear();this.ids=[];}
  private choose(id:string){if(!this.models.has(id))return;this.close();this.select(id);}
  private mark(){for(const [i,id] of this.ids.entries())this.dom.get(id)?.setAttribute('aria-selected',String(i===this.index));}
  private render(){
    const query=normalize(this.input.value.trim()),terms=query.split(/\s+/).filter(Boolean);
    const matches=terms.length?[...this.models.values()].filter(m=>terms.every(term=>normalize(`${m.title}\n${m.content}`).includes(term))):[];
    const next=matches.map(m=>m.id);for(const id of this.ids)if(!next.includes(id))this.dom.remove(id);
    this.ids=next;this.index=Math.min(this.index,Math.max(0,next.length-1));
    for(const [index,m] of matches.entries()){
      const term=terms.find(t=>normalize(m.content).includes(t));const offset=term?Math.max(0,normalize(m.content).indexOf(term)-25):0;
      const snippet=(offset?'…':'')+m.content.slice(offset,offset+100).replace(/\s+/g,' ');
      this.dom.upsert(m.id,`<button type="button" role="option" data-result="${esc(m.id)}" aria-selected="false"><strong>${esc(m.title||'無題')}</strong><span>${esc(snippet)}</span></button>`);
      const element=this.dom.get(m.id)!;if(this.list.children[index]!==element)this.list.insertBefore(element,this.list.children[index]??null);
    }
    this.mark();this.host.querySelector('.search-status')!.textContent=query?(matches.length?`${matches.length}件`:'該当なし'):'';
  }
}
