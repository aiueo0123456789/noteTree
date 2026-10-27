import {collection,doc,getDocFromServer,getDocsFromServer,query,where,runTransaction,serverTimestamp,type Firestore} from 'firebase/firestore';
import {type Model} from './model';
import {type Patch} from './sync';
import {type Identity,type Role,validateRoles} from './access';
export type Project={id:string;name:string;roles:Record<string,Role>;memberEmails:string[];revision:string;createdBy:string;state:'ready'|'importing'};
export class RevisionConflict extends Error{constructor(public revision:string){super('他の端末で更新されています');}}
export class SaveCancelled extends Error{}
export async function withRevisionConfirmation(write:(expected:string)=>Promise<string>,base:string,confirm:(revision:string)=>Promise<boolean>){
  let expected=base;
  for(;;){try{return await write(expected);}catch(error){if(!(error instanceof RevisionConflict))throw error;if(!await confirm(error.revision))throw new SaveCancelled('保存を中止しました');expected=error.revision;}}
}
export class ProjectStore{
  constructor(private db:Firestore,readonly user:Identity){}
  private ref(id:string){return doc(this.db,'projects',id);}
  async list(){const result=await getDocsFromServer(query(collection(this.db,'projects'),where('memberEmails','array-contains',this.user.email)));return result.docs.map(s=>({...s.data(),id:s.id}) as Project);}
  async get(id:string){const snapshot=await getDocFromServer(this.ref(id));if(!snapshot.exists())throw new Error('プロジェクトがありません');return {...snapshot.data(),id} as Project;}
  async create(name:string,id:string=crypto.randomUUID(),importing=false){
    const ref=this.ref(id);await runTransaction(this.db,async tx=>{const existing=await tx.get(ref);if(existing.exists())return;tx.set(ref,{name:name.trim()||'無題',roles:{[this.user.email]:'owner'},memberEmails:[this.user.email],revision:crypto.randomUUID(),createdBy:this.user.uid,state:importing?'importing':'ready',updatedAt:serverTimestamp()});});return id;
  }
  // Restartable migration. The original per-user board remains untouched as backup.
  async migrateDefault(fallback:Model[]){
    const id=`legacy_${this.user.uid}`,ref=this.ref(id);
    const existing=await getDocFromServer(ref).catch(error=>{if(error.code==='permission-denied')return null;throw error;});
    if(!existing)return;
    if(existing.exists()&&existing.data().state==='ready')return;
    const legacy=await getDocFromServer(doc(this.db,'users',this.user.uid,'boards','default'));
    const models=legacy.exists()?legacy.data().models as Model[]:fallback;
    if(!models.length&&!existing.exists())return;
    await this.create('default',id,true);
    for(let offset=0;offset<models.length;offset+=350){
      const chunk=models.slice(offset,offset+350);
      await runTransaction(this.db,async tx=>{const head=await tx.get(ref);if(head.data()?.state!=='importing')return;for(const model of chunk)tx.set(doc(this.db,'projects',id,'models',model.id),model);tx.update(ref,{revision:crypto.randomUUID(),updatedAt:serverTimestamp()});});
    }
    await runTransaction(this.db,async tx=>{const head=await tx.get(ref);if(head.data()?.state==='importing')tx.update(ref,{state:'ready',revision:crypto.randomUUID(),updatedAt:serverTimestamp()});});
  }
  async read(id:string){
    for(let attempt=0;attempt<3;attempt++){
      const project=await this.get(id);if(project.state!=='ready')throw new Error('移行中です。一覧を再読み込みしてください');
      const docs=await getDocsFromServer(collection(this.db,'projects',id,'models'));
      const latest=await this.get(id);
      if(project.revision===latest.revision)return {project:latest,models:docs.docs.map(s=>s.data() as Model)};
    }
    throw new Error('更新が続いています。もう一度読み込んでください');
  }
  async write(id:string,changes:Patch[],expected:string){
    if(changes.length>400)throw new Error('一度の保存は400件までです。変更を減らして保存してください');
    const revision=crypto.randomUUID(),ref=this.ref(id);
    await runTransaction(this.db,async tx=>{
      const snapshot=await tx.get(ref);if(!snapshot.exists())throw new Error('プロジェクトがありません');
      const project=snapshot.data() as Project;
      if(project.revision!==expected)throw new RevisionConflict(project.revision);
      if(!project.roles[this.user.email])throw new Error('アクセス権限がありません');
      for(const [modelId,model] of changes){const modelRef=doc(this.db,'projects',id,'models',modelId);if(model)tx.set(modelRef,model);else tx.delete(modelRef);}
      tx.update(ref,{revision,updatedAt:serverTimestamp()});
    });return revision;
  }
  async setRoles(id:string,roles:Record<string,Role>,expected:string,name?:string){
    if(name!==undefined&&(!name.trim()||name.trim().length>200))throw new Error('プロジェクト名を1〜200文字で入力してください');
    if(!validateRoles(roles))throw new Error('メールアドレスを確認してください。オーナーは1人以上必要です');
    const revision=crypto.randomUUID(),ref=this.ref(id);
    await runTransaction(this.db,async tx=>{const snapshot=await tx.get(ref);const project=snapshot.data() as Project;if(!project||project.roles[this.user.email]!=='owner')throw new Error('オーナーのみ変更できます');if(project.revision!==expected)throw new RevisionConflict(project.revision);tx.update(ref,{name:name?.trim()??project.name,roles,memberEmails:Object.keys(roles),revision,updatedAt:serverTimestamp()});});return revision;
  }
}
