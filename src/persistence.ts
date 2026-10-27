import {DataLayer,seed,type Model} from './model';
import {BoardSync,mergeModels,type Draft,type RemoteBoard} from './sync';
import {type RendererManager} from './renderer-manager';
import {type Role,type Identity,normalizeEmail,canChange} from './access';
import {escapeHTML as esc} from './comments';
import {ProjectStore,SaveCancelled,RevisionConflict,withRevisionConfirmation,type Project} from './project-store';
const GUEST='notetree.guest.v2';
type ProjectDraft=Draft&{revision?:string};
function read(key:string):ProjectDraft|null{try{const value=JSON.parse(localStorage.getItem(key)??'null');if(Array.isArray(value))return {models:value,pending:[]};if(value&&Array.isArray(value.models)&&Array.isArray(value.pending))return value;}catch{}return null;}
export function load():Model[]{return (read(GUEST)??read('notetree.v1'))?.models??seed();}
const roleName=(role:Role)=>({owner:'オーナー',editor:'編集者',viewer:'閲覧者'}[role]);
function confirmConflict():Promise<boolean>{
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='project-dialog';
    dialog.innerHTML='<h2>他の更新があります</h2><p>最後の同期以降にプロジェクトが更新されています。同じModelを編集している場合、今回の変更が優先されます。変更していないModelは上書きしません。</p><div class="dialog-actions"><button data-cancel>保存を中止</button><button data-save>変更を保存</button></div>';
    document.body.append(dialog);const finish=(value:boolean)=>{dialog.close();dialog.remove();resolve(value);};
    dialog.querySelector('[data-cancel]')!.addEventListener('click',()=>finish(false));dialog.querySelector('[data-save]')!.addEventListener('click',()=>finish(true));dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false);});dialog.showModal();
  });
}
export async function persist(data:DataLayer,beforeApply:()=>void,renderer:RendererManager){
  const status=document.querySelector<HTMLElement>('#save-status')!,login=document.querySelector<HTMLButtonElement>('#login')!,logout=document.querySelector<HTMLButtonElement>('#logout')!,account=document.querySelector<HTMLElement>('#account')!,retry=document.querySelector<HTMLButtonElement>('#sync-retry')!,saveButton=document.querySelector<HTMLButtonElement>('#cloud-save')!;
  const header=document.querySelector('header')!;
  login.insertAdjacentHTML('beforebegin','<button id="project-home" hidden>一覧</button><span id="project-name"></span><span id="project-role"></span><button id="project-members" hidden>メンバー</button>');
  const homeButton=document.querySelector<HTMLButtonElement>('#project-home')!,membersButton=document.querySelector<HTMLButtonElement>('#project-members')!;
  const home=document.createElement('main');home.id='projects-home';home.innerHTML='<div class="project-list-heading"><h1>プロジェクト</h1><button id="projects-refresh">再読み込み</button></div><form id="project-create"><input name="name" placeholder="プロジェクト名" aria-label="プロジェクト名" maxlength="200" required><button>作成</button></form><p id="project-message" role="status"></p><div id="project-list"></div>';document.querySelector('#app')!.append(home);
  const list=home.querySelector('#project-list')!,message=home.querySelector('#project-message')!;
  const sync=new BoardSync(data);sync.beforeApply=beforeApply;sync.onStatus=value=>status.textContent=value;
  let user:Identity|null=null,store:ProjectStore|null=null,current:Project|null=null,revision='',generation=0,busy=false,authenticated=false;
  const safeSave=(key:string,value:unknown)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{status.textContent='端末への保存失敗（容量を確認）';}};
  const key=(id:string)=>`notetree.project.${user!.uid}.${id}.v1`;
  const empty=()=>{beforeApply();renderer.note.current=null;current=null;sync.switch({models:[],pending:[]},null,()=>{});renderer.setAccess(null,null);};
  const projectUI=(visible:boolean)=>{
    home.hidden=visible;renderer.setVisible(visible);homeButton.hidden=!visible;
    for(const selector of ['.history','#redraw','.view-switch']){const el=header.querySelector<HTMLElement>(selector);if(el)el.hidden=!visible;}
    saveButton.hidden=!visible||!current;retry.hidden=!visible||!current;membersButton.hidden=!visible||current?.roles[user?.email??'']!=='owner';
    document.querySelector('#project-name')!.textContent=visible?current?.name??'':'';document.querySelector('#project-role')!.textContent=visible&&current&&user?roleName(current.roles[user.email]):'';
  };
  const setBusy=(value:boolean)=>{busy=value;home.inert=value;(document.querySelector('#renderer-host') as HTMLElement).inert=value;for(const button of [login,logout,saveButton,retry,homeButton,membersButton])button.disabled=value;};
  const errorMessage=(error:unknown)=>{const code=(error as {code?:string}).code;return code==='permission-denied'?'権限がありません。Firestoreルールとメンバー設定を確認してください':error instanceof Error?error.message:'接続できません。再試行してください';};
  const run=async(action:()=>Promise<void>)=>{if(busy)return;setBusy(true);try{await action();}catch(error){status.textContent=error instanceof SaveCancelled?'保存を中止・変更は端末に保持':errorMessage(error);}finally{setBusy(false);}};
  const route=async()=>{
    previousURL=location.pathname+location.search;
    const token=++generation;empty();projectUI(false);list.replaceChildren();
    if(!store||!user){message.textContent=authenticated?'Googleアカウントを確認してください':'Googleでログインしてください';(home.querySelector('#project-create') as HTMLElement).hidden=true;return;}
    (home.querySelector('#project-create') as HTMLElement).hidden=false;
    const id=location.pathname==='/project'?new URLSearchParams(location.search).get('id'):null;
    if(!id){
      message.textContent='読み込み中';const projects=await store.list();if(token!==generation)return;
      list.innerHTML=projects.map(p=>`<a class="project-item" href="/project?id=${encodeURIComponent(p.id)}"><strong>${esc(p.name)}</strong><span>${esc(roleName(p.roles[user!.email]))}${p.state==='importing'?'・移行中':''}</span></a>`).join('');message.textContent=projects.length?'':'プロジェクトを作成してください';return;
    }
    message.textContent='プロジェクトを読み込み中';const sessionStore=store,sessionUser=user,draftKey=key(id),cached=read(draftKey);
    const loaded=await sessionStore.read(id);if(token!==generation)return;
    current=loaded.project;const role=current.roles[sessionUser.email];if(!role)throw new Error('アクセス権限がありません');
    let pending=cached?.pending??[];
    const allowed=pending.filter(([id,m])=>canChange(role,sessionUser,m,loaded.models.find(model=>model.id===id)??null));
    // Keep inaccessible drafts separately rather than dropping work after a role change.
    if(allowed.length!==pending.length){safeSave(draftKey+'.restricted-backup',cached);status.textContent='権限変更前の編集は端末に退避しました';pending=allowed;}
    revision=pending.length?(cached?.revision??'unknown'):current.revision;
    const remote:RemoteBoard={
      async read(){const fresh=await sessionStore.read(id);if(token!==generation)throw new SaveCancelled('プロジェクトが変わりました');current=fresh.project;revision=current.revision;renderer.setAccess(current.roles[sessionUser.email]??null,sessionUser);projectUI(true);return fresh.models;},
      async write(changes){
        // Chunks stay below the Firestore transaction write limit. Each commit is revision-checked.
        const chunkSize=current?.roles[sessionUser.email]==='viewer'?10:350;
        for(let offset=0;offset<changes.length;offset+=chunkSize){
          if(token!==generation)throw new SaveCancelled('プロジェクトが変わりました');
          const chunk=changes.slice(offset,offset+chunkSize);
          const nextRevision=await withRevisionConfirmation(expected=>{if(token!==generation)throw new SaveCancelled('プロジェクトが変わりました');return sessionStore.write(id,chunk,expected);},revision,async()=>token===generation&&await confirmConflict());
          if(token!==generation)throw new SaveCancelled('プロジェクトが変わりました');
          revision=nextRevision;if(current?.id===id)current.revision=revision;
        }
      },
    };
    renderer.setAccess(role,sessionUser);sync.switch({models:mergeModels(loaded.models,pending),pending},remote,draft=>safeSave(draftKey,{...draft,revision}));projectUI(true);message.textContent='';
  };
  const leaveAllowed=()=>!sync.hasPending||confirm('未保存の変更があります。変更をこの端末に残して移動しますか？');
  const navigate=(url:string)=>{if(busy||!leaveAllowed())return;history.pushState(null,'',url);previousURL=url;void run(route);};
  homeButton.addEventListener('click',()=>navigate('/'));
  home.addEventListener('click',e=>{const link=(e.target as HTMLElement).closest<HTMLAnchorElement>('.project-item');if(link){e.preventDefault();navigate(link.getAttribute('href')!);}});
  let previousURL=location.pathname+location.search;
  window.addEventListener('popstate',()=>{if(busy||!leaveAllowed()){history.pushState(null,'',previousURL);return;}previousURL=location.pathname+location.search;void run(route);});
  home.querySelector('#projects-refresh')!.addEventListener('click',()=>void run(route));
  home.querySelector('form')!.addEventListener('submit',e=>{e.preventDefault();if(!store)return;const name=String(new FormData(e.target as HTMLFormElement).get('name')).trim();if(!name)return;void run(async()=>{const id=await store!.create(name);history.pushState(null,'',`/project?id=${encodeURIComponent(id)}`);await route();});});
  saveButton.addEventListener('click',()=>void run(()=>sync.flush()));retry.addEventListener('click',()=>void run(()=>sync.refresh()));
  window.addEventListener('beforeunload',event=>{if(sync.hasPending){event.preventDefault();event.returnValue='';}});
  membersButton.addEventListener('click',()=>{
    if(!current||!user||!store||current.roles[user.email]!=='owner')return;
    const project=current,sessionStore=store,sessionUser=user,sessionGeneration=generation,dialog=document.createElement('dialog');dialog.className='project-dialog';
    dialog.innerHTML=`<h2>メンバー</h2><form><label>プロジェクト名<input name="projectName" value="${esc(project.name)}" required maxlength="200"></label><div class="member-rows">${Object.entries(project.roles).map(([email,role])=>`<label class="member-row"><span>${esc(email)}</span><select data-email="${esc(email)}">${(['owner','editor','viewer'] as Role[]).map(r=>`<option value="${r}" ${r===role?'selected':''}>${roleName(r)}</option>`).join('')}<option value="remove">アクセス解除</option></select></label>`).join('')}</div><label>Googleメールアドレス<input name="email" type="email" placeholder="name@gmail.com"></label><select name="role" aria-label="追加メンバーのロール"><option value="viewer">閲覧者</option><option value="editor">編集者</option><option value="owner">オーナー</option></select><p class="members-error" role="status"></p><div class="dialog-actions"><button type="button" data-close>閉じる</button><button type="submit">権限を保存</button></div></form>`;
    document.body.append(dialog);dialog.querySelector('[data-close]')!.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>dialog.remove());
    dialog.querySelector('form')!.addEventListener('submit',e=>{e.preventDefault();const roles:Record<string,Role>={};dialog.querySelectorAll<HTMLSelectElement>('[data-email]').forEach(select=>{if(select.value!=='remove')roles[select.dataset.email!]=select.value as Role;});const fd=new FormData(e.target as HTMLFormElement),email=normalizeEmail(String(fd.get('email')));if(email)roles[email]=fd.get('role') as Role;
      if(roles[sessionUser.email]!=='owner'&&sync.hasPending){dialog.querySelector('.members-error')!.textContent='自分のロールを変更する前に、未保存の変更を保存してください';return;}
      const previousRevision=project.revision;
      (dialog.querySelector('[type=submit]') as HTMLButtonElement).disabled=true;
      void sessionStore.setRoles(project.id,roles,project.revision,String(fd.get('projectName'))).then(next=>{if(sessionGeneration===generation&&revision===previousRevision)revision=next;project.name=String(fd.get('projectName')).trim();project.roles=roles;project.revision=next;project.memberEmails=Object.keys(roles);dialog.close();if(sessionGeneration===generation&&current?.id===project.id){renderer.setAccess(roles[sessionUser.email]??null,sessionUser);projectUI(true);if(!roles[sessionUser.email]){history.pushState(null,'','/');void run(route);}}}).catch(error=>{dialog.querySelector('.members-error')!.textContent=error instanceof RevisionConflict?'プロジェクトが更新されています。閉じて同期後、再度開いてください':errorMessage(error);}).finally(()=>{(dialog.querySelector('[type=submit]') as HTMLButtonElement).disabled=false;});
    });dialog.showModal();
  });
  renderer.setAccess(null,null);projectUI(false);empty();
  const env=import.meta.env;
  if(!env.VITE_FIREBASE_API_KEY||!env.VITE_FIREBASE_PROJECT_ID){login.disabled=true;message.textContent='Firebaseの設定が必要です';return;}
  setBusy(true);
  try{
    const [{initializeApp},authAPI,dbAPI]=await Promise.all([import('firebase/app'),import('firebase/auth'),import('firebase/firestore')]);
    const app=initializeApp({apiKey:env.VITE_FIREBASE_API_KEY,authDomain:env.VITE_FIREBASE_AUTH_DOMAIN,projectId:env.VITE_FIREBASE_PROJECT_ID,appId:env.VITE_FIREBASE_APP_ID});
    const auth=authAPI.getAuth(app),db=dbAPI.getFirestore(app),provider=new authAPI.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
    if(import.meta.env.DEV&&env.VITE_USE_EMULATORS==='true'){authAPI.connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});dbAPI.connectFirestoreEmulator(db,'127.0.0.1',8080);}
    login.addEventListener('click',()=>{if(busy)return;setBusy(true);void authAPI.signInWithPopup(auth,provider).catch(error=>{status.textContent=errorMessage(error);}).finally(()=>setBusy(false));});
    logout.addEventListener('click',()=>{if(!leaveAllowed())return;void run(()=>authAPI.signOut(auth));});
    authAPI.onAuthStateChanged(auth,authUser=>{
      ++generation;empty();projectUI(false);authenticated=!!authUser;user=null;store=null;login.hidden=!!authUser;logout.hidden=!authUser;account.hidden=!authUser;account.textContent=authUser?.displayName??authUser?.email??'';
      if(!authUser||!authUser.email||!authUser.emailVerified){setBusy(false);void route();return;}
      user={uid:authUser.uid,email:normalizeEmail(authUser.email),name:authUser.displayName??authUser.email};store=new ProjectStore(db,user);
      const token=generation,sessionStore=store,old=read(`notetree.user.${user.uid}.v2`);
      setBusy(true);message.textContent='プロジェクトを準備中';
      void sessionStore.migrateDefault(old?.models??load()).then(async()=>{
        if(token!==generation)return;
        const defaultKey=key(`legacy_${user!.uid}`);if(old?.pending.length&&!read(defaultKey))safeSave(defaultKey,{...old,revision:'legacy'});
        await route();
      }).catch(error=>{message.textContent=errorMessage(error);status.textContent='プロジェクト読込失敗';}).finally(()=>setBusy(false));
    });
  }catch(error){message.textContent=errorMessage(error);setBusy(false);}
}
