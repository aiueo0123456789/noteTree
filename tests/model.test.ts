import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DataLayer,Command,CommandManager,EventID,deletionChanges,seed} from '../src/model';
test('edits preserve snapshots, undo and redo; new edits clear redo',()=>{const data=new DataLayer(seed()), manager=new CommandManager();const original=data.getModelByID('a')!;assert.equal(original.type,'text');if(original.type!=='text')return;const edited={...original,title:'changed'};manager.execute(new Command(data).init(new Map([['a',edited]])));edited.title='mutated';assert.equal((data.getModelByID('a') as typeof edited).title,'changed');manager.undo();assert.deepEqual(data.getModelByID('a'),original);manager.redo();assert.equal((data.getModelByID('a') as typeof edited).title,'changed');manager.undo();manager.execute(new Command(data).init(new Map([['a',{...original,title:'new'}]])));assert.equal(manager.redoStack.length,0);});
test('deleting nodes removes incident connections atomically and undo restores',()=>{const data=new DataLayer(seed()),manager=new CommandManager();manager.execute(new Command(data).init(deletionChanges(data,new Set(['a','b']))));assert.equal(data.getModelByID('a'),undefined);assert.equal(data.getModelByID('ab'),undefined);assert.equal(data.getModelByID('ac'),undefined);manager.undo();assert.deepEqual(data.all().sort((a,b)=>a.id.localeCompare(b.id)),seed().sort((a,b)=>a.id.localeCompare(b.id)));});
test('deleting a tag cleans all references and undo restores assignments',()=>{const data=new DataLayer(seed()),manager=new CommandManager();manager.execute(new Command(data).init(deletionChanges(data,new Set(['tag1']))));for(const m of data.all())if(m.type==='text')assert.ok(!m.tags.includes('tag1'));manager.undo();assert.deepEqual(data.getModelByID('a'),seed().find(m=>m.id==='a'));});
test('streams emit events and unsubscribe correctly',()=>{const data=new DataLayer();let calls=0;const fn=()=>calls++;data.streamModel('a',fn);const unsub=data.streamEvent(EventID.addModel,fn);data.updateModel('a',seed().find(m=>m.id==='a')!);assert.equal(calls,2);data.removeStreamModel('a',fn);unsub();data.updateModel('a',null);assert.equal(calls,2);});
test('event payload tracks added, updated and removed IDs and immutable snapshots',()=>{
  const data=new DataLayer();const received:import('../src/model').ModelEvent[]=[];
  for(const event of Object.values(EventID))data.streamEvent(event,payload=>received.push(payload));
  const m=seed().find(m=>m.id==='a')!;
  data.updateModel(m.id,m);
  if(m.type!=='text')throw new Error('fixture');
  data.updateModel(m.id,{...m,title:'updated'});
  data.updateModel(m.id,null);
  assert.deepEqual(received.map(e=>[e.id,e.event]),[['a',EventID.addModel],['a',EventID.updateModel],['a',EventID.removeModel]]);
  assert.equal(received[0].previous,null);assert.deepEqual(received[1].previous,m);
  assert.equal(received[2].model,null);assert.deepEqual(received[2].previous,{...m,title:'updated'});
});
