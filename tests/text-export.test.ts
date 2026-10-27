import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportText} from '../src/text-export';
import {type Model,type TextModel} from '../src/model';
const text=(id:string,index=0,content='本文'):TextModel=>({id,type:'text',index,title:id,content,tags:[],position:{x:0,y:0},size:{x:280,y:160},collapsed:false});
test('exports requested indentation, index order and multiline content',()=>{
  const models:Model[]=[text('親'),text('子2',1),text('子1',0,'一行\r\n二行'),text('孫'),{id:'a',type:'connection',from:'親',to:'子2'},{id:'b',type:'connection',from:'親',to:'子1'},{id:'c',type:'connection',from:'子1',to:'孫'}];
  assert.equal(exportText(models),'親\n・本文\nー子1\n　・一行\n　・二行\n　ー孫\n　　・本文\nー子2\n　・本文\n');
});
test('exports rootless cycles safely and ignores dangling connections and tags',()=>{
  const models:Model[]=[text('A'),text('B'),{id:'ab',type:'connection',from:'A',to:'B'},{id:'ba',type:'connection',from:'B',to:'A'},{id:'bad',type:'connection',from:'missing',to:'A'},{id:'tag',type:'tag',name:'秘密タグ',color:'#000000'}];
  assert.equal(exportText(models),'A\n・本文\nーB\n　・本文\n');assert.equal(exportText([]),'');
});
test('shared children appear under each parent without changing models',()=>{
  const models:Model[]=[text('A'),text('B'),text('C'),{id:'ac',type:'connection',from:'A',to:'C'},{id:'bc',type:'connection',from:'B',to:'C'}],before=structuredClone(models);
  assert.equal(exportText(models),'A\n・本文\nーC\n　・本文\nB\n・本文\nーC\n　・本文\n');assert.deepEqual(models,before);
});
