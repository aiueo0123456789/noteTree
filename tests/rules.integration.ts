import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,query,where,writeBatch,serverTimestamp,type Firestore} from 'firebase/firestore';
import {ProjectStore,RevisionConflict} from '../src/project-store';
import {seed,type Model,type CommentModel} from '../src/model';
let env:RulesTestEnvironment;
const projectId='demo-notetree';
const identity=(uid:string)=>({uid,email:`${uid}@gmail.com`,name:uid});
const dbFor=(uid:string,verified=true)=>env.authenticatedContext(uid,{email:`${uid}@gmail.com`,email_verified:verified,firebase:{sign_in_provider:'google.com'}}).firestore() as unknown as Firestore;
const head=(roles:Record<string,string>={owner:'owner',editor:'editor',viewer:'viewer'})=>({name:'Project',roles:Object.fromEntries(Object.entries(roles).map(([key,value])=>[`${key}@gmail.com`,value])),memberEmails:Object.keys(roles).map(key=>`${key}@gmail.com`),revision:'r1',createdBy:'owner',state:'ready',updatedAt:serverTimestamp()});
const comment:CommentModel={id:'review',type:'comment',to:'a',title:'Review',content:'Hello',authorUid:'viewer',authorEmail:'viewer@gmail.com',authorName:'Viewer',createdAt:1};
async function write(uid:string,model:unknown,id='review',revision='r2'){
  const db=dbFor(uid),batch=writeBatch(db);batch.update(doc(db,'projects','p'),{revision,updatedAt:serverTimestamp()});if(model)batch.set(doc(db,'projects','p','models',id),model);else batch.delete(doc(db,'projects','p','models',id));await batch.commit();
}
before(async()=>{env=await initializeTestEnvironment({projectId,firestore:{rules:readFileSync('firestore.rules','utf8')}});});
after(async()=>{await env.cleanup();});
beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(async context=>{const db=context.firestore() as unknown as Firestore;await setDoc(doc(db,'projects','p'),head());for(const m of seed())await setDoc(doc(db,'projects','p','models',m.id),m);});});
test('only members can read projects; list must be filtered by authenticated email',async()=>{
  const viewer=dbFor('viewer');await assertSucceeds(getDoc(doc(viewer,'projects','p')));await assertFails(getDoc(doc(dbFor('stranger'),'projects','p')));await assertFails(getDoc(doc(dbFor('viewer',false),'projects','p')));
  await assertSucceeds(getDocs(query(collection(viewer,'projects'),where('memberEmails','array-contains','viewer@gmail.com'))));await assertFails(getDocs(collection(viewer,'projects')));
});
test('viewer may create/edit/delete own comments, never text or someone else’s comment',async()=>{
  await assertFails(write('viewer',{...seed()[3],title:'tampered'},'a'));
  await assertFails(write('viewer',{...comment,authorUid:'owner'}));
  await assertFails(write('viewer',{...comment,to:'missing'}));
  await assertSucceeds(write('viewer',comment));
  await assertFails(write('editor',{...head(),name:'bad'},'invalid'));
  await assertSucceeds(write('viewer',{...comment,content:'Edited'},'review','r3'));
  await assertFails(write('viewer',{...comment,to:'b'},'review','r4'));
  await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore() as unknown as Firestore,'projects','p','models','other'),{...comment,id:'other',authorUid:'owner',authorEmail:'owner@gmail.com'}));
  await assertFails(write('viewer',null,'other','r4'));
  await assertSucceeds(write('viewer',null,'review','r4'));
});
test('editor may edit models but cannot edit roles or bypass revision updates',async()=>{
  await assertSucceeds(write('editor',{...seed()[3],title:'Updated'},'a'));
  await assertFails(setDoc(doc(dbFor('editor'),'projects','p','models','a'),seed()[3]));
  await assertFails(setDoc(doc(dbFor('editor'),'projects','p'),{...head(),revision:'r3',roles:{'editor@gmail.com':'owner'},memberEmails:['editor@gmail.com']}));
});
test('owner can grant roles but cannot remove the last owner or mismatch membership index',async()=>{
  const db=dbFor('owner');await assertFails(setDoc(doc(db,'projects','p'),{...head({owner:'viewer'}),revision:'r2'}));
  await assertFails(setDoc(doc(db,'projects','p'),{...head(),revision:'r2',memberEmails:['stranger@gmail.com']}));
  await assertSucceeds(setDoc(doc(db,'projects','p'),{...head({owner:'owner',stranger:'editor'}),revision:'r2'}));await assertSucceeds(getDoc(doc(dbFor('stranger'),'projects','p')));
});
test('ProjectStore writes per-model patches, detects stale revisions, and preserves unrelated models',async()=>{
  const store=new ProjectStore(dbFor('editor'),identity('editor'));
  const before=await store.read('p');assert.equal(before.models.length,seed().length);
  await store.write('p',[['a',{...seed()[3],title:'Changed'} as Model]],'r1');
  await assert.rejects(store.write('p',[['b',null]],'r1'),RevisionConflict);
  const after=await store.read('p');assert.ok(after.models.find(m=>m.id==='b'));assert.notEqual(after.project.revision,'r1');
});
test('legacy migration is resumable and preserves original board',async()=>{
  await env.withSecurityRulesDisabled(async ctx=>{const db=ctx.firestore() as unknown as Firestore;await setDoc(doc(db,'users','owner','boards','default'),{models:seed(),updatedAt:serverTimestamp()});});
  const store=new ProjectStore(dbFor('owner'),identity('owner'));await store.migrateDefault([]);await store.migrateDefault([]);
  const migrated=await store.read('legacy_owner');assert.equal(migrated.project.name,'default');assert.equal(migrated.models.length,seed().length);
  const old=await getDoc(doc(dbFor('owner'),'users','owner','boards','default'));assert.ok(old.exists());
});
test('creator is owner and cannot create a project owned by another account',async()=>{
  const store=new ProjectStore(dbFor('stranger'),identity('stranger'));const id=await store.create('New');assert.equal((await store.get(id)).roles['stranger@gmail.com'],'owner');
  await assertFails(setDoc(doc(dbFor('viewer'),'projects','forged'),head()));
});
test('text index accepts nonnegative integers and legacy absence but rejects malformed values',async()=>{
  const model=seed().find(m=>m.type==='text')!;
  await assertSucceeds(write('editor',{...model,index:2},model.id,'index2'));
  await assertFails(write('editor',{...model,index:-1},model.id,'bad-index'));
  await assertFails(write('editor',{...model,index:1.5},model.id,'fraction'));
  const legacy={...model} as Record<string,unknown>;delete legacy.index;
  await assertSucceeds(write('editor',legacy,model.id,'legacy'));
});
