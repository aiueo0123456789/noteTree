import {type Model,type TextModel,type ConnectionModel} from './model';
export const textIndex=(model:TextModel)=>Number.isFinite(model.index)?model.index:0;
export const compareText=(a:TextModel,b:TextModel)=>textIndex(a)-textIndex(b);
export type TreeDrop={parent:string|null;before:string|null};
/** Move the entire subtree; only incoming edges of the moved node are replaced. */
export function hierarchyChanges(models:Model[],id:string,drop:TreeDrop,newEdgeId:()=>string=()=>crypto.randomUUID()):Map<string,Model|null>{
  const changes=new Map<string,Model|null>();
  const texts=new Map(models.filter((m):m is TextModel=>m.type==='text').map(m=>[m.id,m]));
  const moved=texts.get(id);if(!moved||drop.parent===id||drop.before===id||drop.parent&&!texts.has(drop.parent))return changes;
  const edges=models.filter((m):m is ConnectionModel=>m.type==='connection');
  // A new parent must not be in the moved subtree, including multi-parent graphs.
  const descendants=new Set<string>([id]),queue=[id];
  while(queue.length){const node=queue.pop()!;for(const edge of edges)if(edge.from===node&&!descendants.has(edge.to)){descendants.add(edge.to);queue.push(edge.to);}}
  if(drop.parent&&descendants.has(drop.parent))return changes;
  const incoming=edges.filter(edge=>edge.to===id);
  const siblingIds=new Set(drop.parent?edges.filter(e=>e.from===drop.parent).map(e=>e.to):[...texts.keys()].filter(key=>!edges.some(e=>e.to===key&&texts.has(e.from))));
  const siblings=[...texts.values()].filter(m=>m.id!==id&&siblingIds.has(m.id)).sort(compareText);
  const position=drop.before===null?siblings.length:siblings.findIndex(m=>m.id===drop.before);
  if(position<0)return changes;
  siblings.splice(position,0,moved);
  const previous=[...texts.values()].filter(m=>siblingIds.has(m.id)).sort(compareText);
  const sameParent=drop.parent===null?incoming.length===0:incoming.length===1&&incoming[0].from===drop.parent;
  if(sameParent&&previous.map(m=>m.id).join('\0')===siblings.map(m=>m.id).join('\0'))return changes;
  siblings.forEach((model,index)=>{if(model.index!==index)changes.set(model.id,{...model,index});});
  for(const edge of incoming)changes.set(edge.id,null);
  if(drop.parent){const edge:ConnectionModel={id:newEdgeId(),type:'connection',from:drop.parent,to:id};changes.set(edge.id,edge);}
  return changes;
}

/** Append a connection, compacting existing sibling indexes so count is always last. */
export function appendConnectionChanges(models:Model[],parent:string,child:TextModel):Map<string,Model|null>{
  const changes=new Map<string,Model|null>();
  if(parent===child.id||!models.some(m=>m.id===parent&&m.type==='text'))return changes;
  if(models.some(m=>m.type==='connection'&&m.from===parent&&m.to===child.id))return changes;
  const childIds=new Set(models.filter((m):m is ConnectionModel=>m.type==='connection'&&m.from===parent).map(m=>m.to));
  const siblings=models.filter((m):m is TextModel=>m.type==='text'&&childIds.has(m.id)).sort(compareText);
  siblings.forEach((model,index)=>{if(model.index!==index)changes.set(model.id,{...model,index});});
  changes.set(child.id,{...child,index:siblings.length});
  const edge:ConnectionModel={id:crypto.randomUUID(),type:'connection',from:parent,to:child.id};
  changes.set(edge.id,edge);
  return changes;
}
