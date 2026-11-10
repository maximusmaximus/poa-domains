// One graph revision avoids cyclic-import hash recursion and stale mixed UI modules.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const dir=new URL('../reference-web/',import.meta.url);
const read=f=>readFileSync(new URL(f,dir),'utf8');
const hash=text=>createHash('sha256').update(text).digest('hex').slice(0,12);
export function stampAssets(){
 const names=readdirSync(dir).filter(n=>n.endsWith('.js')).sort();
 const bare=text=>text.replace(/(from\s+["']\.\/[a-z0-9-]+\.js)\?v=[0-9a-f]+(["'])/g,'$1$2');
 const originals=Object.fromEntries(names.map(n=>[n,read(n)]));
 const revision=hash(names.map(n=>n+'\n'+bare(originals[n])).join('\n'));
 const files=Object.fromEntries(names.map(n=>[n,bare(originals[n]).replace(/(from\s+["']\.\/[a-z0-9-]+\.js)(["'])/g,`$1?v=${revision}$2`)]));
 const htmlIn=read('index.html');
 files['index.html']=htmlIn.replace(/href="\/style\.css(?:\?v=[0-9a-f]+)?"/,`href="/style.css?v=${hash(read('style.css'))}"`).replace(/src="\/app\.js(?:\?v=[0-9a-f]+)?"/,`src="/app.js?v=${revision}"`);
 return {files,changed:names.some(n=>files[n]!==originals[n])||files['index.html']!==htmlIn};
}
if(import.meta.url===`file://${process.argv[1]}`){
 const {files,changed}=stampAssets();
 if(process.argv.includes('--check')){if(changed){console.error('reference-web asset stamps are stale: run node scripts/stamp-assets.mjs');process.exit(1);}console.log('asset stamps current');}
 else{for(const [f,text]of Object.entries(files))writeFileSync(new URL(f,dir),text);console.log(changed?'asset stamps updated':'asset stamps current');}
}
