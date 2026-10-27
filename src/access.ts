import type {Model} from './model';
export type Role='owner'|'editor'|'viewer';
export type Identity={uid:string;email:string;name:string};
export const normalizeEmail=(email:string)=>email.trim().toLowerCase();
export function canChange(role:Role|null,user:Identity|null,next:Model|null,previous:Model|null){
  if(!role||!user)return false;
  if(role==='owner'||role==='editor')return true;
  const model=next??previous;
  return model?.type==='comment'&&model.authorUid===user.uid&&(!previous||(previous.type==='comment'&&previous.authorUid===user.uid))&&(!next||(next.type==='comment'&&next.authorUid===user.uid&&next.authorEmail===user.email&&(!previous||previous.type==='comment'&&next.to===previous.to&&next.authorEmail===previous.authorEmail&&next.authorName===previous.authorName&&next.createdAt===previous.createdAt)));
}
export function validateRoles(roles:Record<string,Role>){
  const entries=Object.entries(roles);
  return entries.length>0&&entries.length<=100&&entries.some(([,role])=>role==='owner')&&entries.every(([email,role])=>email===normalizeEmail(email)&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&['owner','editor','viewer'].includes(role));
}
