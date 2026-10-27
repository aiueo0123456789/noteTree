import {DataLayer, EventID, type Model} from './model';
export type Patch = [string, Model|null];
export function mergeModels(base: Model[], changes: Patch[]): Model[] {
  const map=new Map(base.map(m=>[m.id,m]));
  for(const [id,model] of changes)if(model)map.set(id,model);else map.delete(id);
  return [...map.values()];
}
export interface RemoteBoard {
  read():Promise<Model[]>;
  write(changes:Patch[]):Promise<void>;
}
export type Draft={models:Model[];pending:Patch[]};
export class BoardSync {
  private generation=0;
  private applying=false;
  private pending=new Map<string,Model|null>();
  private versions=new Map<string,number>();
  private revision=0;
  private remote:RemoteBoard|null=null;
  private flight:Promise<void>|null=null;
  private saveDraft:(draft:Draft)=>void=()=>{};
  onStatus=(message:string)=>{};
  beforeApply=()=>{};
  constructor(private data:DataLayer){
    for(const event of Object.values(EventID))data.streamEvent(event,({id,model})=>{
      if(this.applying)return;
      if(this.remote){this.pending.set(id,model);this.versions.set(id,++this.revision);}
      this.save();
      if(this.remote){this.onStatus('未保存（端末に保持）');}else this.onStatus('端末に保存済み');
    });
  }
  private save(){this.saveDraft({models:this.data.all(),pending:[...this.pending]});}
  switch(draft:Draft,remote:RemoteBoard|null,save:(draft:Draft)=>void){
    this.generation++;this.flight=null;
    this.remote=remote;this.saveDraft=save;this.pending=new Map(draft.pending);this.versions.clear();
    for(const id of this.pending.keys())this.versions.set(id,++this.revision);
    this.apply(draft.models);this.save();
    this.onStatus(remote?(this.pending.size?'未保存（端末に保持）':'読み込み済み'):'端末に保存済み');
  }
  get hasPending(){return this.pending.size>0;}
  async refresh(){
    const generation=this.generation,remote=this.remote;
    if(!remote)return;
    await this.flush();
    if(generation!==this.generation)return;
    const models=await remote.read();
    if(generation!==this.generation)return;
    this.apply(mergeModels(models,[...this.pending]));this.save();
    this.onStatus(this.pending.size?'未保存（端末に保持）':'同期済み');
  }

  private apply(models:Model[]){
    const current=new Map(this.data.all().map(m=>[m.id,m]));
    const next=new Map(models.map(m=>[m.id,m]));
    const changes:Patch[]=[];
    for(const id of current.keys())if(!next.has(id))changes.push([id,null]);
    for(const [id,model] of next)if(JSON.stringify(current.get(id))!==JSON.stringify(model))changes.push([id,model]);
    if(!changes.length)return;
    this.beforeApply();this.applying=true;
    try{for(const [id,model] of changes)this.data.updateModel(id,model);}finally{this.applying=false;}
  }
  async flush():Promise<void>{
    if(this.flight){await this.flight;return this.flush();}
    if(!this.remote||!this.pending.size)return;
    const remote=this.remote,generation=this.generation,changes=[...this.pending] as Patch[],versions=new Map(this.versions);
    this.onStatus('保存中');
    const flight=remote.write(changes);this.flight=flight;
    try{
      await flight;if(generation!==this.generation)return;
      for(const [id] of changes)if(this.versions.get(id)===versions.get(id)){this.pending.delete(id);this.versions.delete(id);}
      this.save();this.onStatus(this.pending.size?'未保存（端末に保持）':'保存済み');
    }catch(error){if(generation===this.generation)this.onStatus('保存失敗・端末に保持');throw error;}
    finally{if(generation===this.generation)this.flight=null;}
  }
}
