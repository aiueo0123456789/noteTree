import './style.css';
import { DataLayer, CommandManager } from './model';
import { RendererManager } from './renderer-manager';
import { load, persist } from './persistence';
export class App {
  dataLayer = new DataLayer(load());
  commandManager = new CommandManager();
  renderer = new RendererManager(this.dataLayer, this.commandManager);
  constructor(){this.renderer.init();void persist(this.dataLayer,()=>{this.renderer.resetInteraction();this.commandManager.undoStack=[];this.commandManager.redoStack=[];this.commandManager.onChange();},this.renderer);const frame=()=>{this.renderer.update();requestAnimationFrame(frame);};requestAnimationFrame(frame);}
}
export const app=new App();
