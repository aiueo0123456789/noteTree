import {compareText} from './hierarchy';
import {type Model,type TextModel} from './model';

/** Export each branch in sibling order; ignore dangling edges and stop cycles. */
export function exportText(models:Model[]):string {
  const texts=models.filter((m):m is TextModel=>m.type==='text').sort(compareText);
  const byId=new Map(texts.map(m=>[m.id,m]));
  const children=new Map<string,Set<string>>(),hasParent=new Set<string>();
  for(const model of models)if(model.type==='connection'&&byId.has(model.from)&&byId.has(model.to)){
    if(!children.has(model.from))children.set(model.from,new Set());
    children.get(model.from)!.add(model.to);hasParent.add(model.to);
  }
  const lines:string[]=[],emitted=new Set<string>();
  const visit=(model:TextModel,depth:number,path:Set<string>)=>{
    if(path.has(model.id))return;
    emitted.add(model.id);
    const nextPath=new Set(path).add(model.id);
    const titlePrefix=depth?'　'.repeat(depth-1)+'ー':'';
    const contentPrefix='　'.repeat(depth)+'・';
    lines.push(titlePrefix+model.title.replace(/\r\n?|\n/g,' '));
    for(const line of model.content.replace(/\r\n?/g,'\n').split('\n'))lines.push(contentPrefix+line);
    const descendants=[...(children.get(model.id)??[])].map(id=>byId.get(id)!).sort(compareText);
    for(const child of descendants)visit(child,depth+1,nextPath);
  };
  for(const model of texts)if(!hasParent.has(model.id))visit(model,0,new Set());
  // Graphs made entirely of cycles have no root, but should still be exported.
  for(const model of texts)if(!emitted.has(model.id))visit(model,0,new Set());
  return lines.length?lines.join('\n')+'\n':'';
}

export function downloadText(models:Model[],name:string){
  const filename=(name.trim()||'NoteTree').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_');
  const url=URL.createObjectURL(new Blob(['\uFEFF',exportText(models)],{type:'text/plain;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=filename+'.txt';
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
