// Only runs against the explicitly enabled local demo emulators.
import {getAuth,GoogleAuthProvider,signInWithCredential,signOut} from 'firebase/auth';
import {getFirestore} from 'firebase/firestore';
import {ProjectStore} from '../src/project-store';
import {Command,type TextModel} from '../src/model';
const results=document.querySelector('#results')!,lines:string[]=[];
const assert=(condition:unknown,name:string)=>{if(!condition)throw new Error(name);lines.push('PASS '+name);results.textContent=lines.join('\n');};
const until=async(fn:()=>boolean)=>{for(let i=0;i<160;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Timed out: '+fn.toString());};
const click=(selector:string)=>(document.querySelector(selector) as HTMLElement).click();
const fill=(selector:string,value:string)=>{(document.querySelector(selector) as HTMLInputElement).value=value;};
async function login(email:string){return signInWithCredential(getAuth(),GoogleAuthProvider.credential(JSON.stringify({sub:email,email,email_verified:true,name:email})));}
try{
  if(import.meta.env.VITE_USE_EMULATORS!=='true'||import.meta.env.VITE_FIREBASE_PROJECT_ID!=='demo-notetree')throw new Error('Demo emulators required');
  history.replaceState(null,'','/');
  const {app}=await import('../src/main');await until(()=>!!document.querySelector('#project-message'));
  await until(()=>!document.querySelector<HTMLButtonElement>('#login')!.disabled);
  const owner=await login('owner-flow@gmail.com');await until(()=>!!document.querySelector('.project-item')&&document.querySelector('#account')?.textContent==='owner-flow@gmail.com'&&!(document.querySelector('#projects-home') as HTMLElement).inert);
  assert(location.pathname==='/'&&!(document.querySelector('#projects-home') as HTMLElement).hidden,'root shows permitted project list');
  fill('#project-create input','Shared flow');document.querySelector('#project-create')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>location.pathname==='/project'&&document.querySelector('#project-name')?.textContent==='Shared flow'&&!document.querySelector<HTMLButtonElement>('#cloud-save')!.disabled);
  const id=new URLSearchParams(location.search).get('id')!;
  assert(document.querySelector('#project-role')!.textContent==='オーナー','creator becomes owner');
  const text:TextModel={id:'topic',type:'text',index:0,title:'Shared topic',content:'Original',tags:[],position:{x:20,y:30},size:{x:280,y:160},collapsed:false};
  app.commandManager.execute(new Command(app.dataLayer).init(new Map([[text.id,text]])));click('#cloud-save');await until(()=>document.querySelector('#save-status')?.textContent==='保存済み');
  const store=new ProjectStore(getFirestore(),{uid:owner.user.uid,email:'owner-flow@gmail.com',name:'owner'});let project=await store.get(id);
  assert((await store.read(id)).models.some(m=>m.id==='topic'),'manual save writes project models');
  // Simulate another device, then verify confirmation happens before any local write.
  await store.write(id,[[text.id,{...text,content:'Remote change'}]],project.revision);
  app.commandManager.execute(new Command(app.dataLayer).init(new Map([[text.id,{...text,content:'Local change'}]])));click('#cloud-save');await until(()=>!!document.querySelector('dialog[open] [data-cancel]'));
  click('dialog [data-cancel]');await until(()=>!document.querySelector<HTMLButtonElement>('#cloud-save')!.disabled);
  assert((await store.read(id)).models.some(m=>m.type==='text'&&m.content==='Remote change'),'cancel conflict leaves cloud untouched');
  click('#cloud-save');await until(()=>!!document.querySelector('dialog[open] [data-save]'));click('dialog [data-save]');await until(()=>document.querySelector('#save-status')?.textContent==='保存済み');
  assert((await store.read(id)).models.some(m=>m.type==='text'&&m.content==='Local change'),'confirmed conflict saves local changed model');
  click('#project-members');fill('dialog input[name=email]','viewer-flow@gmail.com');document.querySelector('dialog form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await until(()=>!document.querySelector('dialog[open]'));
  project=await store.get(id);assert(project.roles['viewer-flow@gmail.com']==='viewer','owner grants viewer by Google email');
  await signOut(getAuth());await login('viewer-flow@gmail.com');await until(()=>document.querySelector('#project-role')?.textContent==='閲覧者'&&!document.querySelector<HTMLButtonElement>('#cloud-save')!.disabled);
  app.commandManager.execute(new Command(app.dataLayer).init(new Map([[text.id,{...text,content:'Denied'}]])));
  assert((app.dataLayer.getModelByID('topic') as TextModel).content==='Local change','viewer cannot change text');
  assert(document.querySelector<HTMLButtonElement>('#project-members')!.hidden,'viewer has no role-management button');
  click('[data-view=note]');click('[data-comment-to=topic]');fill('.comment-composer [name=title]','Review');fill('.comment-composer [name=content]','Viewer feedback');document.querySelector('.comment-composer')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));app.renderer.update();
  assert(!!document.querySelector('.note-comment'),'Note displays nested comment');
  click('#cloud-save');await until(()=>document.querySelector('#save-status')?.textContent==='保存済み');
  click('[data-view=board]');click('[data-comment-go=topic]');assert(!(document.querySelector('.search-highlight') as HTMLElement).hidden,'Board comment jumps to target with highlight');
  const viewerStore=new ProjectStore(getFirestore(),{uid:getAuth().currentUser!.uid,email:'viewer-flow@gmail.com',name:'viewer'});
  assert((await viewerStore.read(id)).models.some(m=>m.type==='comment'&&m.content==='Viewer feedback'),'viewer comment saved with security rules');
  click('#project-home');await until(()=>location.pathname==='/'&&!!document.querySelector(`a[href="/project?id=${id}"]`));
  assert(!(document.querySelector('#projects-home') as HTMLElement).hidden,'return to root list');
  click(`a[href="/project?id=${id}"]`);await until(()=>document.querySelector('#project-role')?.textContent==='閲覧者'&&!document.querySelector<HTMLButtonElement>('#cloud-save')!.disabled);click('[data-view=note]');
  results.textContent=lines.join('\n')+'\nALL PASSED';
}catch(error){results.textContent=lines.join('\n')+'\nFAIL '+String(error);console.error(error);}
