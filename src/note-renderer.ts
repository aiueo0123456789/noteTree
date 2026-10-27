import {renderContent} from './rich-text';
import {compareText,hierarchyChanges,appendConnectionChanges} from './hierarchy';
import {TreeDrag} from './tree-drag';
import {commentHTML} from './comments';
import {canChange,type Identity,type Role} from './access';
import { Command, CommandManager, DataLayer, EventID, type Model, type TextModel } from './model';
import { KeyedDOM } from './dom';
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export class NoteRenderer {
  private treeDrag!:TreeDrag;
  private role:Role|null='owner';
  private user:Identity|null=null;
  private editable=true;
  setAccess(role:Role|null,user:Identity|null){this.resetInteraction();this.role=role;this.user=user;this.editable=role==='owner'||role==='editor';this.treeDrag?.setEnabled(this.editable);this.dirty=true;}
  current: string | null = null;
  private models=new Map<string,Model>();
  private dirty=true;
  private tagPopover:HTMLElement|null=null;
  private host!:HTMLElement;
  private outline!:KeyedDOM;
  private panels!:KeyedDOM;
  private crumbs!:KeyedDOM;
  private shown=new Set<string>();
  private rows=new Set<string>();
  private finishEdit:((save:boolean)=>void)|null=null;
  constructor(private data:DataLayer,private commands:CommandManager){
    for(const m of data.all())this.models.set(m.id,m);
    for(const event of Object.values(EventID))data.streamEvent(event,e=>{
      if(e.model)this.models.set(e.id,e.model);else this.models.delete(e.id);
      this.dirty=true;
    });
  }
  init(host:HTMLElement){
    this.host=host;
    host.innerHTML='<nav class="note-outline" aria-label="ノート階層"></nav><section class="note-main"><nav class="note-path" aria-label="親ノート"></nav><div class="note-panels"></div><button type="button" class="note-add-child" data-note-add-child aria-label="子ノートを追加" hidden>＋</button></section>';
    this.outline=new KeyedDOM(host.querySelector('.note-outline')!);
    this.panels=new KeyedDOM(host.querySelector('.note-panels')!);
    this.crumbs=new KeyedDOM(host.querySelector('.note-path')!);
    this.treeDrag=new TreeDrag(host.querySelector('.note-outline')!,
      (id,drop)=>this.editable&&hierarchyChanges([...this.models.values()],id,drop,()=> 'preview-edge').size>0,
      (id,drop)=>{if(!this.editable)return;this.finishEdit?.(true);const changes=hierarchyChanges([...this.models.values()],id,drop);if(changes.size)this.commands.execute(new Command(this.data).init(changes));this.update();});
    this.treeDrag.setEnabled(this.editable);
    host.addEventListener('click',e=>{
      const el=e.target as HTMLElement;
      if(el.closest('[data-note-add-child]')){this.addChild();return;}
      const add=el.closest<HTMLElement>('[data-note-add-tag]');if(add&&this.editable){this.pickTag(add);return;}
      const remove=el.closest<HTMLElement>('[data-remove-tag]');if(remove&&this.editable){const m=this.data.getModelByID(remove.closest<HTMLElement>('[data-note]')!.dataset.note!);if(m?.type==='text')this.commit({...m,tags:m.tags.filter(id=>id!==remove.dataset.removeTag)});return;}
      const target=(e.target as HTMLElement).closest<HTMLElement>('[data-go]');if(target)this.navigate(target.dataset.go!);});
    document.addEventListener('pointerdown',e=>{if(this.tagPopover&&!(e.target as HTMLElement).closest('.note-tag-popover,[data-note-add-tag]'))this.closeTags();});
    host.querySelector('.note-main')!.addEventListener('scroll',()=>this.closeTags());
    window.addEventListener('resize',()=>this.closeTags());
    host.addEventListener('dblclick',e=>{const field=(e.target as HTMLElement).closest<HTMLElement>('[data-note-field]');if(field&&this.editable)this.edit(field);});
  }
  navigate(id:string){if(this.models.get(id)?.type!=='text')return;this.finishEdit?.(true);this.closeTags();this.current=id;this.dirty=true;this.update();this.panels.get(id)?.scrollIntoView({block:'nearest'});}
  setActive(active:boolean){if(!active){this.treeDrag.cancel();this.finishEdit?.(true);this.closeTags();}}
  resetInteraction(){this.treeDrag?.cancel();this.closeTags();this.finishEdit?.(false);this.dirty=true;}
  redraw(){this.treeDrag.cancel();this.closeTags();this.finishEdit?.(true);this.outline.clear();this.panels.clear();this.crumbs.clear();this.rows.clear();this.shown.clear();this.dirty=true;}
  update(){
    if(!this.dirty||this.finishEdit||this.treeDrag.active)return;
    this.dirty=false;
    const texts=[...this.models.values()].filter((m):m is TextModel=>m.type==='text').sort(compareText);
    const parents=new Map<string,string[]>(),children=new Map<string,string[]>();
    for(const m of this.models.values())if(m.type==='connection'&&this.models.get(m.from)?.type==='text'&&this.models.get(m.to)?.type==='text'){
      parents.set(m.to,[...new Set([...(parents.get(m.to)??[]),m.from])]);
      children.set(m.from,[...new Set([...(children.get(m.from)??[]),m.to])]);
    }
    for(const ids of [...parents.values(),...children.values()])ids.sort((a,b)=>compareText(this.models.get(a) as TextModel,this.models.get(b) as TextModel));
    if(!this.current||this.models.get(this.current)?.type!=='text')this.current=texts.find(m=>!parents.has(m.id))?.id??texts[0]?.id??null;
    const visited=new Set<string>();
    const outlineParent=this.host.querySelector('.note-outline')!;
    const visit=(id:string,depth:number,parent:string|null=null)=>{
      if(visited.has(id))return;visited.add(id);
      const m=this.models.get(id) as TextModel;
      this.outline.upsert(id,`<button type="button" data-tree-node="${esc(id)}" data-parent="${esc(parent??'')}" data-depth="${depth}" data-go="${esc(id)}" style="--depth:${depth}" aria-current="${id===this.current?'page':'false'}">${Array.from({length:depth},(_,i)=>`<span class="tree-guide" aria-hidden="true" style="--level:${i}"></span>`).join('')}${esc(m.title||'無題')}</button>`);
      const row=this.outline.get(id)!;if(outlineParent.children[visited.size-1]!==row)outlineParent.insertBefore(row,outlineParent.children[visited.size-1]??null);
      for(const child of children.get(id)??[])visit(child,depth+1,id);
    };
    for(const m of texts.filter(m=>!parents.has(m.id)))visit(m.id,0);
    for(const m of texts)visit(m.id,0);
    for(const id of this.rows)if(!visited.has(id))this.outline.remove(id);
    this.rows=visited;
    const path:string[]=[];const seen=new Set<string>();let ancestor:string|null=this.current;
    while(ancestor&&!seen.has(ancestor)){seen.add(ancestor);path.unshift(ancestor);ancestor=parents.get(ancestor)?.[0]??null;}
    this.crumbs.upsert('path',`<div>${path.map(id=>`<button type="button" data-go="${esc(id)}" ${id===this.current?'aria-current="page"':''}>${esc((this.models.get(id) as TextModel).title||'無題')}</button>`).join('<span aria-hidden="true"> / </span>')}</div>`);
    this.crumbs.upsert('parents',`<div class="note-parents">${(parents.get(this.current??'')??[]).map(id=>`<button type="button" data-go="${esc(id)}">↑ ${esc((this.models.get(id) as TextModel).title||'無題')}</button>`).join('')}</div>`);
    const parentIds=(parents.get(this.current??'')??[]).filter(id=>id!==this.current);
    const ids=this.current?[...new Set([...parentIds,this.current,...(children.get(this.current)??[])])]:[];
    for(const id of this.shown)if(!ids.includes(id))this.panels.remove(id);
    const panelParent=this.host.querySelector('.note-panels')!;
    for(const [index,id] of ids.entries()){
      const m=this.models.get(id) as TextModel,isCurrent=id===this.current;
      this.panels.upsert(id,`<article class="note-panel ${isCurrent?'is-current':''}" data-note="${esc(id)}"><div class="note-panel-heading"><span class="note-kind">${isCurrent?'●':parentIds.includes(id)?'↑':'↳'}</span>${isCurrent?`<strong data-note-field="title">${esc(m.title||'無題')}</strong>`:`<button type="button" data-go="${esc(id)}">${esc(m.title||'無題')}</button>`}<div class="note-tags">${m.tags.map(tagId=>{const tag=this.models.get(tagId);return tag?.type==='tag'?`<button class="note-tag" ${this.editable?'':'disabled'} data-remove-tag="${esc(tag.id)}" title="${esc(tag.name)}を外す" aria-label="${esc(tag.name)}を外す"><span class="dot" style="--tag:${esc(tag.color)}"></span>${esc(tag.name)} ×</button>`:'';}).join('')}<button class="add-dot" data-note-add-tag aria-label="タグを編集">＋</button></div></div><div class="note-body"><div class="note-content" ${isCurrent?'data-note-field="content"':''}>${renderContent(m.content)}</div></div><div class="note-comment-tools"><button data-comment-to="${esc(id)}">コメント</button></div>${[...this.models.values()].filter(c=>c.type==='comment'&&c.to===id).map(c=>c.type==='comment'?commentHTML(c,canChange(this.role,this.user,c,c)):'').join('')}</article>`);
      const panel=this.panels.get(id)!;if(panelParent.children[index]!==panel)panelParent.insertBefore(panel,panelParent.children[index]??null);
    }
    this.panels.upsert('empty',`<p class="note-empty" ${ids.length?'hidden':''}>ノートがありません</p>`);
    this.shown=new Set(ids);
    this.host.querySelector<HTMLButtonElement>('[data-note-add-child]')!.hidden=!this.editable||!this.current;
  }
  private addChild(){
    if(!this.editable||!this.current)return;
    this.finishEdit?.(true);this.closeTags();
    const parent=this.data.getModelByID(this.current);if(parent?.type!=='text')return;
    const models=this.data.all();
    const childIds=new Set(models.filter(m=>m.type==='connection'&&m.from===parent.id).map(m=>m.type==='connection'?m.to:''));
    const children=models.filter((m):m is TextModel=>m.type==='text'&&childIds.has(m.id));
    const child:TextModel={id:crypto.randomUUID(),type:'text',index:children.length,title:'新しい話題',content:'',tags:[],position:{x:parent.position.x+parent.size.x+110,y:Math.max(parent.position.y,...children.map(m=>m.position.y+m.size.y+30))},size:{x:280,y:160},collapsed:false};
    const changes=appendConnectionChanges(models,parent.id,child);
    if(changes.size)this.commands.execute(new Command(this.data).init(changes));
    this.update();this.panels.get(child.id)?.scrollIntoView({block:'nearest'});
  }
  private commit(model:Model){if(!this.editable)return;this.commands.execute(new Command(this.data).init(new Map([[model.id,model]])));this.update();}
  private closeTags(){this.tagPopover?.remove();this.tagPopover=null;}
  private pickTag(anchor:HTMLElement){
    if(this.tagPopover){this.closeTags();return;}
    this.finishEdit?.(true);
    const id=anchor.closest<HTMLElement>('[data-note]')!.dataset.note!;
    const popover=document.createElement('div');popover.className='tag-popover note-tag-popover';popover.setAttribute('aria-label','タグを編集');
    const tags=[...this.models.values()].filter(m=>m.type==='tag');
    const model=this.models.get(id);if(model?.type!=='text')return;
    popover.innerHTML=`<div class="tag-options">${tags.map(tag=>`<div class="note-tag-option" data-tag="${esc(tag.id)}"><button data-assign="${esc(tag.id)}" aria-label="${esc(tag.name)}を切り替え" aria-pressed="${model.tags.includes(tag.id)}">${model.tags.includes(tag.id)?'✓':'＋'}</button><input type="color" value="${esc(tag.color)}" aria-label="タグの色"><input type="text" value="${esc(tag.name)}" aria-label="タグ名"></div>`).join('')}<form class="note-new-tag"><input name="name" aria-label="新しいタグ名" placeholder="新しいタグ" required><button type="submit" aria-label="タグを作成">＋</button></form></div>`;
    document.body.append(popover);this.tagPopover=popover;
    const rect=anchor.getBoundingClientRect();const left=Math.max(8,Math.min(rect.left-12,innerWidth-popover.offsetWidth-8));
    popover.style.left=`${left}px`;popover.style.top=`${rect.bottom+9}px`;popover.style.setProperty('--arrow-left',`${rect.left+rect.width/2-left}px`);popover.style.maxHeight=`${Math.max(60,innerHeight-rect.bottom-20)}px`;
    popover.addEventListener('click',e=>{const button=(e.target as HTMLElement).closest<HTMLElement>('[data-assign]');const latest=this.data.getModelByID(id);if(button&&latest?.type==='text'){const tagId=button.dataset.assign!;this.commit({...latest,tags:latest.tags.includes(tagId)?latest.tags.filter(t=>t!==tagId):[...latest.tags,tagId]});this.closeTags();anchor.focus();}});
    popover.addEventListener('change',e=>{const input=e.target as HTMLInputElement;const row=input.closest<HTMLElement>('[data-tag]');const tag=row&&this.data.getModelByID(row.dataset.tag!);if(tag?.type==='tag'){if(input.type==='text'&&!input.value.trim()){input.value=tag.name;return;}this.commit({...tag,...(input.type==='color'?{color:input.value}:{name:input.value.trim()})});}});
    popover.querySelector('form')!.addEventListener('submit',e=>{e.preventDefault();const input=popover.querySelector<HTMLInputElement>('[name=name]')!;const name=input.value.trim();const latest=this.data.getModelByID(id);if(!name||latest?.type!=='text')return;const tag={id:crypto.randomUUID(),type:'tag' as const,name,color:'#6e8eef'};this.commands.execute(new Command(this.data).init(new Map<string,Model>([[tag.id,tag],[id,{...latest,tags:[...latest.tags,tag.id]}]])));this.closeTags();this.update();});
    popover.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();this.closeTags();anchor.focus();}});
    popover.querySelector('button')?.focus();
  }
  private edit(element:HTMLElement){
    this.finishEdit?.(true);
    const id=element.closest<HTMLElement>('[data-note]')!.dataset.note!;
    const model=this.models.get(id);if(model?.type!=='text')return;
    const field=element.dataset.noteField as 'title'|'content';
    element.textContent=model[field];element.contentEditable='plaintext-only';element.dataset.editing='true';
    element.setAttribute('role','textbox');element.setAttribute('aria-label',field==='title'?'タイトル':'内容');
    const controller=new AbortController();const options={signal:controller.signal};let finished=false;
    this.finishEdit=(save)=>{
      if(finished)return;finished=true;controller.abort();this.finishEdit=null;
      const value=element.innerText.replace(/\r/g,'');element.removeAttribute('contenteditable');delete element.dataset.editing;element.removeAttribute('role');element.removeAttribute('aria-label');
      const latest=this.data.getModelByID(id);
      if(save&&latest?.type==='text'&&latest[field]!==value)this.commands.execute(new Command(this.data).init(new Map([[id,{...latest,[field]:value}]])));
      this.panels.invalidate(id);this.dirty=true;this.update();
    };
    element.addEventListener('blur',()=>this.finishEdit?.(true),options);
    element.addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.finishEdit?.(false);}else if(e.key==='Enter'&&(field==='title'||e.ctrlKey||e.metaKey)){e.preventDefault();this.finishEdit?.(true);}},options);
    element.focus();
  }
}
