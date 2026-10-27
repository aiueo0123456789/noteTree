import {PanelResize} from './panel-resize';
import {downloadText} from './text-export';
import {Comments} from './comments';
import {canChange,type Identity,type Role} from './access';
import { Search } from './search';
import { BoardRenderer } from './renderer';
import { NoteRenderer } from './note-renderer';
import { CommandManager, DataLayer } from './model';
export class RendererManager {
  private splitters:PanelResize[]=[];
  private search:Search;
  private comments:Comments;
  private visible=true;
  readonly board:BoardRenderer;
  readonly note:NoteRenderer;
  private mode:'board'|'note'='board';
  constructor(private data:DataLayer,private commands:CommandManager){this.board=new BoardRenderer(data,commands);this.note=new NoteRenderer(data,commands);this.comments=new Comments(data,commands,id=>this.board.focusText(id),()=>this.mode==='note'?this.note.current:[...this.board.selected].find(id=>data.getModelByID(id)?.type==='text')??null);this.search=new Search(data,id=>{if(this.mode==='note')this.note.navigate(id);else this.board.focusText(id);});}
  init(){
    document.querySelector('#app')!.innerHTML=`<header><button id="login" type="button">Googleでログイン</button><span id="account" hidden></span><button id="logout" type="button" hidden>ログアウト</button><button id="cloud-save" type="button" hidden>保存</button><button id="sync-retry" type="button" hidden title="変更を保存して最新データを取得">同期</button><span id="save-status" role="status">ローカル保存</span><button id="export-text" type="button" title="テキストファイルを書き出す">エクスポート</button><button id="redraw" title="全体を再描画" aria-label="全体を再描画">再描画</button><div class="history"><button id="undo" title="元に戻す (⌘Z)" aria-label="元に戻す">↶</button><button id="redo" title="やり直す (⌘⇧Z)" aria-label="やり直す">↷</button></div><button id="theme-toggle" aria-label="ダークモード" aria-pressed="false">◐</button><div class="view-switch" role="group" aria-label="表示形式"><button data-view="board" aria-pressed="true">Board</button><button data-view="note" aria-pressed="false">Note</button></div></header><div id="session-warning" role="status" hidden></div><main id="renderer-host"><div class="board-view"></div><div class="note-view" hidden></div></main>`;
    this.board.init(document.querySelector('.board-view')!);this.note.init(document.querySelector('.note-view')!);
    this.splitters=[new PanelResize(document.querySelector('.board-view')!,'board'),new PanelResize(document.querySelector('.note-view')!,'note')];
    this.comments.init(document.querySelector('#renderer-host')!);
    this.search.init(document.querySelector('#renderer-host')!);
    this.commands.onChange=()=>{(document.querySelector('#undo') as HTMLButtonElement).disabled=!this.commands.undoStack.length;(document.querySelector('#redo') as HTMLButtonElement).disabled=!this.commands.redoStack.length;};
    this.commands.onChange();
    document.querySelector('#undo')!.addEventListener('click',()=>this.commands.undo());
    document.querySelector('#redo')!.addEventListener('click',()=>this.commands.redo());
    document.querySelector('#export-text')!.addEventListener('click',()=>{if(this.visible)downloadText(this.data.all(),document.querySelector('#project-name')?.textContent??'NoteTree');});
    document.querySelector('#redraw')!.addEventListener('click',()=>this.active.redraw());
    document.querySelectorAll<HTMLElement>('[data-view]').forEach(button=>button.addEventListener('click',()=>this.switchView(button.dataset.view as 'board'|'note')));
    window.addEventListener('keydown',e=>{if(!this.visible)return;if((e.target as HTMLElement).closest('input,textarea,select,[contenteditable]'))return;if(e.metaKey||e.ctrlKey){if(e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?this.commands.redo():this.commands.undo();}else if(e.key.toLowerCase()==='y'){e.preventDefault();this.commands.redo();}}});
    const media=matchMedia('(prefers-color-scheme: dark)');
    const applyTheme=(dark:boolean)=>{document.documentElement.dataset.theme=dark?'dark':'light';const button=document.querySelector('#theme-toggle')!;button.setAttribute('aria-pressed',String(dark));button.setAttribute('aria-label',dark?'ライトモード':'ダークモード');};
    applyTheme(localStorage.getItem('notetree.theme')?localStorage.getItem('notetree.theme')==='dark':media.matches);
    media.addEventListener('change',()=>{if(!localStorage.getItem('notetree.theme'))applyTheme(media.matches);});
    document.querySelector('#theme-toggle')!.addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';localStorage.setItem('notetree.theme',dark?'dark':'light');applyTheme(dark);});
  }
  private get active(){return this.mode==='board'?this.board:this.note;}
  switchView(mode:'board'|'note'){
    if(mode===this.mode)return;
    this.splitters.forEach(s=>s.cancel());this.active.setActive(false);this.mode=mode;
    (document.querySelector('.board-view') as HTMLElement).hidden=mode!=='board';
    (document.querySelector('.note-view') as HTMLElement).hidden=mode!=='note';
    document.querySelectorAll<HTMLElement>('[data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===mode)));
    this.active.setActive(true);this.active.update();
  }
  resetInteraction(){this.splitters.forEach(s=>s.cancel());this.comments.reset();this.search.reset();this.board.resetInteraction();this.note.resetInteraction();}
  setAccess(role:Role|null,user:Identity|null){
    this.resetInteraction();this.commands.canChange=(next,previous)=>canChange(role,user,next,previous);
    this.board.setEditable(role==='owner'||role==='editor');this.note.setAccess(role,user);this.comments.setAccess(role,user);
    document.querySelector('#renderer-host')!.classList.toggle('read-only',role!=='owner'&&role!=='editor');
  }
  setVisible(visible:boolean){const wasVisible=this.visible;this.resetInteraction();this.visible=visible;(document.querySelector('#export-text') as HTMLElement).hidden=!visible;(document.querySelector('#renderer-host') as HTMLElement).hidden=!visible;this.board.setActive(visible&&this.mode==='board');this.note.setActive(visible&&this.mode==='note');if(visible){if(!wasVisible&&this.mode==='board')this.board.fit();this.active.update();}}
  update(){if(this.visible)this.active.update();}
}
