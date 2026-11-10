// Inspect transformed JavaScript tokens, not a regex spanning nested need() arguments.
import {transformSync} from 'esbuild';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
export function literalErrorCodes(source) {
 const js=transformSync(source,{loader:'ts',target:'esnext',legalComments:'none'}).code;
 const tokens=js.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|[^\s]/g)??[],codes=new Set();
 for(let i=0;i<tokens.length;i++) {
  const needed=tokens[i]==='need',raised=['Fault','Error'].includes(tokens[i])&&tokens[i-1]==='new';
  if(!(needed||raised)||tokens[i+1]!=='(')continue;
  let depth=1,args=[[]];
  for(let j=i+2;j<tokens.length;j++) {
   const t=tokens[j];if('([{'.includes(t))depth++;if(')]}'.includes(t))depth--;
   if(depth===0)break;if(t===','&&depth===1)args.push([]);else args.at(-1).push(t);
  }
  const arg=args[needed?1:0];if(arg?.length!==1||!/^"[A-Z][A-Z_0-9]+"$/.test(arg[0]))continue;
  codes.add(JSON.parse(arg[0]));
 }
 return [...codes].sort();
}
export function sourceErrorCodes() {
 const codes=new Set();function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){
  if(e.name==='test'||e.name.endsWith('.d.ts'))continue;const file=join(dir,e.name);
  if(e.isDirectory())walk(file);else if(file.endsWith('.ts'))for(const code of literalErrorCodes(readFileSync(file,'utf8')))codes.add(code);
 }}walk('src');walk('cloudflare');return [...codes].sort();
}
