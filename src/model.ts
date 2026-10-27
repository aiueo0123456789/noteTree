export type ModelID = string;
export type Vec2 = { x: number; y: number };
export type TagModel = { id: ModelID; type: 'tag'; name: string; color: string };
export type TextModel = { id: ModelID; type: 'text'; index:number; title: string; content: string; tags: ModelID[]; position: Vec2; size: Vec2; collapsed: boolean };
export type ConnectionModel = { id: ModelID; type: 'connection'; from: ModelID; to: ModelID };
export type CommentModel={id:ModelID;type:'comment';to:ModelID;title:string;content:string;authorUid:string;authorEmail:string;authorName:string;createdAt:number};
export type Model = TagModel | TextModel | ConnectionModel | CommentModel;
export type VirtualData = Model;
export enum EventID { addModel = 'addModel', removeModel = 'removeModel', updateModel = 'updateModel' }
export type ModelEvent = { id: ModelID; event: EventID; model: Model | null; previous: Model | null };
type EventListener = (event: ModelEvent) => void;
type Listener = (model: Model) => void;
export const copy = <T>(value: T): T => structuredClone(value);
export class DataLayer {
  private models = new Map<ModelID, Model>();
  private modelStreams = new Map<ModelID, Set<Listener>>();
  private events = new Map<EventID, Set<EventListener>>();
  constructor(models: Model[] = []) { models.forEach(m => this.models.set(m.id, copy(m))); }
  getModelByID(id: ModelID) { const model = this.models.get(id); return model && copy(model); }
  all(): Model[] { return [...this.models.values()].map(copy); }
  updateModel(id: ModelID, virtualData: VirtualData | null) {
    const previous = this.models.get(id);
    if (virtualData && virtualData.id !== id) throw new Error('Model ID mismatch');
    if (!virtualData && !previous) return;
    const event = !virtualData ? EventID.removeModel : previous ? EventID.updateModel : EventID.addModel;
    if (virtualData) this.models.set(id, copy(virtualData)); else this.models.delete(id);
    const model = virtualData ?? previous!;
    this.modelStreams.get(id)?.forEach(fn => fn(copy(model)));
    this.events.get(event)?.forEach(fn => fn({id, event, model: virtualData ? copy(virtualData) : null, previous: previous ? copy(previous) : null}));
  }
  streamModel(id: ModelID, fn: Listener) { if (!this.modelStreams.has(id)) this.modelStreams.set(id, new Set()); this.modelStreams.get(id)!.add(fn); return () => this.removeStreamModel(id, fn); }
  removeStreamModel(id: ModelID, fn: Listener) { this.modelStreams.get(id)?.delete(fn); }
  streamEvent(id: EventID, fn: EventListener) { if (!this.events.has(id)) this.events.set(id, new Set()); this.events.get(id)!.add(fn); return () => this.events.get(id)?.delete(fn); }
}
export class Command {
  private before = new Map<string, Model | null>();
  private after = new Map<string, Model | null>();
  constructor(private dataLayer: DataLayer) {}
  init(changes: Map<string, Model | null>) { this.after = copy(changes); changes.forEach((_, id) => this.before.set(id, this.dataLayer.getModelByID(id) ?? null)); return this; }
  allowed(guard:(next:Model|null,previous:Model|null)=>boolean,undo=false){return [...(undo?this.before:this.after)].every(([id,next])=>guard(next,this.dataLayer.getModelByID(id)??null));}
  execute() { this.after.forEach((m, id) => this.dataLayer.updateModel(id, m)); }
  undo() { this.before.forEach((m, id) => this.dataLayer.updateModel(id, m)); }
  redo() { this.execute(); }
}
export class CommandManager {
  undoStack: Command[] = []; redoStack: Command[] = [];
  onChange = () => {};
  canChange: (next:Model|null,previous:Model|null)=>boolean=()=>true;
  execute(command: Command) { if(!command.allowed(this.canChange))return;command.execute(); this.undoStack.push(command); this.redoStack = []; this.onChange(); }
  undo() { if(this.undoStack.length&&!this.undoStack.at(-1)!.allowed(this.canChange,true))return;const command = this.undoStack.pop(); if (command) { command.undo(); this.redoStack.push(command); this.onChange(); } }
  redo() { if(this.redoStack.length&&!this.redoStack.at(-1)!.allowed(this.canChange))return;const command = this.redoStack.pop(); if (command) { command.redo(); this.undoStack.push(command); this.onChange(); } }
}
export function deletionChanges(data: DataLayer, ids: Set<string>) {
  const changes = new Map<string, Model | null>();
  data.all().forEach(m => {
    if (ids.has(m.id) || (m.type === 'comment' && ids.has(m.to)) || (m.type === 'connection' && (ids.has(m.from) || ids.has(m.to)))) changes.set(m.id, null);
    else if (m.type === 'text' && m.tags.some(id => ids.has(id))) changes.set(m.id, { ...m, tags: m.tags.filter(id => !ids.has(id)) });
  });
  return changes;
}
export function seed(): Model[] {
  return [
    {id:'tag1',type:'tag',name:'質問',color:'#6e8eef'}, {id:'tag2',type:'tag',name:'深掘り',color:'#d9a355'}, {id:'tag3',type:'tag',name:'エピソード',color:'#72ad93'},
    {id:'a',type:'text',index:0,title:'あなたについて',content:'これまでの経験について、\n自由にお話しください。',tags:['tag1'],position:{x:80,y:200},size:{x:280,y:160},collapsed:false},
    {id:'b',type:'text',index:0,title:'大切にしていること',content:'仕事をするうえで、\nどんな価値観を大切にしていますか？',tags:['tag1','tag2'],position:{x:470,y:70},size:{x:280,y:160},collapsed:false},
    {id:'c',type:'text',index:1,title:'挑戦した経験',content:'これまでで一番挑戦したことは？\nそこから何を学びましたか？',tags:['tag3'],position:{x:470,y:330},size:{x:280,y:160},collapsed:false},
    {id:'ab',type:'connection',from:'a',to:'b'}, {id:'ac',type:'connection',from:'a',to:'c'}
  ];
}
