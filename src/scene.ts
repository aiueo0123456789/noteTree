import {renderContent} from './rich-text';
import {DataLayer, EventID, type Model, type ModelEvent, type TextModel} from './model';
import {KeyedDOM} from './dom';
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

/** Events update the cache/indexes; only queued model IDs are rendered on the next frame. */
export class Scene {
  private editable=true;
  setEditable(value:boolean){if(value===this.editable)return;this.editable=value;for(const m of this.models.values())if(m.type==='text'||m.type==='tag')this.pending.add(m.id);}
  private models=new Map<string,Model>();
  private edgesByNode=new Map<string,Set<string>>();
  private nodesByTag=new Map<string,Set<string>>();
  private pending=new Set<string>();
  private cards:KeyedDOM;
  private edges:KeyedDOM;
  private tags:KeyedDOM;
  private selected=new Set<string>();
  private virtual=new Map<string,Model>();
  private from:string|null=null;
  constructor(private data:DataLayer, world:HTMLElement, tagList:HTMLElement) {
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('connections');
    svg.innerHTML='<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#a5b3c4"/></marker></defs>';
    world.append(svg);this.cards=new KeyedDOM(world);this.edges=new KeyedDOM(svg);this.tags=new KeyedDOM(tagList);
    for(const model of data.all()){this.models.set(model.id,model);this.index(model,true);this.pending.add(model.id);}
    Object.values(EventID).forEach(event=>data.streamEvent(event,e=>this.receive(e)));
  }
  private membership(index:Map<string,Set<string>>,key:string,id:string,add:boolean){
    if(add){if(!index.has(key))index.set(key,new Set());index.get(key)!.add(id);}
    else{index.get(key)?.delete(id);if(!index.get(key)?.size)index.delete(key);}
  }
  private index(model:Model,add:boolean){
    if(model.type==='text')for(const tag of model.tags)this.membership(this.nodesByTag,tag,model.id,add);
    if(model.type==='connection')for(const node of [model.from,model.to])this.membership(this.edgesByNode,node,model.id,add);
  }
  private queueEdges(id:string){for(const edge of this.edgesByNode.get(id)??[])this.pending.add(edge);}
  private receive({id,model,previous}:ModelEvent){
    if(previous)this.index(previous,false);
    if(model){this.models.set(id,model);this.index(model,true);}else this.models.delete(id);
    this.pending.add(id);
    if(model?.type==='tag'||previous?.type==='tag')for(const node of this.nodesByTag.get(id)??[])this.pending.add(node);
    if(model?.type==='text'||previous?.type==='text'){
      const before=previous?.type==='text'?previous:null,after=model?.type==='text'?model:null;
      if(!before||!after||JSON.stringify([before.position,before.size,before.collapsed])!==JSON.stringify([after.position,after.size,after.collapsed]))this.queueEdges(id);
      const oldTags=new Set(before?.tags??[]),newTags=new Set(after?.tags??[]);
      for(const tag of new Set([...oldTags,...newTags]))if(oldTags.has(tag)!==newTags.has(tag))this.pending.add(tag);
    }
  }
  get(id:string){return this.virtual.get(id)??this.models.get(id);}
  // Selection and drag previews are UI state, not committed DataLayer changes.
  ui(selected:Set<string>,virtual:Map<string,Model>,from:string|null){
    const affected=new Set<string>();
    for(const id of new Set([...this.selected,...selected]))if(this.selected.has(id)!==selected.has(id))affected.add(id);
    if(this.from!==from){if(this.from)affected.add(this.from);if(from)affected.add(from);}
    for(const id of new Set([...this.virtual.keys(),...virtual.keys()]))if(this.virtual.get(id)!==virtual.get(id))affected.add(id);
    this.selected=new Set(selected);this.virtual=new Map(virtual);this.from=from;
    const edgeIds=new Set<string>();
    for(const id of affected){
      const model=this.get(id),card=this.cards.get(id) as HTMLElement|undefined;
      if(model?.type==='text'&&card){
        card.style.transform=`translate(${model.position.x}px, ${model.position.y}px)`;
        card.style.width=`${model.size.x}px`;card.style.height=`${model.collapsed?40:model.size.y}px`;
        card.classList.toggle('selected',selected.has(id));
        card.classList.toggle('virtual',virtual.has(id));
        card.classList.toggle('connecting',from===id);
      }else if(model?.type==='connection')edgeIds.add(id);
      else this.pending.add(id); // First preview frame or preview removal only.
      for(const edge of this.edgesByNode.get(id)??[])edgeIds.add(edge);
    }
    for(const id of edgeIds){
      const model=this.get(id),element=this.edges.get(id);
      if(model?.type!=='connection'||!element)continue;
      element.classList.toggle('selected',selected.has(id));
      const a=this.get(model.from),b=this.get(model.to);
      if(a?.type==='text'&&b?.type==='text')for(const path of element.children)path.setAttribute('d',this.edgePath(a,b));
    }
  }

  invalidate(id:string){this.cards.invalidate(id);this.tags.invalidate(id);this.pending.add(id);}
  redraw(){this.cards.clear();this.edges.clear();this.tags.clear();for(const id of this.models.keys())this.pending.add(id);for(const id of this.virtual.keys())this.pending.add(id);}
  flush(){const ids=[...this.pending];this.pending.clear();for(const id of ids)this.render(id);}
  private render(id:string){
    const m=this.get(id);
    if(!m){this.cards.remove(id);this.edges.remove(id);this.tags.remove(id);return;}
    if(m.type==='text')this.cards.upsert(id,this.cardHTML(m));
    if(m.type==='tag')this.tags.upsert(id,`<div class="tag-row" data-tag="${esc(m.id)}"><input class="tag-color" data-tag-color="${esc(m.id)}" type="color" ${this.editable?'':'disabled'} value="${esc(m.color)}" aria-label="${esc(m.name)}の色"><span class="tag-name">${esc(m.name)}</span><span class="tag-count">${this.nodesByTag.get(id)?.size??0}</span><button data-delete-tag="${esc(m.id)}" aria-label="${esc(m.name)}を削除">×</button></div>`);
    if(m.type==='connection'){
      const a=this.get(m.from),b=this.get(m.to);
      if(a?.type!=='text'||b?.type!=='text'){this.edges.remove(id);return;}
      const path=this.edgePath(a,b);
      this.edges.upsert(id,`<g data-edge="${esc(id)}" class="edge ${this.selected.has(id)?'selected':''}"><path class="edge-hit" d="${path}"/><path class="edge-line" d="${path}" marker-end="url(#arrow)"/></g>`);
    }
  }
  private edgePath(from:TextModel,to:TextModel){const forward=to.position.x>=from.position.x;const x1=from.position.x+(forward?from.size.x:0),y1=from.position.y+(from.collapsed?20:from.size.y/2),x2=to.position.x+(forward?0:to.size.x),y2=to.position.y+(to.collapsed?20:to.size.y/2),d=Math.max(65,Math.abs(x2-x1)/2)*(forward?1:-1);return `M ${x1} ${y1} C ${x1+d} ${y1}, ${x2-d} ${y2}, ${x2} ${y2}`;}
  private cardHTML(m:TextModel){return `<article data-node="${esc(m.id)}" class="card ${this.selected.has(m.id)?'selected':''} ${this.virtual.has(m.id)?'virtual':''} ${this.from===m.id?'connecting':''}" style="left:0;top:0;transform:translate(${m.position.x}px, ${m.position.y}px);width:${m.size.x}px;height:${m.collapsed?40:m.size.y}px"><div class="card-header"><strong data-field="title" title="ダブルクリックで編集">${esc(m.title||'無題')}</strong><div class="card-tags">${m.tags.map(id=>{const tag=this.get(id);return tag?.type==='tag'?`<button class="dot" ${this.editable?'':'disabled'} data-remove-tag="${esc(id)}" style="--tag:${esc(tag.color)}" title="${esc(tag.name)}を外す" aria-label="${esc(tag.name)}を外す"></button>`:'';}).join('')}<button class="add-dot" data-add-tag title="タグを追加" aria-label="タグを追加">＋</button></div><button data-collapse class="collapse" title="${m.collapsed?'展開':'折り畳む'}" aria-label="${m.collapsed?'展開':'折り畳む'}">${m.collapsed?'＋':'−'}</button></div>${m.collapsed?'':`<div class="card-content" data-field="content">${renderContent(m.content)}</div><button class="resize-handle" data-resize aria-label="サイズ変更" title="ドラッグしてサイズ変更"></button>`}</article>`;}
}
