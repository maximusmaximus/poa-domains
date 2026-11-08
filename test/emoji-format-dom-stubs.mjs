// ORIGINAL minimal deterministic DOM/event STUBS for Node tests, NOT a browser or a DOM conformance library.
export class StubEvent {
 constructor(type, props = {}) { this.type = type; this.cancelable = true; this.bubbles = true; this.defaultPrevented = false; this.propagationStopped = false; Object.assign(this, props); }
 preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
 stopPropagation() { this.propagationStopped = true; }
}
export class StubElement {
 constructor(tag, doc) { this.nodeType = 1; this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.parentNode = null; this.attributes = new Map(); this.listeners = new Map(); this._text = ''; this.value = ''; this.disabled = false; this._testShadow = null; }
 setAttribute(k,v) { if(k.toLowerCase()==='style'||/^on/i.test(k))throw Error('Inline style/script attributes prohibited by CSP structural stub'); this.attributes.set(k,String(v)); if (k === 'id') this.id=String(v); }
 getAttribute(k) { return this.attributes.get(k)??null; }
 hasAttribute(k) { return this.attributes.has(k); }
 appendChild(child) { if(child.parentNode)child.remove(); this.children.push(child); child.parentNode=this; if(child.tagName==='LINK'&&child.getAttribute('rel')==='stylesheet'){queueMicrotask(()=>{const outcome=this.ownerDocument.stylesheetOutcome;if(outcome==='load'||outcome==='error')child.dispatchEvent(new StubEvent(outcome,{bubbles:false}));});} return child; }
 remove() { if(this.parentNode){const p=this.parentNode;p.children.splice(p.children.indexOf(this),1);this.parentNode=null;} }
 attachShadow({mode}) { if(this.ownerDocument.failShadow)throw Error('Shadow unavailable');const s=new StubElement('stub-shadow',this.ownerDocument);s.nodeType=11;s.host=this;s.mode=mode;this._testShadow=s;return s; }
 get shadowRoot() { return this._testShadow?.mode==='open'?this._testShadow:null; }
 addEventListener(type,handler) { if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(handler); }
 removeEventListener(type,handler) { this.listeners.get(type)?.delete(handler); }
 dispatchEvent(event) { if(!event.target)event.target=this;event.currentTarget=this;for(const h of [...(this.listeners.get(event.type)??[])])h(event);if(event.bubbles&&!event.propagationStopped&&this.parentNode)this.parentNode.dispatchEvent(event);return !event.defaultPrevented; }
 set textContent(value) { this._text=String(value);for(const c of this.children)c.parentNode=null;this.children=[]; }
 get textContent() { return this._text+this.children.map(c=>c.textContent).join(''); }
 get style() { throw Error('Inline style API prohibited by CSP structural stub'); }
 set innerHTML(_) { throw Error('HTML injection API prohibited by original test stub'); }
 get innerHTML() { throw Error('HTML parsing API prohibited by original test stub'); }
 focus() { this.ownerDocument.focusCalls++; }
 submit() { this.ownerDocument.requestCalls++;throw Error('Request submission prohibited'); }
 requestSubmit() { this.ownerDocument.requestCalls++;throw Error('Request submission prohibited'); }
}
export class StubDocument {
 constructor() { this.created=[];this.focusCalls=0;this.requestCalls=0;this.failShadow=false;this.stylesheetOutcome='load'; }
 createElement(tag) { if(['style','script'].includes(tag.toLowerCase()))throw Error('Script/style node creation prohibited by CSP structural stub'); const e=new StubElement(tag,this);this.created.push(e);return e; }
}
export function fixture() { const doc=new StubDocument(),outside=doc.createElement('div'),container=doc.createElement('div'),sentinel=doc.createElement('input');sentinel.value='unrelated native control';sentinel.disabled=false;outside.appendChild(sentinel);outside.appendChild(container);return {doc,outside,container,sentinel}; }
export function nodes(f) { const host=f.container.children.at(-1),root=host._testShadow??host,all=[];const walk=n=>{all.push(n);for(const c of n.children)walk(c);};walk(root);const find=t=>all.find(n=>n.tagName===t.toUpperCase());return {host,root,all,input:find('textarea')??find('input'),button:find('button'),form:find('form'),fields:find('fieldset'),stylesheet:find('link'),status:all.find(n=>n.getAttribute('role')==='status'),help:all.find(n=>n.id==='emoji-format-help')}; }
export function fire(node,type,props={}) {const event=new StubEvent(type,props);node.dispatchEvent(event);return event;}
