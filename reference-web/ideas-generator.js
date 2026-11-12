import { IDEA_WORDS, IDEA_EMOJI, inspectName } from "./shared.js?v=1178313f1e36";
const topics = [
 {keys:["moon","star","space","rocket","cosmic","astro","nova","🚀","🌙","🪐"],words:["moonbeam","starlight","orbit","galaxy","cosmos","nebula","comet","astro","lunar"],emoji:["🚀","🌙","🪐","⭐","☄️"]},
 {keys:["sea","ocean","wave","river","water","whale","🌊","🐳"],words:["ocean","coral","tidal","harbor","island","river","pearl","sail","lagoon"],emoji:["🌊","🐳","🐙","🐚","🐠"]},
 {keys:["food","pizza","taco","mango","honey","🍕","🌮"],words:["sushi","taco","mango","honey","noodle","waffle","lemon","peach","olive"],emoji:["🍕","🌮","🍣","🍩","🍑"]},
 {keys:["green","leaf","tree","flower","nature","🌻","🌵"],words:["meadow","bloom","maple","lotus","forest","clover","garden","willow","fern"],emoji:["🌻","🌵","🍀","🌳","🍄"]},
 {keys:["cat","dog","fox","panda","animal","🦊","🐼"],words:["panda","otter","koala","falcon","tiger","llama","zebra","whale"],emoji:["🦊","🐼","🐨","🐯","🦦"]}
];
export function ideaPools(query, manifest) {
 const q=String(query??"").toLowerCase().trim().slice(0,128), topic=topics.find(t=>t.keys.some(k=>q.includes(k))), wordSeed=/^[a-z]+$/.test(q)?q.slice(0,48):"", contextual=wordSeed?[wordSeed,...["hub","lab","land","world","garden","house","space"].map(s=>wordSeed+s),...IDEA_WORDS.filter(w=>w.startsWith(wordSeed.slice(0,3)))]:[], words=[...(topic?.words??[]),...contextual,...IDEA_WORDS];
 // Full capability catalogue, not a fabricated count or an AI-generation claim.
 const catalogue=manifest?.sequences?Object.values(manifest.sequences):(manifest?.aliases??[]).map(x=>x.canonical);
 let seed=[];try{const n=inspectName(q,manifest);if(n.isRoot&&n.isSingleEmoji)seed=[n.canonical];}catch{}
 const emoji=[...new Set([...seed,...(topic?.emoji??[]),...IDEA_EMOJI,...catalogue])].filter(n=>{try{return inspectName(n,manifest).isSingleEmoji;}catch{return false;}});
 return {words:[...new Set(words)],emoji,related:!!topic||!!seed.length||!!wordSeed};
}
export function createIdeaGenerator({query="",manifest,accept=()=>true}) {
 const pools=ideaPools(query,manifest), positions={words:0,double:0,single:0}, recent={words:[],double:[],single:[]};
 return {related:pools.related,next(lane) {
  const p=lane==="words"?pools.words:pools.emoji, max=lane==="double"?p.length*p.length:p.length;
  if(!max)return null;
  // A finite catalogue rotates forever; only the recent window is excluded, not all past ideas.
  for(let attempt=0;attempt<Math.min(max,12000);attempt++){
   const i=positions[lane]++%max;let name=lane==="double"?p[i%p.length]+p[Math.floor(i/p.length)%p.length]:p[i];
   try{const n=inspectName(name,manifest);name=n.canonical;if(!n.isRoot||(lane==="words"&&(n.emojiCount||!/^[a-z]+$/.test(name)))||(lane==="double"&&(n.tokenCount!==2||n.emojiCount!==2))||(lane==="single"&&!n.isSingleEmoji)||!accept(name)||recent[lane].includes(name))continue;}catch{continue;}
   recent[lane].push(name);if(recent[lane].length>Math.min(20,Math.max(0,p.length-1)))recent[lane].shift();return name;
  }
  return null;
 }};
}
