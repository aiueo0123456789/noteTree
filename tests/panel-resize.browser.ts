import '../src/style.css';
import {RendererManager} from '../src/renderer-manager';
import {DataLayer,CommandManager,seed} from '../src/model';
const lines:string[]=[],assert=(value:unknown,label:string)=>{if(!value)throw Error(label);lines.push('PASS '+label);};
const capture=HTMLElement.prototype.setPointerCapture;
const keys=['notetree.panel.board.tools','notetree.panel.board.tags','notetree.panel.note.outline'];
const saved=keys.map(k=>localStorage.getItem(k));
try{
  keys.forEach(k=>localStorage.removeItem(k));
  const data=new DataLayer(seed()),commands=new CommandManager(),manager=new RendererManager(data,commands);manager.init();manager.switchView('note');
  await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  HTMLElement.prototype.setPointerCapture=()=>{};
  const handle=document.querySelector<HTMLElement>('.note-view .panel-separator')!,nav=document.querySelector<HTMLElement>('.note-outline')!;
  const send=(type:string,x:number)=>handle.dispatchEvent(new PointerEvent(type,{bubbles:true,isPrimary:true,pointerId:1,button:0,clientX:x,clientY:200}));
  const previous=JSON.stringify(data.all()),width=nav.clientWidth;
  send('pointerdown',width);const observer=new MutationObserver(()=>{});observer.observe(document.querySelector('#app')!,{childList:true,subtree:true});
  for(let i=0;i<200;i++)send('pointermove',width+1+i/2);
  assert(nav.clientWidth>width+90,'note outline resizes');assert(!observer.takeRecords().length,'200 frames create no DOM nodes');observer.disconnect();send('pointerup',width+100);
  assert(JSON.stringify(data.all())===previous&&commands.undoStack.length===0,'resize does not change models or undo history');assert(Number(localStorage.getItem(keys[2]))>0,'ratio is saved');
  const after=nav.clientWidth;send('pointerdown',after);send('pointermove',after+60);window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));assert(nav.clientWidth===after,'Escape restores width');
  manager.switchView('board');await new Promise(requestAnimationFrame);
  const boardHandle=document.querySelector<HTMLElement>('.board-view .panel-separator:last-child')!,tags=document.querySelector<HTMLElement>('.tags')!,tagWidth=tags.clientWidth;
  boardHandle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));assert(tags.clientWidth>tagWidth,'right panel expands towards left');
  manager.switchView('note');manager.setAccess('viewer',{uid:'v',email:'v@gmail.com',name:'v'});manager.update();await new Promise(requestAnimationFrame);
  handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert(nav.clientWidth>after,'viewer can resize');
  document.querySelector('#results')!.textContent=lines.join('\n')+'\nALL PASSED';
}catch(error){document.querySelector('#results')!.textContent=lines.join('\n')+'\nFAIL '+String(error);}
finally{HTMLElement.prototype.setPointerCapture=capture;keys.forEach((key,i)=>saved[i]===null?localStorage.removeItem(key):localStorage.setItem(key,saved[i]!));}
