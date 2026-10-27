import {Command,CommandManager,DataLayer,EventID,type Model,type CommentModel} from './model';
import {KeyedDOM} from './dom';
import {type Identity,type Role,canChange} from './access';
export const escapeHTML=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function commentHTML(m:CommentModel,editable:boolean){return `<section class="note-comment" data-comment="${escapeHTML(m.id)}"><div class="comment-heading"><strong>${escapeHTML(m.title||'コメント')}</strong><span class="comment-author" title="${escapeHTML(m.authorEmail)}">${escapeHTML(m.authorName||m.authorEmail)}</span></div><p>${escapeHTML(m.content)}</p>${editable?`<div class="comment-actions"><button data-edit-comment="${escapeHTML(m.id)}">編集</button><button data-delete-comment="${escapeHTML(m.id)}">削除</button></div>`:''}</section>`;}
export class Comments{
  private user:Identity|null=null;
  private role:Role|null=null;
  private models=new Map<string,Model>();
  private list!:KeyedDOM;
  private form!:HTMLFormElement;
  private editing:string|null=null;
  private target='';
  constructor(private data:DataLayer,private commands:CommandManager,private go:(id:string)=>void,private selected:()=>string|null){
    for(const m of data.all())this.models.set(m.id,m);
    for(const e of Object.values(EventID))data.streamEvent(e,({id,model,previous})=>{if(model)this.models.set(id,model);else this.models.delete(id);if(this.list&&(model?.type==='comment'||previous?.type==='comment'))this.render(id);});
  }
  init(host:HTMLElement){
    const aside=document.querySelector('.tags')!;aside.insertAdjacentHTML('beforeend','<section class="board-comments"><div class="tag-heading"><h2>コメント</h2><button id="add-comment" aria-label="コメントを追加">＋</button></div><div id="comment-list"></div></section>');
    this.list=new KeyedDOM(aside.querySelector('#comment-list')!);
    this.form=document.createElement('form');this.form.className='comment-composer';this.form.hidden=true;
    this.form.innerHTML='<label>対象<select name="to" required></select></label><input name="title" aria-label="コメントのタイトル" placeholder="タイトル" maxlength="1000"><textarea name="content" aria-label="コメントの内容" placeholder="コメント" required maxlength="100000"></textarea><div><button type="button" data-cancel-comment>閉じる</button><button type="submit">追加</button></div>';
    host.append(this.form);
    document.querySelector('#add-comment')!.addEventListener('click',()=>this.open(this.selected()));
    document.addEventListener('click',e=>{
      const el=e.target as HTMLElement,add=el.closest<HTMLElement>('[data-comment-to]'),edit=el.closest<HTMLElement>('[data-edit-comment]'),remove=el.closest<HTMLElement>('[data-delete-comment]'),go=el.closest<HTMLElement>('[data-comment-go]');
      if(add)this.open(add.dataset.commentTo!);
      if(edit){const m=this.models.get(edit.dataset.editComment!);if(m?.type==='comment'&&this.allowed(m))this.open(m.to,m);}
      if(remove){const m=this.models.get(remove.dataset.deleteComment!);if(m?.type==='comment'&&this.allowed(m))this.commands.execute(new Command(this.data).init(new Map([[m.id,null]])));}
      if(go)this.go(go.dataset.commentGo!);
    });
    this.form.querySelector('[data-cancel-comment]')!.addEventListener('click',()=>this.reset());
    this.form.addEventListener('submit',e=>{e.preventDefault();if(!this.user||!this.role)return;const fd=new FormData(this.form),to=this.editing?this.target:String(fd.get('to'));if(this.models.get(to)?.type!=='text')return;const old=this.editing?this.models.get(this.editing):null;const comment:CommentModel={id:old?.id??crypto.randomUUID(),type:'comment',to,title:String(fd.get('title')).trim(),content:String(fd.get('content')),authorUid:old?.type==='comment'?old.authorUid:this.user.uid,authorEmail:old?.type==='comment'?old.authorEmail:this.user.email,authorName:old?.type==='comment'?old.authorName:this.user.name,createdAt:old?.type==='comment'?old.createdAt:Date.now()};this.commands.execute(new Command(this.data).init(new Map([[comment.id,comment]])));this.reset();});
  }
  setAccess(role:Role|null,user:Identity|null){this.reset();this.role=role;this.user=user;(document.querySelector('#add-comment') as HTMLButtonElement).disabled=!role;for(const m of this.models.values())if(m.type==='comment')this.render(m.id);}
  private allowed(m:CommentModel){return canChange(this.role,this.user,m,m);}
  private render(id:string){const m=this.models.get(id);if(m?.type!=='comment'){this.list.remove(id);return;}this.list.upsert(id,`<div class="board-comment" data-comment="${escapeHTML(id)}"><button data-comment-go="${escapeHTML(m.to)}"><strong>${escapeHTML(m.title||'コメント')}</strong><span class="comment-author">${escapeHTML(m.authorName||m.authorEmail)}</span><span>${escapeHTML(m.content)}</span></button>${this.allowed(m)?`<div class="comment-actions"><button data-edit-comment="${escapeHTML(id)}">編集</button><button data-delete-comment="${escapeHTML(id)}">削除</button></div>`:''}</div>`);}
  reset(){if(this.form)this.form.hidden=true;this.editing=null;}
  private open(to:string|null,model?:CommentModel){
    if(!this.role||!this.user)return;this.target=to??'';this.editing=model?.id??null;
    const select=this.form.elements.namedItem('to') as HTMLSelectElement;
    select.replaceChildren();for(const m of this.models.values())if(m.type==='text'){const option=new Option(m.title||'無題',m.id);select.add(option);}if(this.target)select.value=this.target;
    select.disabled=!!model;
    // Disabled form controls are omitted from FormData; keep the target available on edit.
    if(model){select.disabled=false;select.style.pointerEvents='none';select.tabIndex=-1;}else{select.style.pointerEvents='';select.tabIndex=0;}
    (this.form.elements.namedItem('title') as HTMLInputElement).value=model?.title??'';(this.form.elements.namedItem('content') as HTMLTextAreaElement).value=model?.content??'';
    this.form.querySelector('[type=submit]')!.textContent=model?'変更':'追加';this.form.hidden=false;(this.form.elements.namedItem('content') as HTMLTextAreaElement).focus();
  }
}
