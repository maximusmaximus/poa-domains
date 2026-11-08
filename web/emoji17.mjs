// ORIGINAL PRIVATE Unicode 17 exact recognition prototype. No approved ownership canonicalization.
// Official Unicode data attribution/license: LICENSE-UNICODE.txt. No runtime I/O, Intl, regex properties or NFC.
import { DATA_INFO, TEST_ROWS, PRESENTATION_ROWS } from './emoji17-data.mjs';
export const VERSION = 'PRIVATE-emoji17-exact-recognition-v1-NOT-ACTIVATED';
export const LIMITS = Object.freeze({ maxInputCodeUnits: 4096, minLabelEmoji: 1, maxLabelEmoji: 32, premiumMaxEmoji: 3 });
const messages = Object.freeze({ INVALID_INPUT: 'A bounded scalar Unicode string is required.', INVALID_OPTIONS: 'Only documented plain option values are accepted.', UNSUPPORTED_SEQUENCE: 'The whole sequence is not in the selected pinned repertoire.', COMPONENT_NOT_A_NAME: 'Standalone emoji components are not name characters.', QUALIFICATION_NOT_ACCEPTED: 'This qualification is not enabled.', EMPTY_LABEL: 'An emoji label must contain at least one supported sequence.', LABEL_TOO_LONG: 'An emoji label may contain at most thirty-two supported sequences.', CANONICAL_POLICY_UNAPPROVED: 'Published-basename and ownership equivalence policy is not approved or implemented.' });
export class Emoji17Error extends Error {
 constructor(code) { const c=Object.hasOwn(messages,code)?code:'INVALID_INPUT';super(messages[c]);this.name='Emoji17Error';this.code=c;Object.freeze(this); }
}
const fail=code=>{throw new Emoji17Error(code);};
const fromHex=hex=>String.fromCodePoint(...hex.split(' ').map(x=>parseInt(x,16)));
function checkedString(input) {
 if(typeof input!=='string'||input.length>LIMITS.maxInputCodeUnits)fail('INVALID_INPUT');
 for(let i=0;i<input.length;i++){
  const c=input.charCodeAt(i);
  if(c>=0xD800&&c<=0xDBFF){const n=input.charCodeAt(++i);if(!(n>=0xDC00&&n<=0xDFFF))fail('INVALID_INPUT');}
  else if(c>=0xDC00&&c<=0xDFFF)fail('INVALID_INPUT');
 }
 return input;
}
function options(value) {
 const out={qualification:'listed',presentation:'emoji-test-only'};
 if(value===undefined)return out;
 if(value===null||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('INVALID_OPTIONS');
 for(const key of Reflect.ownKeys(value)){
  if(typeof key!=='string'||!Object.hasOwn(out,key))fail('INVALID_OPTIONS');
  const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)fail('INVALID_OPTIONS');out[key]=d.value;
 }
 if(!['listed','fully-qualified'].includes(out.qualification)||!['emoji-test-only','listed-standalone'].includes(out.presentation))fail('INVALID_OPTIONS');
 if(out.qualification==='fully-qualified'&&out.presentation!=='emoji-test-only')fail('INVALID_OPTIONS');
 return out;
}
const records=Object.freeze(TEST_ROWS.map(([hex,status,shortName,emojiVersion,group,subgroup,fullyQualifiedHex,line])=>Object.freeze({
 hex,sequence:fromHex(hex),qualification:status,shortName,emojiVersion,group,subgroup,
 fullyQualifiedHex,fullyQualifiedSequence:fullyQualifiedHex?fromHex(fullyQualifiedHex):null,
 sourceFile:'emoji-test.txt',sourceLine:line,rgiMember:status==='fully-qualified'||status==='component',nameCharacter:status!=='component',
 ownershipCanonicalizationSupported:false,
})));
const table=new Map(records.map(r=>[r.sequence,r]));
const presentations=Object.freeze(PRESENTATION_ROWS.map(([hex,style,fullyQualifiedHex,shortName,line])=>Object.freeze({
 hex,sequence:fromHex(hex),qualification:style==='text style'?'text-presentation':'emoji-presentation',shortName,
 fullyQualifiedHex,fullyQualifiedSequence:fromHex(fullyQualifiedHex),sourceFile:'emoji-variation-sequences.txt',sourceLine:line,
 rgiMember:table.get(fromHex(hex))?.rgiMember??false,nameCharacter:true,ownershipCanonicalizationSupported:false,
})));
const listed=new Map(records.filter(r=>r.nameCharacter).map(r=>[r.sequence,r]));
const fully=new Map(records.filter(r=>r.qualification==='fully-qualified').map(r=>[r.sequence,r]));
const withPresentation=new Map(listed);
for(const r of presentations)if(!withPresentation.has(r.sequence))withPresentation.set(r.sequence,r);
function makeTrie(index){
 const root={next:new Map(),terminal:null};
 for(const [sequence,r] of index){let node=root;for(const ch of sequence){if(!node.next.has(ch))node.next.set(ch,{next:new Map(),terminal:null});node=node.next.get(ch);}node.terminal=r;}
 return root;
}
const tries={listed:makeTrie(listed),fully:makeTrie(fully),presentation:makeTrie(withPresentation)};
function selected(o){return o.qualification==='fully-qualified'?{index:fully,trie:tries.fully}:o.presentation==='listed-standalone'?{index:withPresentation,trie:tries.presentation}:{index:listed,trie:tries.listed};}
export function getDataInfo(){return DATA_INFO;}
export function listEmojiRecords(){return records;}
/** Includes all eligible source-listed standalone variation pairs, even those already in emoji-test. */
export function listPresentationRecords(){return presentations;}
/** Exact emoji-test record lookup, INCLUDING component records for audit, not name admission. */
export function lookupEmoji(input){checkedString(input);return table.get(input)??null;}
/** Whole-sequence exact recognition. Defaults accept only official FQ/MQ/UQ spellings, never arbitrary FE0F omission. */
export function recognizeEmoji(input, opts){
 checkedString(input);const o=options(opts),r=selected(o).index.get(input);
 if(r)return r;
 const known=table.get(input);
 if(known?.qualification==='component')fail('COMPONENT_NOT_A_NAME');
 if(known&&o.qualification==='fully-qualified')fail('QUALIFICATION_NOT_ACCEPTED');
 fail('UNSUPPORTED_SEQUENCE');
}
/** Emoji-only label slice. Entire input must succeed. No partial result, fallback text or deletion on any failure.
 * Greedy exact recognized sequences, NOT a general Unicode grapheme/NFC/IDNA implementation.
 */
export function tokenizeEmojiLabel(input,opts){
 checkedString(input);const o=options(opts),{trie}=selected(o);
 if(!input.length)fail('EMPTY_LABEL');
 const points=Array.from(input),tokens=[];let pos=0,unit=0;
 while(pos<points.length){
  let node=trie,j=pos,last=null,end=pos;
  while(j<points.length&&node.next.has(points[j])){
   node=node.next.get(points[j++]);if(node.terminal){last=node.terminal;end=j;}
  }
  if(!last)fail(table.get(points[pos])?.qualification==='component'?'COMPONENT_NOT_A_NAME':'UNSUPPORTED_SEQUENCE');
  const source=points.slice(pos,end).join(''),start=unit;unit+=source.length;
  tokens.push(Object.freeze({startCodeUnit:start,endCodeUnit:unit,inputSequence:source,record:last}));
  if(tokens.length>LIMITS.maxLabelEmoji)fail('LABEL_TOO_LONG');
  pos=end;
 }
 // Qualification representative preserves gender/direction/skin/hair, region and all semantic bytes.
 // It is an official display spelling, explicitly NOT an ownership/published-basename canonical token.
 return Object.freeze({kind:'private-unactivated-emoji-only-label-analysis',version:VERSION,operational:false,
  emojiCount:tokens.length,countBasis:'each exact supported whole emoji sequence = 1',
  lengthTier:tokens.length<=LIMITS.premiumMaxEmoji?'premium':'standard',
  qualificationForm:tokens.map(t=>t.record.fullyQualifiedSequence).join(''),tokens:Object.freeze(tokens),
  ownershipCanonicalizationSupported:false,semanticEquivalenceApplied:false});
}
/** Fail closed until an exact versioned published-basename/equivalence policy is genuinely approved. */
export function canonicalizeOwnershipLabel(){fail('CANONICAL_POLICY_UNAPPROVED');}
