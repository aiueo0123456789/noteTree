import {appendConnectionChanges} from './hierarchy';
import { Scene } from './scene';
import { Command, CommandManager, DataLayer, EventID, deletionChanges, type Model, type TextModel, type Vec2, type VirtualData } from './model';
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export class BoardRenderer {
  private active = true;
  private editable=true;
  setEditable(value:boolean){this.resetInteraction();this.editable=value;this.scene?.setEditable(value);}
  virtualDataMap = new Map<string, VirtualData>();
  camera = { position: {x: 40, y: 45}, zoom: 1 };
  selected = new Set<string>();
  private dirty = true;
  private cameraDirty = true;
  private searchHighlight!:HTMLElement;
  private bbox!: HTMLElement;
  private marquee!: HTMLElement;
  private connectionPreview!: HTMLElement;
  private scene!: Scene;
  private lastZoom = -1;
  private board!: HTMLElement;
  private world!: HTMLElement;
  private from: string | null = null;
  private tool: 'text' | 'connection' | null = null;
  private pointers = new Map<number, Vec2>();
  private gesture: {kind: 'pan' | 'move' | 'resize' | 'palette' | 'select'; start: Vec2; camera: Vec2; originals: TextModel[]; tool?: 'text' | 'connection'; current: Vec2; edit?: { id: string; field: 'title' | 'content' } } | null = null;
  private pinch: {distance: number; zoom: number; anchor: Vec2} | null = null;
  private lastTap = { key: '', time: 0 };
  private multiSelect = false;
  private finishEdit: ((save: boolean) => void) | null = null;
  private tagPopover: HTMLElement | null = null;
  constructor(public data: DataLayer, public commands: CommandManager) {}
  init(host: HTMLElement) {
    host.innerHTML = `<aside class="tools"><button class="palette" data-tool="text" title="ドラッグして追加"><span class="tool-icon">T</span><span>テキスト</span></button><button class="palette" data-tool="connection" title="始点にドラッグして接続"><span class="tool-icon">↗</span><span>接続</span></button></aside><section id="board" aria-label="ツリーボード"><div id="world"></div><div id="hint" role="status"></div><div class="zoom"><button id="zoom-in" aria-label="拡大">＋</button><input id="zoom-range" type="range" min="25" max="200" value="100" aria-label="ズーム"><button id="zoom-out" aria-label="縮小">−</button><output id="zoom-value">100%</output><button id="multi-select" aria-label="複数選択モード" title="複数選択モード" aria-pressed="false">▧</button><button id="fit" title="全体を表示" aria-label="全体を表示">⌗</button></div></section><aside class="tags"><div class="tag-heading"><h2>タグ</h2><button id="add-tag" aria-label="タグを作成">＋</button></div><div id="tag-list"></div></aside>`;
    this.board = document.querySelector('#board')!; this.world = document.querySelector('#world')!;
    this.world.innerHTML='<div class="bbox" hidden><div class="bbox-handle" title="選択をまとめて移動">⠿</div><button data-delete-selection aria-label="選択を削除">×</button></div><div class="marquee" hidden></div><div class="connection-preview" hidden></div>';
    this.searchHighlight=document.createElement('div');this.searchHighlight.className='search-highlight';this.searchHighlight.hidden=true;this.world.append(this.searchHighlight);
    for(const event of ['pointerdown','wheel','keydown'])document.addEventListener(event,()=>{this.searchHighlight.hidden=true;},{capture:true,passive:true});
    this.bbox=this.world.querySelector('.bbox')!;
    this.marquee=this.world.querySelector('.marquee')!;
    this.connectionPreview=this.world.querySelector('.connection-preview')!;
    this.scene = new Scene(this.data,this.world,document.querySelector('#tag-list')!);
    Object.values(EventID).forEach(event => this.data.streamEvent(event, () => { this.dirty = true; }));
    document.querySelector('#add-tag')!.addEventListener('click', () => this.editTag());
    document.querySelector('#zoom-in')!.addEventListener('click', () => this.zoom(this.camera.zoom * 1.2));
    document.querySelector('#zoom-out')!.addEventListener('click', () => this.zoom(this.camera.zoom / 1.2));
    document.querySelector('#zoom-range')!.addEventListener('input', e => this.zoom(Number((e.target as HTMLInputElement).value) / 100));
    document.querySelector('#multi-select')!.addEventListener('click', () => {this.multiSelect=!this.multiSelect;document.querySelector('#multi-select')!.setAttribute('aria-pressed',String(this.multiSelect));});
    document.querySelector('#fit')!.addEventListener('click', () => this.fit());
    document.querySelectorAll<HTMLElement>('[data-tool]').forEach(el => {
      el.addEventListener('pointerdown', e => { if(!this.editable||e.button !== 0) return; e.preventDefault(); this.gesture = {kind:'palette',start:{x:e.clientX,y:e.clientY},current:{x:e.clientX,y:e.clientY},camera:{...this.camera.position},originals:[],tool:el.dataset.tool as 'text'|'connection'}; });
    });
    document.addEventListener('pointerdown', e => {
      const target = e.target as HTMLElement;
      if (this.finishEdit && !target.closest('[data-editing="true"]')) this.finishEdit(true);
      if (this.tagPopover && !target.closest('.tag-popover,[data-add-tag]')) this.closeTagPopover();
    }, true);
    this.board.addEventListener('pointerdown', e => this.down(e));
    window.addEventListener('pointermove', e => {if(this.active)this.move(e);});
    window.addEventListener('pointerup', e => {if(this.active)this.up(e);});
    window.addEventListener('pointercancel', () => this.cancel());
    this.board.addEventListener('wheel', e => { if ((e.target as HTMLElement).closest('[contenteditable]')) return; this.closeTagPopover(); e.preventDefault(); this.zoom(this.camera.zoom * Math.exp(-e.deltaY * .0015), this.local(e)); }, {passive:false});
    this.board.addEventListener('click', e => this.click(e));
    document.querySelector('#tag-list')!.addEventListener('dblclick', e => { const name = (e.target as HTMLElement).closest<HTMLElement>('.tag-name'); const row=name?.closest<HTMLElement>('[data-tag]'); if(row) this.editTag(row.dataset.tag); });
    document.querySelector('#tag-list')!.addEventListener('click', e => { const button = (e.target as HTMLElement).closest<HTMLElement>('[data-delete-tag]'); if(button) this.commit(deletionChanges(this.data, new Set([button.dataset.deleteTag!]))); });
    document.querySelector('#tag-list')!.addEventListener('change', e => {
      const input=e.target as HTMLInputElement;
      if(!input.matches('[data-tag-color]')) return;
      const model=this.data.getModelByID(input.dataset.tagColor!);
      if(model?.type==='tag') this.change({...model,color:input.value});
    });
    window.addEventListener('keydown', e => {
      if(!this.active)return;
      if ((e.target as HTMLElement).closest('input,textarea,select,[data-editing="true"],.search-panel')) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {e.preventDefault(); this.selected = new Set(this.data.all().filter(m=>m.type !== 'tag').map(m=>m.id)); this.dirty=true;}
      if (this.editable && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); this.removeSelected(); }
      if (e.key === 'Escape') {this.closeTagPopover();this.cancel(); this.selected.clear(); this.dirty=true;}
    });
    window.addEventListener('resize', () => {this.closeTagPopover();this.cameraDirty = true;});
    this.fit();
  }
  setActive(active: boolean){if(!active){this.finishEdit?.(true);this.resetInteraction();}this.active=active;this.cameraDirty=true;}
  redraw(){this.finishEdit?.(true);this.closeTagPopover();this.scene.redraw();this.dirty=true;}
  focusText(id:string){
    this.finishEdit?.(true);this.resetInteraction();
    const model=this.data.getModelByID(id);if(model?.type!=='text')return;
    const height=model.collapsed?40:model.size.y;
    this.camera.position={x:this.board.clientWidth/2-(model.position.x+model.size.x/2)*this.camera.zoom,y:this.board.clientHeight/2-(model.position.y+height/2)*this.camera.zoom};
    this.cameraDirty=true;this.update();
    this.searchHighlight.style.transform=`translate(${model.position.x-4}px,${model.position.y-4}px)`;
    this.searchHighlight.style.width=`${model.size.x+8}px`;this.searchHighlight.style.height=`${height+8}px`;this.searchHighlight.hidden=false;
  }
  resetInteraction(){this.searchHighlight.hidden=true;this.finishEdit?.(false);this.closeTagPopover();this.cancel();this.selected.clear();this.dirty=true;}
  private local(e: {clientX:number;clientY:number}) { const r = this.board.getBoundingClientRect(); return {x:e.clientX-r.left,y:e.clientY-r.top}; }
  private point(p: Vec2): Vec2 { return {x:(p.x-this.camera.position.x)/this.camera.zoom,y:(p.y-this.camera.position.y)/this.camera.zoom}; }
  private model(id: string) { return this.virtualDataMap.get(id) ?? this.data.getModelByID(id); }
  private commit(changes: Map<string, Model|null>) { if(this.editable&&changes.size) this.commands.execute(new Command(this.data).init(changes)); }
  private change(model: Model) { this.commit(new Map([[model.id,model]])); }
  private newText(position: Vec2): TextModel {return {id:crypto.randomUUID(),type:'text',index:Math.max(-1,...this.data.all().filter((m):m is TextModel=>m.type==='text').map(m=>Number.isFinite(m.index)?m.index:0))+1,title:'新しい話題',content:'',tags:[],position,size:{x:280,y:160},collapsed:false};}
  private cancel() {this.gesture=null;this.pinch=null;this.pointers.clear();this.virtualDataMap.clear();this.from=null;this.tool=null;this.dirty=true;}
  private down(e: PointerEvent) {
    const resizeHandle=(e.target as HTMLElement).closest<HTMLElement>('[data-resize]');
    if(e.button !== 0 || (!resizeHandle && (e.target as HTMLElement).closest('button,input,textarea,[data-editing="true"]'))) return;
    const p=this.local(e); this.pointers.set(e.pointerId,p);
    if(this.pointers.size===2) {const [a,b]=[...this.pointers.values()];this.virtualDataMap.clear();this.gesture=null;this.pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:this.camera.zoom,anchor:this.point({x:(a.x+b.x)/2,y:(a.y+b.y)/2})};return;}
    if(resizeHandle&&!this.editable)return;
    if(resizeHandle){
      const model=this.data.getModelByID(resizeHandle.closest<HTMLElement>('[data-node]')!.dataset.node!);
      if(model?.type!=='text'||model.collapsed)return;
      e.preventDefault();this.tool=null;this.from=null;this.selected=new Set([model.id]);
      this.gesture={kind:'resize',start:p,current:p,camera:{...this.camera.position},originals:[model]};
      this.board.setPointerCapture(e.pointerId);this.dirty=true;return;
    }
    if(this.tool || this.from) return;
    const target=(e.target as HTMLElement).closest<HTMLElement>('[data-node],[data-edge],.bbox');
    const id=target?.dataset.node ?? target?.dataset.edge;
    if(id) { if(e.shiftKey || this.multiSelect) {this.selected.has(id)?this.selected.delete(id):this.selected.add(id);} else if(!this.selected.has(id)) this.selected=new Set([id]); }
    else if(!target && !e.shiftKey && !this.multiSelect) this.selected.clear();
    const originals=this.data.all().filter((m):m is TextModel=>m.type==='text'&&this.selected.has(m.id));
    const field=(e.target as HTMLElement).closest<HTMLElement>('[data-field]');
    this.gesture={kind: target&&this.editable ? 'move' : (e.shiftKey || this.multiSelect) ? 'select':'pan',start:p,current:p,camera:{...this.camera.position},originals,edit:id&&field?{id,field:field.dataset.field as 'title'|'content'}:undefined};
    if(e.pointerType==='touch')this.board.setPointerCapture(e.pointerId);
    this.dirty=true;
  }
  private move(e: PointerEvent) {
    const p=this.local(e); if(this.pointers.has(e.pointerId))this.pointers.set(e.pointerId,p);
    if(this.pinch&&this.pointers.size===2) {const [a,b]=[...this.pointers.values()];this.camera.zoom=Math.max(.25,Math.min(2,this.pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,this.pinch.distance)));this.camera.position={x:(a.x+b.x)/2-this.pinch.anchor.x*this.camera.zoom,y:(a.y+b.y)/2-this.pinch.anchor.y*this.camera.zoom};this.cameraDirty=true;return;}
    const g=this.gesture;if(!g)return;
    g.current=g.kind==='palette'?{x:e.clientX,y:e.clientY}:p;
    if(g.kind==='palette'&&g.tool==='text') {const node=this.newText(this.point(p));node.id='preview';this.virtualDataMap.set('preview',node);}
    const dx=(p.x-g.start.x)/this.camera.zoom,dy=(p.y-g.start.y)/this.camera.zoom;
    if(g.kind==='pan'){this.camera.position={x:g.camera.x+p.x-g.start.x,y:g.camera.y+p.y-g.start.y};this.cameraDirty=true;return;}
    if(g.kind==='resize'){const model=g.originals[0];this.virtualDataMap.set(model.id,{...model,size:{x:Math.max(180,model.size.x+dx),y:Math.max(80,model.size.y+dy)}});}
    if(g.kind==='move')g.originals.forEach(m=>this.virtualDataMap.set(m.id,{...m,position:{x:m.position.x+dx,y:m.position.y+dy}}));
    this.dirty=true;
  }
  private up(e: PointerEvent) {
    this.pointers.delete(e.pointerId);if(this.pinch){if(this.pointers.size===0)this.pinch=null;return;}
    const g=this.gesture;this.gesture=null;if(!g)return;
    if(g.kind==='palette') {
      const r=this.board.getBoundingClientRect();const inside=e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;
      const moved=Math.hypot(e.clientX-g.start.x,e.clientY-g.start.y)>8;
      if(inside) {if(g.tool==='text')this.change(this.newText(this.point(this.local(e))));else {const node=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-node]');this.from=node?.dataset.node??null;this.tool='connection';}}
      else if(!moved) {this.tool=g.tool!;}
    }
    if(this.editable&&g.edit && Math.hypot(g.current.x-g.start.x,g.current.y-g.start.y)<4){const key=g.edit.id+g.edit.field;const now=Date.now();if(this.lastTap.key===key && now-this.lastTap.time<400){this.editText(g.edit.id,g.edit.field);this.lastTap={key:'',time:0};}else this.lastTap={key,time:now};}
    if(g.kind==='move'&&Math.hypot(g.current.x-g.start.x,g.current.y-g.start.y)>2)this.commit(new Map(this.virtualDataMap));
    if(g.kind==='resize'){const original=g.originals[0],next=this.virtualDataMap.get(original.id);if(next?.type==='text'&&(next.size.x!==original.size.x||next.size.y!==original.size.y))this.change(next);}
    if(g.kind==='select') {const a=this.point(g.start),b=this.point(g.current);this.data.all().forEach(m=>{if(m.type==='text'&&m.position.x<Math.max(a.x,b.x)&&m.position.x+m.size.x>Math.min(a.x,b.x)&&m.position.y<Math.max(a.y,b.y)&&m.position.y+(m.collapsed?40:m.size.y)>Math.min(a.y,b.y))this.selected.add(m.id);});}
    if (!this.finishEdit) this.virtualDataMap.clear();this.dirty=true;
  }
  private click(e: MouseEvent) {
    if(!this.editable)return;
    const el=e.target as HTMLElement;if(el.closest('[data-editing="true"]'))return;const node=el.closest<HTMLElement>('[data-node]'); const m=node&&this.data.getModelByID(node.dataset.node!);
    if(el.closest('[data-delete-selection]')) {this.removeSelected();return;}
    if(el.closest('[data-collapse]')&&m?.type==='text') {this.change({...m,collapsed:!m.collapsed});return;}
    const tag=el.closest<HTMLElement>('[data-remove-tag]');if(tag&&m?.type==='text'){this.change({...m,tags:m.tags.filter(id=>id!==tag.dataset.removeTag)});return;}
    if(el.closest('[data-add-tag]')&&m?.type==='text'){this.pickTag(m, el.closest<HTMLElement>('[data-add-tag]')!);return;}
    if(el.closest('button,input,.board-title'))return;
    if(this.tool==='text'){this.change(this.newText(this.point(this.local(e))));this.tool=null;}
    if(this.tool==='connection'&&m?.type==='text') {if(!this.from)this.from=m.id;else if(this.from!==m.id){const changes=appendConnectionChanges(this.data.all(),this.from,m);this.commit(changes);this.from=null;this.tool=null;}}
    this.dirty=true;
  }
  private removeSelected(){this.commit(deletionChanges(this.data,this.selected));this.selected.clear();this.dirty=true;}
  private zoom(value:number,at:Vec2={x:this.board.clientWidth/2,y:this.board.clientHeight/2}) {const anchor=this.point(at);this.camera.zoom=Math.max(.25,Math.min(2,value));this.camera.position={x:at.x-anchor.x*this.camera.zoom,y:at.y-anchor.y*this.camera.zoom};this.cameraDirty=true;}
  fit(){const nodes=this.data.all().filter((m):m is TextModel=>m.type==='text');if(!nodes.length)return;const minX=Math.min(...nodes.map(m=>m.position.x)),minY=Math.min(...nodes.map(m=>m.position.y));const width=Math.max(...nodes.map(m=>m.position.x+m.size.x))-minX,height=Math.max(...nodes.map(m=>m.position.y+(m.collapsed?40:m.size.y)))-minY;this.camera.zoom=Math.max(.25,Math.min(1,(this.board.clientWidth-100)/width,(this.board.clientHeight-180)/height));this.camera.position={x:(this.board.clientWidth-width*this.camera.zoom)/2-minX*this.camera.zoom,y:(this.board.clientHeight-height*this.camera.zoom)/2-minY*this.camera.zoom};this.cameraDirty=true;}
  // Keep the active DOM node in place: selection, caret and IME composition survive typing.
  private inlineEdit(element: HTMLElement, model: Model, value: string, apply: (value: string) => Model, multiline = false, isNew = false) {
    if(!this.editable)return;
    this.finishEdit?.(true);
    this.closeTagPopover();
    element.textContent = value;
    element.contentEditable = 'plaintext-only';
    element.dataset.editing = 'true';
    element.setAttribute('role', 'textbox');
    element.setAttribute('aria-label', model.type === 'tag' ? 'タグ名' : multiline ? '内容' : 'タイトル');
    element.setAttribute('aria-multiline', String(multiline));
    const controller = new AbortController();
    const options = {signal:controller.signal};
    let composing = false;
    let finished = false;
    const read = () => element.innerText.replace(/\r/g, '').replace(/\n$/, '');
    const finish = (save: boolean) => {
      if (finished) return;
      finished = true;
      controller.abort();
      this.finishEdit = null;
      const next = read();
      this.virtualDataMap.delete(model.id);
      element.removeAttribute('contenteditable');
      delete element.dataset.editing;
      for(const attr of ['role','aria-label','aria-multiline']) element.removeAttribute(attr);
      element.textContent = save ? next : value;
      if(isNew) element.closest('[data-tag]')?.remove();
      this.scene.invalidate(model.id);
      if (save && (isNew || next !== value) && (model.type !== 'tag' || next.trim())) this.change(apply(next));
      this.dirty = true;
    };
    this.finishEdit = finish;
    element.addEventListener('input', () => this.virtualDataMap.set(model.id, apply(read())), options);
    element.addEventListener('compositionstart', () => composing = true, options);
    element.addEventListener('compositionend', () => composing = false, options);
    element.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.isComposing || composing || e.keyCode === 229) return;
      if (e.key === 'Escape') {e.preventDefault();finish(false);}
      if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {e.preventDefault();finish(true);}
    }, options);
    element.addEventListener('blur', () => finish(true), {once:true, ...options});
    element.focus();
    const selection = window.getSelection();
    const range = document.createRange();range.selectNodeContents(element);range.collapse(false);
    selection?.removeAllRanges();selection?.addRange(range);
  }
  private editText(id:string,field:'title'|'content') {
    const model=this.data.getModelByID(id);
    const element=this.world.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"] [data-field="${field}"]`);
    if(model?.type !== 'text' || !element) return;
    this.inlineEdit(element, model, model[field], value => ({...model,[field]:value}), field === 'content');
  }
  private editTag(id?:string) {
    this.finishEdit?.(true);
    // Flush pending changes before starting another inline edit.
    this.update();
    const model=id ? this.data.getModelByID(id) : {id:crypto.randomUUID(),type:'tag' as const,name:'',color:'#6e8eef'};
    if(model?.type !== 'tag') return;
    const list=document.querySelector('#tag-list')!;
    if(!id) list.insertAdjacentHTML('beforeend',`<div class="tag-row" data-tag="${model.id}"><span class="dot" style="--tag:${model.color}"></span><span class="tag-name"></span></div>`);
    const element=list.querySelector<HTMLElement>(`[data-tag="${CSS.escape(model.id)}"] .tag-name`)!;
    this.inlineEdit(element, model, model.name, value => ({...model,name:value.trim()}), false, !id);
  }
  private closeTagPopover() {this.tagPopover?.remove();this.tagPopover=null;}
  private pickTag(model:TextModel, anchor:HTMLElement) {
    if(this.tagPopover){this.closeTagPopover();return;}
    const tags=this.data.all().filter(t=>t.type==='tag'&&!model.tags.includes(t.id));
    const popover=document.createElement('div');
    popover.className='tag-popover';popover.setAttribute('role','menu');popover.setAttribute('aria-label','タグを選択');
    popover.innerHTML=tags.length ? tags.map(tag=>tag.type==='tag'?`<button role="menuitem" data-pick-tag="${esc(tag.id)}"><span class="dot" style="--tag:${esc(tag.color)}"></span>${esc(tag.name)}</button>`:'').join('') : '<span class="empty-tags">タグなし</span>';
    const options=document.createElement('div');options.className='tag-options';
    while(popover.firstChild)options.append(popover.firstChild);popover.append(options);
    document.body.append(popover);this.tagPopover=popover;
    const rect=anchor.getBoundingClientRect();
    const left=Math.max(8,Math.min(rect.left-12,window.innerWidth-popover.offsetWidth-8));
    popover.style.left=`${left}px`;popover.style.top=`${rect.bottom+9}px`;
    popover.style.setProperty('--arrow-left',`${rect.left+rect.width/2-left}px`);
    popover.style.maxHeight=`${Math.max(60,window.innerHeight-rect.bottom-20)}px`;
    popover.addEventListener('click', e => {
      const button=(e.target as HTMLElement).closest<HTMLElement>('[data-pick-tag]');
      const current=this.data.getModelByID(model.id);
      if(button&&current?.type==='text'&&!current.tags.includes(button.dataset.pickTag!)) this.change({...current,tags:[...current.tags,button.dataset.pickTag!]});
      this.closeTagPopover();
    });
    popover.addEventListener('keydown',e=>{
      const buttons=[...popover.querySelectorAll<HTMLButtonElement>('button')];
      if(e.key==='Escape'){e.stopPropagation();this.closeTagPopover();anchor.focus();}
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
    });
    popover.querySelector('button')?.focus();
  }
  private updateCamera() {
    if (!this.cameraDirty) return;
    this.cameraDirty = false;
    this.world.style.transform=`translate(${this.camera.position.x}px,${this.camera.position.y}px) scale(${this.camera.zoom})`;
    this.board.style.backgroundPosition=`${this.camera.position.x}px ${this.camera.position.y}px`;
    if (this.lastZoom !== this.camera.zoom) {
      this.lastZoom = this.camera.zoom;
      this.board.style.backgroundSize=`${24*this.camera.zoom}px ${24*this.camera.zoom}px`;
      (document.querySelector('#zoom-range') as HTMLInputElement).value=String(Math.round(this.camera.zoom*100));
      const output=document.querySelector('#zoom-value')!;
      const value=`${Math.round(this.camera.zoom*100)}%`;
      if(output.firstChild) output.firstChild.nodeValue=value;
    }
  }
  update(){
    this.updateCamera();
    if(this.finishEdit)return;
    if(this.dirty){
      this.dirty=false;
      this.scene.ui(this.selected,this.virtualDataMap,this.from);
      const selectedNodes:TextModel[]=[];
      for(const id of this.selected){const m=this.scene.get(id);if(m?.type==='text')selectedNodes.push(m);if(m?.type==='connection')for(const end of [m.from,m.to]){const node=this.scene.get(end);if(node?.type==='text')selectedNodes.push(node);}}
      this.bbox.hidden=!selectedNodes.length;
      if(selectedNodes.length){
        const x=Math.min(...selectedNodes.map(m=>m.position.x))-12,y=Math.min(...selectedNodes.map(m=>m.position.y))-12;
        this.bbox.style.transform=`translate(${x}px, ${y}px)`;
        this.bbox.style.width=`${Math.max(...selectedNodes.map(m=>m.position.x+m.size.x))-x+12}px`;
        this.bbox.style.height=`${Math.max(...selectedNodes.map(m=>m.position.y+(m.collapsed?40:m.size.y)))-y+12}px`;
      }
      this.marquee.hidden=this.gesture?.kind!=='select';
      if(this.gesture?.kind==='select'){
        const a=this.point(this.gesture.start),b=this.point(this.gesture.current);
        this.marquee.style.transform=`translate(${Math.min(a.x,b.x)}px, ${Math.min(a.y,b.y)}px)`;
        this.marquee.style.width=`${Math.abs(a.x-b.x)}px`;this.marquee.style.height=`${Math.abs(a.y-b.y)}px`;
      }
      let previewPosition:Vec2|null=null,previewText='';
      if(this.gesture?.kind==='palette'&&this.gesture.tool==='connection'){
        previewPosition=this.point(this.local({clientX:this.gesture.current.x,clientY:this.gesture.current.y}));previewText='┄┄→ 始点にドロップ';
      }
      if(this.from){const source=this.scene.get(this.from);if(source?.type==='text'){previewPosition={x:source.position.x+source.size.x,y:source.position.y+26};previewText='┄┄→ 接続先を選択';}}
      this.connectionPreview.hidden=!previewPosition;
      if(previewPosition){this.connectionPreview.style.transform=`translate(${previewPosition.x}px, ${previewPosition.y}px)`;if(this.connectionPreview.textContent!==previewText)this.connectionPreview.textContent=previewText;}
      const hint=this.tool==='text'?'配置先を選択':this.from?'接続先を選択':this.tool==='connection'?'接続元を選択':'';
      if(document.querySelector('#hint')!.textContent!==hint)document.querySelector('#hint')!.textContent=hint;
    }
    this.scene.flush();
  }
}
