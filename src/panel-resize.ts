type Panel = {element:HTMLElement;handle:HTMLElement;key:string;variable:string;ratio:number;initial:number;end:boolean};
/** Retained separators only update CSS sizes, never models or rendered cards. */
export class PanelResize {
  private panels:Panel[]=[];
  private drag:{panel:Panel;pointer:number;ratio:number;vertical:boolean}|null=null;
  constructor(private host:HTMLElement,private kind:'board'|'note'){
    const specs=kind==='board'?[['.tools','tools',160,false,'モデル一覧のサイズ'],['.tags','tags',180,true,'タグ一覧のサイズ']] as const:[['.note-outline','outline',220,false,'ノート階層の幅']] as const;
    for(const [selector,key,initial,end,label] of specs){
      const handle=document.createElement('div');handle.className='panel-separator';handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-label',label);
      const storageKey=`notetree.panel.${kind}.${key}`;
      let saved=0;try{saved=Number(localStorage.getItem(storageKey));}catch{}
      const panel:Panel={element:host.querySelector(selector)!,handle,key:storageKey,variable:`--panel-${key}`,ratio:saved>0&&saved<1?saved:0,initial,end};
      this.panels.push(panel);host.append(handle);
      handle.addEventListener('pointerdown',e=>{if(e.button!==0||!e.isPrimary)return;e.preventDefault();e.stopPropagation();this.cancel();this.drag={panel,pointer:e.pointerId,ratio:panel.ratio,vertical:this.vertical};handle.setPointerCapture(e.pointerId);handle.classList.add('is-resizing');});
      handle.addEventListener('pointermove',e=>{
        if(this.drag?.pointer!==e.pointerId||this.drag.panel!==panel)return;
        const rect=host.getBoundingClientRect(),vertical=this.vertical;
        const offset=vertical?e.clientY-rect.top:e.clientX-rect.left,size=vertical?rect.height:rect.width;
        panel.ratio=(panel.end?size-offset:offset)/size;this.layout(panel);
      });
      handle.addEventListener('pointerup',e=>{if(this.drag?.pointer!==e.pointerId)return;this.save(panel);this.finish();});
      handle.addEventListener('pointercancel',()=>this.cancel());handle.addEventListener('lostpointercapture',()=>this.cancel());
      handle.addEventListener('keydown',e=>{
        if(e.key==='Escape'){this.cancel();return;}
        const negative=this.vertical?'ArrowUp':'ArrowLeft',positive=this.vertical?'ArrowDown':'ArrowRight';
        if(e.key!==negative&&e.key!==positive)return;e.preventDefault();e.stopPropagation();
        const size=this.vertical?host.clientHeight:host.clientWidth;
        panel.ratio+=(e.key===negative?-1:1)*(panel.end?-1:1)*(e.shiftKey?40:10)/size;this.layout(panel);this.save(panel);
      });
    }
    window.addEventListener('blur',()=>this.cancel());
    window.addEventListener('keydown',e=>{if(e.key==='Escape')this.cancel();});
    new ResizeObserver(()=>{if(this.drag&&this.drag.vertical!==this.vertical)this.cancel();this.layout();}).observe(host);
    this.layout();
  }
  private get vertical(){return this.kind==='board'&&matchMedia('(max-width:800px)').matches;}
  private save(panel:Panel){try{localStorage.setItem(panel.key,String(panel.ratio));}catch{}}
  private finish(){const drag=this.drag;this.drag=null;if(drag){drag.panel.handle.classList.remove('is-resizing');if(drag.panel.handle.hasPointerCapture(drag.pointer))drag.panel.handle.releasePointerCapture(drag.pointer);}}
  cancel(){if(this.drag){const {panel,ratio}=this.drag;panel.ratio=ratio;this.finish();this.layout(panel);}}
  private layout(changed?:Panel){
    const vertical=this.vertical,size=vertical?this.host.clientHeight:this.host.clientWidth;
    if(!size)return;
    const min=vertical?44:this.kind==='note'?80:100,centerMin=vertical?120:this.kind==='note'?160:200;
    const sizes=this.panels.map(p=>Math.max(min,p.ratio?size*p.ratio:vertical?(p.end?120:50):this.kind==='note'&&size<=800?130:p.initial));
    const budget=Math.max(this.panels.length*min,size-centerMin);
    if(changed){const i=this.panels.indexOf(changed),other=sizes.reduce((sum,n,j)=>sum+(i===j?0:n),0);sizes[i]=Math.min(sizes[i],Math.max(min,budget-other));}
    const excess=sizes.reduce((sum,n)=>sum+n,0)-budget;
    if(excess>0){const flexible=sizes.reduce((sum,n)=>sum+n-min,0);sizes.forEach((n,i)=>{sizes[i]=n-excess*(flexible?(n-min)/flexible:1/sizes.length);});}
    this.panels.forEach((p,i)=>{
      const px=Math.round(sizes[i]);p.ratio=px/size;
      this.host.style.setProperty(p.variable,`${px}px`);
      const handle=p.handle;handle.setAttribute('aria-orientation',vertical?'horizontal':'vertical');handle.setAttribute('aria-valuemin',String(min));handle.setAttribute('aria-valuemax',String(Math.round(budget-(this.panels.length-1)*min)));handle.setAttribute('aria-valuenow',String(px));
      handle.style.left=vertical?'0':`${p.end?size-px:px}px`;handle.style.top=vertical?`${p.end?size-px:px}px`:'0';
      handle.classList.toggle('is-horizontal',vertical);
    });
  }
}
