import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canChange,validateRoles} from '../src/access';
import {RevisionConflict,SaveCancelled,withRevisionConfirmation} from '../src/project-store';
import {DataLayer,Command,CommandManager,deletionChanges,seed,type CommentModel} from '../src/model';
const user={uid:'u1',email:'one@gmail.com',name:'One'};
const comment:CommentModel={id:'comment1',type:'comment',to:'a',title:'Review',content:'Hi',authorUid:user.uid,authorEmail:user.email,authorName:user.name,createdAt:1};
test('viewers can only modify their own comments and cannot spoof identity or retarget',()=>{
  assert.equal(canChange('viewer',user,seed()[3],null),false);
  assert.equal(canChange('viewer',user,comment,null),true);
  assert.equal(canChange('viewer',user,{...comment,authorUid:'other'},null),false);
  assert.equal(canChange('viewer',user,{...comment,to:'b'},comment),false);
  assert.equal(canChange('viewer',user,{...comment,createdAt:2},comment),false);
  assert.equal(canChange('viewer',user,null,comment),true);
  assert.equal(canChange(null,user,comment,null),false);
});
test('command authorization blocks editing and undo after permission changes',()=>{
  const data=new DataLayer(seed()),commands=new CommandManager();const original=data.getModelByID('a')!;
  if(original.type!=='text')throw new Error();commands.execute(new Command(data).init(new Map([['a',{...original,title:'edit'}]])));
  commands.canChange=(next,previous)=>canChange('viewer',user,next,previous);commands.undo();
  assert.equal((data.getModelByID('a') as typeof original).title,'edit');
  commands.execute(new Command(data).init(new Map([['a',null]])));assert.ok(data.getModelByID('a'));
  commands.execute(new Command(data).init(new Map([[comment.id,comment]])));assert.ok(data.getModelByID(comment.id));commands.undo();assert.equal(data.getModelByID(comment.id),undefined);
});
test('deleting text removes its comments atomically and undo restores them',()=>{
  const data=new DataLayer([...seed(),comment]),commands=new CommandManager();commands.execute(new Command(data).init(deletionChanges(data,new Set(['a']))));assert.equal(data.getModelByID(comment.id),undefined);commands.undo();assert.deepEqual(data.getModelByID(comment.id),comment);
});
test('role changes must preserve an owner and valid email keys',()=>{
  assert.ok(validateRoles({'one@gmail.com':'owner','two@gmail.com':'viewer'}));assert.equal(validateRoles({'one@gmail.com':'viewer'}),false);assert.equal(validateRoles({'One@gmail.com':'owner'}),false);
});
test('revision conflict never writes before approval; changes during approval require another approval',async()=>{
  let remote='r2',writes=0,confirms=0;
  const next=await withRevisionConfirmation(async expected=>{if(expected!==remote)throw new RevisionConflict(remote);writes++;return 'r4';},'r1',async()=>{assert.equal(writes,0);confirms++;if(confirms===1)remote='r3';return true;});
  assert.equal(next,'r4');assert.equal(confirms,2);assert.equal(writes,1);
});
test('cancelled conflict preserves remote data',async()=>{let writes=0;await assert.rejects(withRevisionConfirmation(async expected=>{if(expected!=='latest')throw new RevisionConflict('latest');writes++;return 'saved';},'old',async()=>false),SaveCancelled);assert.equal(writes,0);});
