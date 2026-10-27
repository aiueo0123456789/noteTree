import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BoardSync,mergeModels,type Draft,type Patch,type RemoteBoard} from '../src/sync';
import {DataLayer,seed,type Model} from '../src/model';
class Remote implements RemoteBoard {
 models=seed();reads=0;writes=0;error:unknown=null;
 async read(){this.reads++;if(this.error)throw this.error;return structuredClone(this.models);}
 async write(changes:Patch[]){this.writes++;if(this.error)throw this.error;this.models=mergeModels(this.models,changes);}
}
const title=(models:Model[],id:string)=>{const m=models.find(m=>m.id===id);return m?.type==='text'?m.title:undefined;};
const edit=(data:DataLayer,id:string,value:string)=>{const m=data.getModelByID(id)!;if(m.type!=='text')throw Error();data.updateModel(id,{...m,title:value});};
test('opening and editing do not automatically read or write the cloud',async()=>{
 const data=new DataLayer(seed()),remote=new Remote(),sync=new BoardSync(data);
 sync.switch({models:seed(),pending:[]},remote,()=>{});edit(data,'a','local');
 await new Promise(resolve=>setTimeout(resolve,650));
 assert.equal(remote.reads,0);assert.equal(remote.writes,0);assert.equal(sync.hasPending,true);
 await sync.flush();assert.equal(remote.writes,1);assert.equal(remote.reads,0);assert.equal(sync.hasPending,false);
});
test('manual sync saves local changes and fetches other-device changes',async()=>{
 const data=new DataLayer(seed()),remote=new Remote(),sync=new BoardSync(data);
 sync.switch({models:seed(),pending:[]},remote,()=>{});edit(data,'a','local');
 const b=remote.models.find(m=>m.id==='b')!;if(b.type!=='text')throw Error();remote.models=mergeModels(remote.models,[['b',{...b,title:'phone'}]]);
 assert.notEqual(title(data.all(),'b'),'phone');await sync.refresh();
 assert.equal(title(remote.models,'a'),'local');assert.equal(title(data.all(),'b'),'phone');assert.equal(remote.reads,1);assert.equal(remote.writes,1);
 await sync.refresh();assert.equal(remote.writes,1);assert.equal(remote.reads,2);
});
test('failed saves retain pending changes and do not retry automatically',async()=>{
 const data=new DataLayer(seed()),remote=new Remote(),sync=new BoardSync(data);let draft:Draft={models:[],pending:[]};
 sync.switch({models:seed(),pending:[]},remote,value=>draft=value);edit(data,'a','offline');remote.error=Error('offline');
 await assert.rejects(sync.flush());assert.equal(draft.pending.length,1);remote.error=null;
 await sync.flush();assert.equal(draft.pending.length,0);assert.equal(title(remote.models,'a'),'offline');
});
test('late manual sync result from a previous account is ignored',async()=>{
 const data=new DataLayer(seed()),remote=new Remote(),sync=new BoardSync(data);
 let finish:(models:Model[])=>void=()=>{};remote.read=()=>new Promise(resolve=>finish=resolve);
 sync.switch({models:seed(),pending:[]},remote,()=>{});const flight=sync.refresh();await Promise.resolve();
 sync.switch({models:[],pending:[]},null,()=>{});finish(seed());await flight;assert.deepEqual(data.all(),[]);
});
test('changes made during manual save remain unsaved until next manual save',async()=>{
 const data=new DataLayer(seed()),remote=new Remote(),sync=new BoardSync(data);let draft:Draft={models:[],pending:[]};
 let finish:()=>void=()=>{};const write=remote.write.bind(remote);let first=true;
 remote.write=async changes=>{if(first){first=false;await new Promise<void>(resolve=>finish=resolve);}await write(changes);};
 sync.switch({models:seed(),pending:[]},remote,value=>draft=value);edit(data,'a','first');const flight=sync.flush();edit(data,'a','second');finish();await flight;
 assert.equal(draft.pending.length,1);await sync.flush();assert.equal(title(remote.models,'a'),'second');assert.equal(draft.pending.length,0);
});
