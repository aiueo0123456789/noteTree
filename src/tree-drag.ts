import type {TreeDrop} from './hierarchy';
type Candidate={drop:TreeDrop;x:number;y:number};
/** One retained insertion line; pointer movement only changes styles. */
export class TreeDrag{
  private drag:{id:string;pointer:number;x:number;y:number;started:boolean}|null=null;
  private candidate:Candidate|null=null;
  private line:HTMLElement;
  private capture:HTMLElement|null=null;
  private frame=0;
  private last={x:0,y:0};
  private suppressClick=false;
  private enabled=true;
  get active(){return this.drag!==null;}
  constructor(private nav:HTMLElement,private valid:(id:string,drop:TreeDrop)=>boolean,private apply:(id:string,drop:TreeDrop)=>void){
    this.line=document.createElement('div');this.line.className='tree-insertion-line';this.line.hidden=true;nav.append(this.line);
    nav.addEventListener('pointerdown',e=>{
      if(!this.enabled||e.button!==0||!e.isPrimary)return;
      const row=(e.target as HTMLElement).closest<HTMLElement>('[data-tree-node]');if(!row)return;
      this.suppressClick=false;this.capture=row;
      this.drag={id:row.dataset.treeNode!,pointer:e.pointerId,x:e.clientX,y:e.clientY,started:false};this.last={x:e.clientX,y:e.clientY};row.setPointerCapture(e.pointerId);
    });
    nav.addEventListener('pointermove',e=>{const drag=this.drag;if(!drag||drag.pointer!==e.pointerId)return;this.last={x:e.clientX,y:e.clientY};if(!drag.started&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<6)return;
      e.preventDefault();if(!drag.started){drag.started=true;nav.classList.add('tree-dragging');this.tick();}this.locate();
    });
    nav.addEventListener('pointerup',e=>{if(this.drag?.pointer!==e.pointerId)return;const {id,started}=this.drag;const drop=this.candidate?.drop;this.suppressClick=started;this.cancel();if(started&&drop&&this.enabled)this.apply(id,drop);});
    nav.addEventListener('pointercancel',()=>this.cancel());nav.addEventListener('lostpointercapture',()=>this.cancel());
    nav.addEventListener('click',e=>{if(this.suppressClick){e.preventDefault();e.stopPropagation();this.suppressClick=false;}},true);
    nav.addEventListener('dragstart',e=>e.preventDefault());
    window.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.drag){this.suppressClick=true;this.cancel();e.preventDefault();e.stopPropagation();}},true);
    window.addEventListener('blur',()=>this.cancel());
  }
  setEnabled(value:boolean){this.enabled=value;this.nav.classList.toggle('tree-can-drag',value);if(!value)this.cancel();}
  cancel(){const pointer=this.drag?.pointer;this.drag=null;this.candidate=null;this.line.hidden=true;this.nav.classList.remove('tree-dragging');cancelAnimationFrame(this.frame);this.frame=0;if(pointer!==undefined&&this.capture?.hasPointerCapture(pointer))this.capture.releasePointerCapture(pointer);this.capture=null;}
  private tick=()=>{
    if(!this.drag?.started)return;
    const rect=this.nav.getBoundingClientRect();
    if(this.last.x>=rect.left&&this.last.x<=rect.right&&this.last.y>=rect.top&&this.last.y<=rect.bottom){
      const speed=this.last.y<rect.top+30?-8:this.last.y>rect.bottom-30?8:0;
      if(speed){this.nav.scrollTop+=speed;this.locate();}
    }
    this.frame=requestAnimationFrame(this.tick);
  };
  private locate(){
    this.candidate=null;this.line.hidden=true;if(!this.drag)return;
    const bounds=this.nav.getBoundingClientRect(),{x,y}=this.last;
    if(x<bounds.left||x>bounds.right||y<bounds.top||y>bounds.bottom)return;
    const rows=[...this.nav.querySelectorAll<HTMLElement>('[data-tree-node]')];
    const row=rows.find(el=>{const r=el.getBoundingClientRect();return y>=r.top&&y<=r.bottom;});
    let drop:TreeDrop,depth=0,lineY:number;
    if(!row){if(!rows.length||y<rows[0].getBoundingClientRect().top)return;drop={parent:null,before:null};lineY=rows.at(-1)!.getBoundingClientRect().bottom;}
    else{
      const rect=row.getBoundingClientRect(),fraction=(y-rect.top)/rect.height;depth=Number(row.dataset.depth);
      const id=row.dataset.treeNode!,parent=row.dataset.parent||null;
      const at=rows.indexOf(row);let end=at;while(end+1<rows.length&&Number(rows[end+1].dataset.depth)>depth)end++;
      if(fraction<.25){drop={parent,before:id};lineY=rect.top;}
      else if(fraction>.75){const next=rows[end+1];drop={parent,before:next&&Number(next.dataset.depth)===depth&&(next.dataset.parent||null)===parent?next.dataset.treeNode!:null};lineY=rows[end].getBoundingClientRect().bottom;}
      else{drop={parent:id,before:rows[at+1]?.dataset.parent===id?rows[at+1].dataset.treeNode!:null};depth++;lineY=rect.bottom;}
    }
    if(!this.valid(this.drag.id,drop))return;
    const indent=parseFloat(getComputedStyle(this.nav).getPropertyValue('--tree-indent'))||14;
    const lineX=8+depth*indent;
    this.candidate={drop,x:lineX,y:lineY-bounds.top+this.nav.scrollTop};
    this.line.style.left=`${lineX}px`;this.line.style.top=`${this.candidate.y}px`;this.line.style.width=`${Math.max(12,this.nav.clientWidth-lineX-8)}px`;this.line.hidden=false;
  }
}
