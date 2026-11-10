import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {namedText} from '../reference-web/ui-core.js';
test('human domain prose links complete names, parents and history without partial-word or partial-emoji deception',()=>{
 const prior=globalThis.document;globalThis.document={createElement:()=>({})};
 try{const parts=[],node={append:(...v)=>parts.push(...v)};const text='nexus · seed.nexus; nexus. nexustest test.nexus 🚀🌕 🚀 <img onerror=evil>';
 namedText(node,text,['nexus','seed.nexus','🚀']);
 assert.deepEqual(parts.filter(v=>typeof v==='object').map(v=>[v.textContent,v.href]),[['nexus','/d/nexus'],['seed.nexus','/d/seed.nexus'],['nexus','/d/nexus'],['🚀','/d/'+encodeURIComponent('🚀')]]);
 assert.equal(parts.map(v=>typeof v==='string'?v:v.textContent).join(''),text);
 const source=readFileSync('reference-web/ui-render.js','utf8');assert.match(source,/namedText\(add\(card, "h4", ""\), label\)/);assert.match(source,/nameLink\(refundLine, a.name\)/);
 assert.match(readFileSync('reference-web/ui-search.js','utf8'),/nameLink\(kind,info.parent\)/);assert.match(readFileSync('reference-web/ui-domain.js','utf8'),/namedText\(add\(card,"p",""\),row.text\)/);
 }finally{globalThis.document=prior;}
});
test('Pages declares its enforceable meta policies and keeps GitHub/Mirror links in the footer with logos',()=>{
 const html=readFileSync('web/index.html','utf8'),terms=readFileSync('reference-web/terms.html','utf8'),[before,footer]=html.split('<footer>');
 const builder=readFileSync('src/pages-build.ts','utf8');assert.match(builder,/default-src 'none'; script-src 'self'/);assert.match(builder,/connect-src 'self' https:\/\/minepoa.com\/chain\/poa-mainnet-1\/api\/status https:\/\/minepoa.com\/chain\/poa-mainnet-1\/api\/network-facts/);assert.doesNotMatch(before,/http-equiv="Content-Security-Policy"/);assert.doesNotMatch(builder,/unsafe-inline|unsafe-eval|frame-ancestors/);assert.match(before,/<meta name="referrer" content="no-referrer"/);assert.match(terms,/<meta name="referrer" content="no-referrer"/);
 assert.doesNotMatch(before,/<a[^>]+href="https:\/\/(?:github.com|maximusmaximus.github.io)/);assert.equal((footer.match(/class="github-mark"/g)??[]).length,2);assert.match(footer,/>Mirror Site<\/span>/);assert.doesNotMatch(html,/My POA|coming soon|future plans/i);
});
