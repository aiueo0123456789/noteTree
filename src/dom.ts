/** Patch existing nodes instead of replacing a subtree. Keys preserve model identity. */
const key = (node: Node): string | null => {
  if (!(node instanceof Element)) return null;
  for (const attribute of ['data-node', 'data-edge', 'data-tag', 'data-remove-tag', 'data-tag-color']) {
    if (node.hasAttribute(attribute)) return `${attribute}:${node.getAttribute(attribute)}`;
  }
  return null;
};
const compatible = (a: Node, b: Node) => a.nodeType === b.nodeType && a.nodeName === b.nodeName && key(a) === key(b);

function patchNode(current: Node, next: Node) {
  if (current instanceof Element && next instanceof Element) {
    for (const attribute of [...current.attributes]) {
      if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    }
    for (const attribute of [...next.attributes]) {
      if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
    }
    if (current instanceof HTMLInputElement && next instanceof HTMLInputElement && current.value !== next.value) current.value = next.value;
    patchChildren(current, [...next.childNodes]);
  } else if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
}
function patchChildren(parent: Node, nextNodes: Node[]) {
  const keyed = new Map([...parent.childNodes].filter(node => key(node)).map(node => [key(node), node]));
  const remaining = new Set(parent.childNodes);
  let cursor = parent.firstChild;
  for (const next of nextNodes) {
    const candidate = key(next) ? keyed.get(key(next)) : [...remaining].find(node => compatible(node, next));
    if (candidate && compatible(candidate, next)) {
      if (candidate !== cursor) parent.insertBefore(candidate, cursor);
      remaining.delete(candidate);
      patchNode(candidate, next);
      cursor = candidate.nextSibling;
    } else {
      parent.insertBefore(next, cursor);
    }
  }
  while (cursor) { const next = cursor.nextSibling; parent.removeChild(cursor); cursor = next; }
}

// Cache markup per model so unchanged models do not even allocate detached DOM.
export class KeyedDOM {
  private entries = new Map<string, { element: Element; html: string }>();
  constructor(private parent: Element) {}
  get(id: string) {return this.entries.get(id)?.element;}
  remove(id: string) {this.entries.get(id)?.element.remove();this.entries.delete(id);}
  clear() {for(const id of this.entries.keys())this.remove(id);}
  upsert(id: string, html: string) {
    const entry=this.entries.get(id);
    if(entry?.html===html)return;
    const template=document.createElement('template');
    const svg=this.parent.namespaceURI==='http://www.w3.org/2000/svg';
    template.innerHTML=svg?`<svg>${html}</svg>`:html;
    const next=svg?template.content.firstElementChild!.firstElementChild!:template.content.firstElementChild!;
    if(entry){patchNode(entry.element,next);entry.html=html;}
    else{this.parent.append(next);this.entries.set(id,{element:next,html});}
  }
  invalidate(id: string) {const entry=this.entries.get(id);if(entry)entry.html='';}
}
