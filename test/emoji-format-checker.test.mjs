// ORIGINAL portable Node handler/security/CSP tests. Synthetic DOM/events only: NOT browser execution.
// Layout: tests/ beside web/; fixtures below are test-only and are not app assets.
import {createHash} from 'node:crypto';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {mountEmojiFormatChecker,MAX_INPUT_CODE_UNITS} from '../web/emoji-format-checker.mjs';import {fixture,nodes,fire} from './emoji-format-dom-stubs.mjs';
import * as real from '../web/emoji17.mjs';
const PUBLIC_FILE_PINS = Object.freeze({
  "LICENSE-UNICODE.txt": {
    "bytes": 1995,
    "sha256": "e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96"
  },
  "PUBLIC-PROVENANCE.json": {
    "bytes": 2042,
    "sha256": "5b8ffbe6a6a4caf49770fd4dfb972743209a7c5b4f7f9c2550fc3fc80db287f5"
  },
  "emoji-format-checker.css": {
    "bytes": 1064,
    "sha256": "32d2c62e558ee2997b0c37d7a42f104fd334240e16afb5b772868f88737bb120"
  },
  "emoji-format-checker.mjs": {
    "bytes": 11294,
    "sha256": "f7c6e412c63951c6a617ff79e59ddd7b36cceba2be39b57c882a131a4783869b"
  },
  "emoji17-data.mjs": {
    "bytes": 754062,
    "sha256": "5e511ed00485deeff7e9f382dd9722807c031cc67f92d8ad7f550c436251296c"
  },
  "emoji17.mjs": {
    "bytes": 7417,
    "sha256": "1a937b91d2e54b1c68af66a8ac0c780980f2b9ddeb7e48e90a74274ada142d0c"
  }
});
for (const pin of Object.values(PUBLIC_FILE_PINS)) Object.freeze(pin);
function assertPublicFiles(names) {
 for (const name of names) {
  const pin = PUBLIC_FILE_PINS[name]; assert.ok(pin, 'known public file');
  const raw = readFileSync(new URL(`../web/${name}`, import.meta.url));
  assert.equal(raw.byteLength, pin.bytes, `${name} byte length`);
  assert.equal(createHash('sha256').update(raw).digest('hex'), pin.sha256, `${name} SHA-256`);
 }
}
class FormatError extends Error {constructor(code,message='synthetic error text'){super(message);this.code=code;}}
function stubRuntime(fn){return {Emoji17Error:FormatError,getDataInfo:()=>({emojiVersion:'17.0',unicodeVersion:'17.0.0'}),tokenizeEmojiLabel:fn??(s=>({emojiCount:1,tokens:[{inputSequence:s,record:{qualification:'fully-qualified'}}]}))};}
async function mounted(runtime=stubRuntime()){const f=fixture(),control=mountEmojiFormatChecker(f.container,{loadRuntime:()=>Promise.resolve(runtime)});assert.equal(await control.ready,true);return {...f,...nodes(f),control};}
function click(f,value){f.input.value=value;fire(f.input,'input');return fire(f.button,'click');}
const text=f=>f.root.textContent;
test('explicit mount appends one isolated host and touches no existing siblings or native control',async()=>{
 const f=fixture(),existing=f.doc.createElement('p');existing.textContent='keep';f.container.appendChild(existing);const c=mountEmojiFormatChecker(f.container,{loadRuntime:async()=>stubRuntime()});assert.equal(await c.ready,true);const n=nodes(f);
 assert.equal(f.container.children.length,2);assert.equal(f.container.children[0],existing);assert.equal(existing.textContent,'keep');assert.equal(f.sentinel.value,'unrelated native control');assert.equal(f.sentinel.disabled,false);assert.equal(n.host.shadowRoot,null);assert.equal(n.root.mode,'closed');
 c.destroy();assert.deepEqual(f.container.children,[existing]);assert.equal(f.sentinel.disabled,false);
});
test('loading state is disabled until version-checked runtime resolves; loader receives no references',async()=>{
 let resolve,args;const pending=new Promise(r=>resolve=r),f=fixture(),c=mountEmojiFormatChecker(f.container,{loadRuntime:(...a)=>{args=a;return pending;}}),n=nodes(f);
 assert.equal(n.input.disabled,true);assert.equal(n.button.disabled,true);assert.equal(n.fields.disabled,true);assert.equal(n.form.getAttribute('aria-disabled'),'true');assert.match(n.status.textContent,/Loading/);assert.deepEqual(args,[]);
 resolve(stubRuntime());assert.equal(await c.ready,true);assert.equal(n.input.disabled,false);assert.equal(n.button.disabled,false);assert.equal(n.form.getAttribute('aria-disabled'),'false');assert.equal(f.doc.focusCalls,0);
});
for(const [name,loader] of [
 ['reject',()=>Promise.reject(Error('secret diagnostic'))],['throw',()=>{throw Error('secret diagnostic');}],['missing APIs',async()=>({})],
 ['wrong Emoji version',async()=>({...stubRuntime(),getDataInfo:()=>({emojiVersion:'18.0',unicodeVersion:'18.0.0'})})],
 ['wrong Unicode version',async()=>({...stubRuntime(),getDataInfo:()=>({emojiVersion:'17.0',unicodeVersion:'16.0.0'})})],
 ['getDataInfo throws',async()=>({...stubRuntime(),getDataInfo:()=>{throw Error('secret diagnostic');}})],
])test('honest isolated initialization failure disables only checker: '+name,async()=>{
 const f=fixture(),c=mountEmojiFormatChecker(f.container,{loadRuntime:loader}),n=nodes(f);assert.equal(await c.ready,false);assert.equal(n.input.disabled,true);assert.equal(n.button.disabled,true);assert.equal(n.fields.disabled,true);assert.match(n.status.textContent,/spelling checker could not initialize/);assert.match(n.status.textContent,/only this format checker/);assert.doesNotMatch(n.status.textContent,/secret diagnostic/);assert.equal(f.sentinel.disabled,false);assert.equal(f.doc.requestCalls,0);
});
test('no GET/POST target, named controls, native-submit triggers, autofocus or automatic focus',async()=>{
 const f=await mounted();assert.equal(f.form.getAttribute('method'),'dialog');for(const k of ['action','target'])assert.equal(f.form.getAttribute(k),null);
 for(const n of [f.input,f.button,f.form]){assert.equal(n.hasAttribute('name'),false);assert.equal(n.hasAttribute('autofocus'),false);}
 assert.equal(f.button.getAttribute('type'),'button');assert.equal(f.input.getAttribute('maxlength'),String(MAX_INPUT_CODE_UNITS));assert.equal(f.input.getAttribute('autocomplete'),'off');assert.equal(f.input.getAttribute('autocapitalize'),'off');assert.equal(f.input.getAttribute('spellcheck'),'false');assert.equal(f.input.getAttribute('inputmode'),'text');assert.equal(f.input.getAttribute('enterkeyhint'),'done');assert.equal(f.doc.focusCalls,0);assert.equal(f.doc.requestCalls,0);
});
test('label/help/status accessibility hooks and mobile-sized controls are explicit',async()=>{
 const f=await mounted();assert.equal(f.input.parentNode.tagName,'LABEL');assert.equal(f.input.getAttribute('aria-describedby'),f.help.id);assert.equal(f.status.getAttribute('role'),'status');assert.equal(f.status.getAttribute('aria-live'),'polite');assert.equal(f.status.getAttribute('aria-atomic'),'true');assert.match(text(f),/Emoji-only Unicode 17 spelling check/);assert.match(f.help.textContent,/1–32/);
 assert.equal(f.stylesheet.getAttribute('rel'),'stylesheet');const css=readFileSync(new URL('../web/emoji-format-checker.css',import.meta.url),'utf8');assert.match(css,/min-height:44px/);assert.match(css,/:focus-visible/);
});
test('real runtime displays only count and original display qualification, never representative/tier/name',async()=>{
 const f=await mounted(real),raw='😀❤👩‍⚕';click(f,raw);assert.equal(f.input.value,raw);assert.equal(f.status.textContent,'Recognized count: 3 whole emoji sequences.\nDisplay qualification: 1 fully-qualified, 1 minimally-qualified, 1 unqualified.');assert.doesNotMatch(f.status.textContent,/premium|standard|tier|price|canonical|available|registered|reserved|auction/i);assert.equal(f.doc.requestCalls,0);
});
test('input string code units pass unchanged, without trim/normalization or silent alias conversion',async()=>{
 const seen=[];const runtime={...real,tokenizeEmojiLabel:(s,options)=>{seen.push([s,options]);return real.tokenizeEmojiLabel(s,options);}};const f=await mounted(runtime);
 for(const raw of ['❤','👩🏽‍💻',' 😀','😀 ','e\u0301','😀\uFE0F']){click(f,raw);assert.equal(f.input.value,raw);assert.equal(seen.at(-1)[0],raw);assert.deepEqual(seen.at(-1)[1],{qualification:'listed',presentation:'emoji-test-only'});}
});
test('all 5216 official name spellings render one-count qualification without changing input; 9 components refuse',async()=>{
 const f=await mounted(real);let accepted=0,components=0;
 for(const r of real.listEmojiRecords()){
  click(f,r.sequence);assert.equal(f.input.value,r.sequence);
  if(r.nameCharacter){assert.equal(f.status.textContent,`Recognized count: 1 whole emoji sequence.\nDisplay qualification: 1 ${r.qualification}.`);accepted++;}
  else{assert.doesNotMatch(f.status.textContent,/Recognized count/);assert.match(f.status.textContent,/Standalone emoji components/);components++;}
 }
 assert.equal(accepted,5216);assert.equal(components,9);assert.equal(f.input.disabled,false);
});
test('empty/33-emoji/unknown/truncated/control spellings show format-only refusal, not availability',async()=>{
 const f=await mounted(real);
 for(const raw of ['', '😀'.repeat(33),'😀‍😀','🇺','🏴\u{E0067}','😀\u0301','😀<img src=x onerror=alert(1)>']){click(f,raw);assert.equal(f.input.value,raw);assert.doesNotMatch(f.status.textContent,/Recognized count|<img|onerror/);assert.equal(f.input.disabled,false);assert.equal(f.button.disabled,false);}
 click(f,'😀'.repeat(32));assert.match(f.status.textContent,/Recognized count: 32/);assert.doesNotMatch(f.status.textContent,/tier|premium|price/i);
});
test('prototype maxlength also has a script-assignment guard, no truncation and no runtime call',async()=>{
 let calls=0;const f=await mounted(stubRuntime(s=>{calls++;return{emojiCount:1,tokens:[{inputSequence:s,record:{qualification:'fully-qualified'}}]};})),raw='x'.repeat(MAX_INPUT_CODE_UNITS+1);click(f,raw);assert.equal(f.input.value,raw);assert.equal(calls,0);assert.match(f.status.textContent,/prototype length guard/);
});
for(const type of ['input','change','paste','cut','compositionstart','compositionend'])test('stale results clear on edit event: '+type,async()=>{
 const f=await mounted();click(f,'😀');assert.match(f.status.textContent,/Recognized count/);fire(f.input,type);assert.equal(f.status.textContent,'');
});
test('every submission and formdata event is prevented and cannot trigger a check',async()=>{
 let calls=0;const f=await mounted(stubRuntime(()=>{calls++;throw Error('must not run');}));f.input.value='😀';for(const type of ['submit','formdata'])for(const submitter of [undefined,f.button]){const e=fire(f.form,type,{submitter});assert.equal(e.defaultPrevented,true);assert.equal(e.propagationStopped,true);}assert.equal(calls,0);assert.equal(f.doc.requestCalls,0);
});
test('Enter defaults blocked; IME commit keys not cancelled; submission never triggers check',async()=>{
 let calls=0;const f=await mounted(stubRuntime(s=>{calls++;return{emojiCount:1,tokens:[{inputSequence:s,record:{qualification:'fully-qualified'}}]};}));
 for(const props of [{key:'Enter'},{key:'Process',keyCode:13}])for(const type of ['keydown','keyup']){const e=fire(f.input,type,props);assert.equal(e.defaultPrevented,true);assert.equal(e.propagationStopped,true);}
 for(const props of [{key:'Enter',isComposing:true},{key:'Enter',keyCode:229}])for(const type of ['keydown','keyup']){const e=fire(f.input,type,props);assert.equal(e.defaultPrevented,false);assert.equal(e.propagationStopped,true);}
 fire(f.input,'compositionstart');assert.equal(fire(f.input,'keydown',{key:'Enter'}).defaultPrevented,false);click(f,'😀');assert.equal(calls,0);fire(f.input,'compositionend');const submit=fire(f.form,'submit',{submitter:f.button});assert.equal(submit.defaultPrevented,true);assert.equal(calls,0);
 click(f,'😀');assert.equal(calls,1);assert.equal(f.doc.requestCalls,0);
});
test('IME character/process keys are not prevented by component event handlers',async()=>{
 const f=await mounted();fire(f.input,'compositionstart');for(const props of [{key:'a',isComposing:true,keyCode:229},{key:'Process',isComposing:true,keyCode:229},{key:'Unidentified',keyCode:229},{key:'ArrowLeft'}]){const e=fire(f.input,'keydown',props);assert.equal(e.defaultPrevented,false);assert.equal(e.propagationStopped,true);}
});
test('owned control handlers explicitly stop propagation; no browser capture claim',async()=>{
 const f=await mounted();let outer=0;for(const type of ['input','change','submit','keydown','click','compositionend'])f.container.addEventListener(type,()=>outer++);
 // Stub roots intentionally do not model browser retargeting; local handlers still stop propagation explicitly.
 for(const [node,type] of [[f.input,'input'],[f.input,'change'],[f.form,'submit'],[f.input,'keydown'],[f.button,'click'],[f.input,'compositionend']]){const e=fire(node,type,{key:'Enter'});assert.equal(e.propagationStopped,true);}
 assert.equal(outer,0);assert.equal(f.sentinel.value,'unrelated native control');assert.equal(f.sentinel.disabled,false);
});
test('forbidden runtime data/canonicalizer getters are never read or called',async()=>{
 let reads=0;const runtime=stubRuntime(s=>{const result={emojiCount:1,tokens:[{inputSequence:s,record:{qualification:'fully-qualified'}}]};for(const key of ['lengthTier','qualificationForm','canonicalToken','availability','price'])Object.defineProperty(result,key,{get(){reads++;throw Error('not UI data');}});Object.defineProperty(result.tokens[0].record,'shortName',{get(){reads++;throw Error('not UI data');}});return result;});
 Object.defineProperty(runtime,'canonicalizeOwnershipLabel',{get(){reads++;throw Error('never call');}});const f=await mounted(runtime);click(f,'😀');assert.match(f.status.textContent,/Recognized count: 1/);assert.equal(reads,0);
});
for(const [name,produce] of [
 ['count outside bound',s=>({emojiCount:33,tokens:[]})],['sparse token list',s=>({emojiCount:1,tokens:new Array(1)})],
 ['unknown qualification',s=>({emojiCount:1,tokens:[{inputSequence:s,record:{qualification:'<img src=x>'}}]})],
 ['changed spelling',s=>({emojiCount:1,tokens:[{inputSequence:'different',record:{qualification:'fully-qualified'}}]})],
 ['count mismatch',s=>({emojiCount:2,tokens:[{inputSequence:s,record:{qualification:'fully-qualified'}}]})],
])test('malformed runtime result disables checker honestly: '+name,async()=>{
 const f=await mounted(stubRuntime(produce));click(f,'😀');assert.match(f.status.textContent,/internal format-checking error/);assert.doesNotMatch(f.status.textContent,/Recognized count|<img/);assert.equal(f.input.disabled,true);assert.equal(f.button.disabled,true);assert.equal(f.sentinel.disabled,false);
});
test('unexpected exceptions never read/display raw message and disable checker, not native controls',async()=>{
 let reads=0;const f=await mounted(stubRuntime(()=>{const e={};Object.defineProperty(e,'message',{get(){reads++;throw Error('must not read');}});throw e;}));click(f,'<sensitive-input>');assert.equal(reads,0);assert.doesNotMatch(f.status.textContent,/sensitive-input|message/);assert.match(f.status.textContent,/internal format-checking error/);assert.equal(f.sentinel.disabled,false);
});
test('destroy removes only own host/listeners and forgets raw input; repeated destroy is safe',async()=>{
 const f=await mounted();click(f,'😀');f.control.destroy();assert.equal(f.container.children.length,0);assert.equal(f.input.value,'');assert.equal(f.status.textContent,'');for(const n of [f.input,f.form,f.button])for(const set of n.listeners.values())assert.equal(set.size,0);f.control.destroy();assert.equal(f.sentinel.value,'unrelated native control');
});
test('destroy during pending initialization never re-enables or remounts after resolution',async()=>{
 let resolve;const f=fixture(),c=mountEmojiFormatChecker(f.container,{loadRuntime:()=>new Promise(r=>resolve=r)}),n=nodes(f);c.destroy();resolve(stubRuntime());assert.equal(await c.ready,false);assert.equal(f.container.children.length,0);assert.equal(n.input.disabled,true);assert.equal(n.button.disabled,true);assert.equal(n.status.textContent,'');
});
test('Shadow DOM failure creates disabled honest fallback without injecting globally-scoped CSS',async()=>{
 const f=fixture();f.doc.failShadow=true;let calls=0;const c=mountEmojiFormatChecker(f.container,{loadRuntime:()=>{calls++;return stubRuntime();}}),n=nodes(f);assert.equal(await c.ready,false);assert.equal(calls,0);assert.equal(n.input.disabled,true);assert.match(n.status.textContent,/could not initialize/);assert.equal(n.all.some(x=>x.tagName==='STYLE'),false);assert.equal(f.sentinel.disabled,false);
});
test('invalid mount/options do not inspect getters or change DOM',()=>{
 const f=fixture();let reads=0;assert.throws(()=>mountEmojiFormatChecker(null),TypeError);assert.throws(()=>mountEmojiFormatChecker(f.container,{get loadRuntime(){reads++;return()=>stubRuntime();}}),TypeError);for(const opts of [[],null,{unknown:true},{loadRuntime:'x'},{[Symbol('x')]:true}])assert.throws(()=>mountEmojiFormatChecker(f.container,opts),TypeError);assert.equal(reads,0);assert.equal(f.container.children.length,0);
});
test('controller exposes only readiness and destroy, never input/result/node callbacks',async()=>{
 const f=await mounted();assert.deepEqual(Object.keys(f.control),['ready','destroy']);assert.equal(Object.isFrozen(f.control),true);
});
test('source has no input transport/storage/logging/navigation/HTML sinks, and only one fixed public-data runtime import',()=>{
 const source=readFileSync(new URL('../web/emoji-format-checker.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/\b(?:fetch|sendBeacon|localStorage|sessionStorage|indexedDB|XMLHttpRequest|WebSocket|postMessage|URLSearchParams|console|navigator|window|history|location)\s*[.(\[]/);
 assert.doesNotMatch(source,/\.cookie\b|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|requestSubmit\(|\.submit\(|canonicalizeOwnershipLabel\(/);
 const imports=[...source.matchAll(/\bimport\(['"]([^'"]+)['"]\)/g)].map(m=>m[1]);assert.deepEqual(imports,['./emoji17.mjs']);assert.doesNotMatch(source,/\.trim\(|\.normalize\(|qualificationForm\s*\(|candidate-equivalence|candidate-review|new-17-official-entries/);
 const html=readFileSync(new URL('./fixtures/emoji-format/index.html',import.meta.url),'utf8'),css=readFileSync(new URL('./fixtures/emoji-format/fixture.css',import.meta.url),'utf8'),demo=readFileSync(new URL('./fixtures/emoji-format/demo.mjs',import.meta.url),'utf8');assert.match(html,/connect-src 'none'/);assert.match(html,/form-action 'none'/);assert.match(html,/img-src 'none'/);assert.match(html,/font-src 'none'/);assert.doesNotMatch(html+css+demo,/https?:\/\/|@import|url\(|autofocus|analytics|localStorage|sessionStorage/);
});

test('multiline control preserves pasted whitespace rather than silently concatenating a single-line value',async()=>{
 const f=await mounted(real);assert.equal(f.input.tagName,'TEXTAREA');assert.equal(f.input.getAttribute('rows'),'2');for(const raw of ['😀\n😀','😀\r\n😀','\t😀','😀\u00A0']){click(f,raw);assert.equal(f.input.value,raw);assert.doesNotMatch(f.status.textContent,/Recognized count/);assert.equal(f.input.disabled,false);}
});
test('default fixed-local loader works without injecting an alternative runtime',async()=>{
 const f=fixture(),control=mountEmojiFormatChecker(f.container);assert.equal(await control.ready,true);const n=nodes(f);n.input.value='😀';fire(n.button,'click');assert.match(n.status.textContent,/Recognized count: 1/);control.destroy();
});
test('multiple mounts stay isolated and destroying one preserves the others',async()=>{
 const f=fixture(),a=mountEmojiFormatChecker(f.container,{loadRuntime:async()=>real});await a.ready;const an=nodes(f),b=mountEmojiFormatChecker(f.container,{loadRuntime:async()=>real});await b.ready;const bn=nodes(f);assert.notEqual(an.root,bn.root);an.input.value='😀';bn.input.value='❤❤';fire(an.button,'click');fire(bn.button,'click');assert.match(an.status.textContent,/Recognized count: 1/);assert.match(bn.status.textContent,/Recognized count: 2/);a.destroy();assert.deepEqual(f.container.children,[bn.host]);assert.equal(bn.input.value,'❤❤');assert.equal(bn.input.disabled,false);b.destroy();
});
test('3/4/32 longest-entry boundaries report count only, with no economic classification',async()=>{
 const f=await mounted(real),longest=real.listEmojiRecords().filter(r=>r.nameCharacter).sort((a,b)=>b.sequence.length-a.sequence.length)[0].sequence;
 for(const count of [1,3,4,32]){click(f,longest.repeat(count));assert.match(f.status.textContent,new RegExp(`Recognized count: ${count} `));assert.doesNotMatch(f.status.textContent,/premium|standard|tier|price|auction/i);assert.equal(f.input.disabled,false);}
});
test('typed expected format errors never read arbitrary message or disable a healthy checker',async()=>{
 let reads=0;const f=await mounted(stubRuntime(()=>{const e=new FormatError('UNSUPPORTED_SEQUENCE');Object.defineProperty(e,'message',{get(){reads++;throw Error('do not read message');}});throw e;}));click(f,'anything');assert.equal(reads,0);assert.match(f.status.textContent,/not a supported emoji-only Unicode 17 spelling/);assert.equal(f.input.disabled,false);assert.equal(f.button.disabled,false);
});
test('editing disabled initialization-failure controls cannot erase honest error state',async()=>{
 const f=fixture(),c=mountEmojiFormatChecker(f.container,{loadRuntime:async()=>({})});await c.ready;const n=nodes(f),original=n.status.textContent;for(const type of ['input','change','compositionend','paste','cut'])fire(n.input,type);fire(n.button,'click');assert.equal(n.status.textContent,original);assert.equal(n.input.disabled,true);
});

test('malformed runtime error class fails initialization before any field enables',async()=>{
 const f=fixture(),c=mountEmojiFormatChecker(f.container,{loadRuntime:async()=>({...stubRuntime(),Emoji17Error:()=>{}})});assert.equal(await c.ready,false);const n=nodes(f);assert.equal(n.input.disabled,true);assert.match(n.status.textContent,/could not initialize/);
});
test('throwing error-code getter cannot escape handler or leave component enabled',async()=>{
 const f=await mounted(stubRuntime(()=>{const e=new FormatError('UNSUPPORTED_SEQUENCE');Object.defineProperty(e,'code',{get(){throw Error('malformed code');}});throw e;}));assert.doesNotThrow(()=>click(f,'😀'));assert.equal(f.input.disabled,true);assert.match(f.status.textContent,/internal format-checking error/);assert.doesNotMatch(f.status.textContent,/malformed code/);
});
test('network/storage/logging spies remain unused through real-runtime success/failure/edit/destroy',async()=>{
 const originals=[],calls=[];const trap=(o,k,value)=>{const d=Object.getOwnPropertyDescriptor(o,k);originals.push([o,k,d]);Object.defineProperty(o,k,{configurable:true,writable:true,value});};
 try{
  for(const key of ['fetch','XMLHttpRequest','WebSocket','open'])trap(globalThis,key,(..._)=>{calls.push(key);throw Error('Prohibited API');});
  for(const key of ['localStorage','sessionStorage','indexedDB'])trap(globalThis,key,new Proxy({},{get(){calls.push(key);throw Error('Prohibited API');}}));
  for(const key of ['log','info','warn','error','debug'])trap(console,key,(..._)=>{calls.push(`console.${key}`);});
  const f=await mounted(real);click(f,'😀');fire(f.input,'input');click(f,'😀‍😀');fire(f.form,'submit');f.control.destroy();assert.deepEqual(calls,[]);
 } finally {for(const [o,k,d] of originals.reverse()){if(d)Object.defineProperty(o,k,d);else delete o[k];}}
});

test('controls/lone surrogates/bidi/ZWJ/text-style variants fail without deleting or exposing input',async()=>{
 const f=await mounted(real);for(const raw of ['\u0000','\uD800','\uDC00','😀\uDC00','😀\u202E','😀\u200C','😀\u200D','❤\uFE0E','©\uFE0E']){click(f,raw);assert.equal(f.input.value,raw);assert.doesNotMatch(f.status.textContent,/Recognized count/);assert.equal(f.input.disabled,false);assert.equal(f.doc.requestCalls,0);}
});

// CSP correction regressions. Stub 'load' is a synthetic event, never a claim of browser loading.
test('stylesheet is one fixed module-relative external link inside the still-closed owned shadow',async()=>{
 const f=await mounted(real);const expected=new URL('../web/emoji-format-checker.css',import.meta.url).href;
 assert.equal(f.root.mode,'closed');assert.equal(f.host.shadowRoot,null);assert.equal(f.stylesheet.parentNode,f.root);assert.equal(f.stylesheet.getAttribute('rel'),'stylesheet');assert.equal(f.stylesheet.getAttribute('href'),expected);assert.equal(f.stylesheet.getAttribute('referrerpolicy'),'no-referrer');
 assert.equal(f.all.filter(n=>n.tagName==='LINK').length,1);for(const n of f.all){assert.notEqual(n.tagName,'STYLE');assert.notEqual(n.tagName,'SCRIPT');assert.equal(n.hasAttribute('style'),false);for(const key of n.attributes.keys())assert.equal(/^on/i.test(key),false);}
});
test('stylesheet URL cannot be caller configured or derived from a field/URL value',()=>{
 const f=fixture();for(const k of ['stylesheetURL','cssURL','stylesheet','nonce'])assert.throws(()=>mountEmojiFormatChecker(f.container,{[k]:'https://not-used.invalid/x.css'}),TypeError);assert.equal(f.container.children.length,0);
 const source=readFileSync(new URL('../web/emoji-format-checker.mjs',import.meta.url),'utf8');assert.deepEqual([...source.matchAll(/new URL\(([^\n]*)\)/g)].map(m=>m[1]),["'./emoji-format-checker.css', import.meta.url"]);assert.doesNotMatch(source,/el\(['"](?:style|script)['"]|\.style\b|adoptedStyleSheets|CSSStyleSheet|unsafe-inline|nonce/);
});
test('fixture structurally requires external scripts/styles and never weakens style-src self',()=>{
 const html=readFileSync(new URL('./fixtures/emoji-format/index.html',import.meta.url),'utf8');const csp=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];const directives=Object.fromEntries(csp.split(';').map(x=>x.trim().split(/\s+/)).filter(x=>x[0]).map(([k,...v])=>[k,v]));
 assert.deepEqual(directives['default-src'],["'none'"]);assert.deepEqual(directives['script-src'],["'self'"]);assert.deepEqual(directives['style-src'],["'self'"]);assert.deepEqual(directives['form-action'],["'none'"]);assert.deepEqual(directives['connect-src'],["'none'"]);assert.doesNotMatch(csp,/unsafe-inline|unsafe-eval|nonce-|data:|blob:/);
 assert.doesNotMatch(html,/<style\b|\sstyle\s*=/i);for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){assert.match(script[1],/\bsrc="\.\/demo\.mjs"/);assert.equal(script[2].trim(),'');}
 for(const file of ['../web/emoji-format-checker.css','./fixtures/emoji-format/fixture.css']){const css=readFileSync(new URL(file,import.meta.url),'utf8');assert.doesNotMatch(css,/@import|@font-face|url\s*\(/i);}
});
test('stylesheet pending keeps input and button disabled until synthetic external load',async()=>{
 const f=fixture();f.doc.stylesheetOutcome='pending';const c=mountEmojiFormatChecker(f.container,{loadRuntime:async()=>stubRuntime()}),n=nodes(f);let settled=false;c.ready.then(()=>settled=true);await Promise.resolve();await Promise.resolve();assert.equal(settled,false);assert.equal(n.input.disabled,true);assert.equal(n.button.disabled,true);fire(n.stylesheet,'load',{bubbles:false});assert.equal(await c.ready,true);assert.equal(n.input.disabled,false);assert.equal(f.sentinel.disabled,false);
});
test('external stylesheet error fails only this checker closed with an honest initialization message',async()=>{
 const f=fixture();f.doc.stylesheetOutcome='error';const c=mountEmojiFormatChecker(f.container,{loadRuntime:async()=>stubRuntime()}),n=nodes(f);assert.equal(await c.ready,false);assert.equal(n.input.disabled,true);assert.equal(n.button.disabled,true);assert.equal(n.fields.disabled,true);assert.match(n.status.textContent,/could not initialize/);assert.match(n.status.textContent,/only this format checker/);assert.equal(f.sentinel.disabled,false);assert.equal(f.doc.requestCalls,0);assert.equal(n.root.mode,'closed');
});
test('stylesheet rejection is already handled while runtime is pending and after runtime later rejects',async()=>{
 const f=fixture();f.doc.stylesheetOutcome='error';let reject;const c=mountEmojiFormatChecker(f.container,{loadRuntime:()=>new Promise((_,r)=>reject=r)});assert.equal(await c.ready,false);reject(Error('synthetic diagnostic'));await Promise.resolve();await Promise.resolve();const n=nodes(f);assert.equal(n.input.disabled,true);assert.doesNotMatch(n.status.textContent,/synthetic diagnostic/);c.destroy();
});
test('destroy settles pending stylesheet readiness and removes link listeners without re-enabling',async()=>{
 const f=fixture();f.doc.stylesheetOutcome='pending';const c=mountEmojiFormatChecker(f.container,{loadRuntime:async()=>stubRuntime()}),n=nodes(f);await Promise.resolve();c.destroy();assert.equal(await c.ready,false);assert.equal(f.container.children.length,0);assert.equal(n.input.disabled,true);for(const set of n.stylesheet.listeners.values())assert.equal(set.size,0);fire(n.stylesheet,'load',{bubbles:false});assert.equal(n.input.disabled,true);
});
test('pinned Unicode runtime and public data match exact reviewed bytes',()=>{
 assertPublicFiles(['emoji17.mjs','emoji17-data.mjs']);
});
test('runtime import graph stays same-folder and public table only; no candidate or test graph edge',()=>{
 const checker=readFileSync(new URL('../web/emoji-format-checker.mjs',import.meta.url),'utf8'),runtime=readFileSync(new URL('../web/emoji17.mjs',import.meta.url),'utf8'),data=readFileSync(new URL('../web/emoji17-data.mjs',import.meta.url),'utf8'),demo=readFileSync(new URL('./fixtures/emoji-format/demo.mjs',import.meta.url),'utf8');
 assert.deepEqual([...checker.matchAll(/\bimport\(['"]([^'"]+)['"]\)/g)].map(m=>m[1]),['./emoji17.mjs']);assert.deepEqual([...runtime.matchAll(/^import\s+[^\n]+from\s+['"]([^'"]+)['"]/gm)].map(m=>m[1]),['./emoji17-data.mjs']);assert.doesNotMatch(runtime,/import\s*\(/);assert.doesNotMatch(data,/^import\s|import\s*\(/m);assert.match(demo,/from '\.\.\/\.\.\/\.\.\/web\/emoji-format-checker\.mjs'/);assert.doesNotMatch(checker+runtime,/candidate-equivalence|candidate-review|AMBIGUITIES\.md|\.test\.mjs/);
});
test('pinned component, external stylesheet and public attribution match exact reviewed bytes',()=>{
 assertPublicFiles(['emoji-format-checker.mjs','emoji-format-checker.css','LICENSE-UNICODE.txt','PUBLIC-PROVENANCE.json']);
});

test('original structural stubs reject script/style nodes, inline styles and event-handler attributes',()=>{
 const f=fixture();for(const tag of ['style','STYLE','script'])assert.throws(()=>f.doc.createElement(tag),/CSP structural stub/);const el=f.doc.createElement('div');assert.throws(()=>el.setAttribute('style','color:red'),/CSP structural stub/);assert.throws(()=>el.setAttribute('onclick','anything'),/CSP structural stub/);assert.throws(()=>el.style,/CSP structural stub/);
});
