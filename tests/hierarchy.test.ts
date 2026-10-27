import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DataLayer,Command,CommandManager,seed,type Model,type TextModel} from '../src/model';
import {hierarchyChanges,compareText,appendConnectionChanges} from '../src/hierarchy';
const text=(id:string,index=0):TextModel=>({id,type:'text',index,title:id,content:'',tags:[],position:{x:0,y:0},size:{x:280,y:160},collapsed:false});
test('sibling reorder persists indexes and replaces incoming edge, with one undo',()=>{
  const data=new DataLayer(seed()),commands=new CommandManager(),changes=hierarchyChanges(data.all(),'c',{parent:'a',before:'b'},()=> 'new-edge');
  commands.execute(new Command(data).init(changes));
  assert.equal((data.getModelByID('c') as TextModel).index,0);assert.equal((data.getModelByID('b') as TextModel).index,1);
  assert.equal(data.getModelByID('ac'),undefined);assert.deepEqual(data.getModelByID('new-edge'),{id:'new-edge',type:'connection',from:'a',to:'c'});
  assert.deepEqual(data.getModelByID('ab'),seed().find(m=>m.id==='ab'));assert.equal(commands.undoStack.length,1);
  commands.undo();assert.deepEqual(data.all().sort((a,b)=>a.id.localeCompare(b.id)),seed().sort((a,b)=>a.id.localeCompare(b.id)));
  commands.redo();assert.equal((data.getModelByID('c') as TextModel).index,0);
});
test('reparent keeps descendants, replaces all incoming edges, and supports root move',()=>{
  const models:Model[]=[...seed(),text('d'),{id:'bd',type:'connection',from:'b',to:'d'},{id:'cb',type:'connection',from:'c',to:'b'}];
  const data=new DataLayer(models);new Command(data).init(hierarchyChanges(models,'b',{parent:null,before:'a'})).execute();
  assert.equal(data.getModelByID('ab'),undefined);assert.equal(data.getModelByID('cb'),undefined);assert.ok(data.getModelByID('bd'));assert.equal((data.getModelByID('b') as TextModel).index,0);
});
test('drop into a new parent inserts before the first child',()=>{
  const models:Model[]=[...seed(),text('d'),{id:'bd',type:'connection',from:'b',to:'d'}];
  const changes=hierarchyChanges(models,'c',{parent:'b',before:'d'},()=> 'bc');assert.equal(changes.get('ac'),null);assert.deepEqual(changes.get('bc'),{id:'bc',type:'connection',from:'b',to:'c'});assert.equal((changes.get('d') as TextModel).index,1);
});
test('invalid drops and cycles do not generate model changes',()=>{
  for(const drop of [{parent:'a',before:null},{parent:'b',before:null},{parent:'missing',before:null},{parent:null,before:'missing'}])assert.equal(hierarchyChanges(seed(),'a',drop).size,0);
  assert.equal(hierarchyChanges(seed(),'b',{parent:'a',before:'c'}).size,0);
});
test('legacy text without index sorts as zero and receives index on reorder',()=>{
  const legacy=text('legacy');delete (legacy as Partial<TextModel>).index;
  assert.equal(compareText(legacy,text('new',1)),-1);
  const changes=hierarchyChanges([legacy,text('next',1)],'next',{parent:null,before:'legacy'});
  assert.equal((changes.get('legacy') as TextModel).index,1);
});

test('connection appends at child count after compacting gaps, with atomic undo',()=>{
  const models=seed().map(m=>m.id==='c'?{...m,index:9}:m),data=new DataLayer(models),commands=new CommandManager();
  const child=text('new',99);
  commands.execute(new Command(data).init(appendConnectionChanges(data.all(),'a',child)));
  assert.equal((data.getModelByID('new') as TextModel).index,2);
  assert.equal((data.getModelByID('c') as TextModel).index,1);
  assert.ok(data.all().some(m=>m.type==='connection'&&m.from==='a'&&m.to==='new'));
  assert.equal(appendConnectionChanges(data.all(),'a',child).size,0);
  commands.undo();assert.deepEqual(data.all(),models);
});
test('connecting an existing board text resets its index to destination child count',()=>{
  const data=new DataLayer([...seed(),text('existing',100)]);
  new Command(data).init(appendConnectionChanges(data.all(),'b',data.getModelByID('existing') as TextModel)).execute();
  assert.equal((data.getModelByID('existing') as TextModel).index,0);
});
