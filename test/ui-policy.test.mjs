import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {TEST_ROWS} from '../web/emoji17-data.mjs';
import {DOMAIN_FONT_FILE,IMMUTABLE_FONT_CACHE,UI_SECURITY,secureUiResponse} from '../dist/src/ui-policy.js';
test('immutable font filename identifies exact reviewed bytes; all pinned sequence code points fit exact ranges',()=>{
 const bytes=readFileSync('reference-web/'+DOMAIN_FONT_FILE);
 assert.equal(DOMAIN_FONT_FILE,'domain-emoji.'+createHash('sha256').update(bytes).digest('hex').slice(0,16)+'.woff2');
 assert.deepEqual(bytes,readFileSync('reference-web/XeroEmoji-COLRv1.woff2'));
 const scan=readFileSync('scripts/security-scan.mjs','utf8');assert.ok(scan.includes('reference-web/'+DOMAIN_FONT_FILE));assert.ok(scan.includes(createHash('sha256').update(bytes).digest('hex')));
 const css=readFileSync('reference-web/style.css','utf8');assert.ok(css.includes('./'+DOMAIN_FONT_FILE));assert.ok(!css.includes('./XeroEmoji-COLRv1.woff2'));
 const expected=new Set(TEST_ROWS.flatMap(r=>r[0].split(' ').map(c=>parseInt(c,16))));
 for(const [,range]of css.matchAll(/unicode-range:\s*([^;]+);/g)){
  const actual=new Set();for(const token of range.split(',')){const [a,b]=token.trim().slice(2).split('-').map(x=>parseInt(x,16));for(let n=a;n<=(b??a);n++)actual.add(n);}
  assert.deepEqual(actual,expected);for(const n of [0x2192,0x2715,0x41])assert.ok(!actual.has(n));
  for(const n of [0x200d,0xfe0f,0x20e3,0x1f3fb,0xe007f,0x30])assert.ok(actual.has(n));
 }
 assert.equal([...css.matchAll(/unicode-range:/g)].length,3);
 const root=/:root\s*\{([^}]+)\}/.exec(css)[1];assert.doesNotMatch(root,/font:\s*[^;]*var\(--emoji-font\)/);
});
test('static policy matches generated responses, limits connect-src to current origin, and preserves clipboard writes',()=>{
 const text=readFileSync('reference-web/_headers','utf8');
 for(const[name,value]of Object.entries(UI_SECURITY))assert.ok(text.toLowerCase().includes('  '+name+': '+value.toLowerCase()),name);
 assert.match(UI_SECURITY['content-security-policy'],/connect-src 'self';/);assert.doesNotMatch(UI_SECURITY['content-security-policy'],/https:|localhost|127\.0\.0\.1|unsafe-/);
 assert.match(UI_SECURITY['permissions-policy'],/clipboard-write=\(self\)/);
 assert.doesNotMatch(UI_SECURITY['strict-transport-security'],/includeSubDomains|preload/);
 assert.ok(text.includes('/'+DOMAIN_FONT_FILE+'\n  Content-Type: font/woff2\n  Cache-Control: '+IMMUTABLE_FONT_CACHE));
 assert.doesNotMatch(text,/Access-Control-Allow-Origin/i);
});
test('header boundary preserves all response bytes/status/CORS for JSON and MCP; only HTML loses wildcard CORS',async()=>{
 for(const [type,status]of [['application/json',200],['application/json',409],['application/json',503],['text/plain',200]]){
  const body=' {"unchanged":"exact public response bytes"}\n';
  const response=secureUiResponse(new Response(body,{status,headers:{'content-type':type,'access-control-allow-origin':'*','retry-after':'30','cache-control':'no-store','mcp-protocol-version':'2025-11-25'}}),new URL('https://poadomains.grok.me/mcp'));
  assert.equal(await response.text(),body);assert.equal(response.status,status);assert.equal(response.headers.get('access-control-allow-origin'),'*');assert.equal(response.headers.get('retry-after'),'30');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('mcp-protocol-version'),'2025-11-25');
  for(const[k,v]of Object.entries(UI_SECURITY))assert.equal(response.headers.get(k),v);
 }
 const html=secureUiResponse(new Response('<html>same</html>',{headers:{'content-type':'text/html; charset=utf-8','access-control-allow-origin':'*'}}),new URL('https://poadomains.grok.me/d/alpha'));
 assert.equal(html.headers.get('access-control-allow-origin'),null);assert.equal(await html.text(),'<html>same</html>');
 const font=secureUiResponse(new Response('font',{headers:{'cache-control':'no-store'}}),new URL('https://poadomains.grok.me/'+DOMAIN_FONT_FILE));assert.equal(font.headers.get('cache-control'),IMMUTABLE_FONT_CACHE);assert.equal(font.headers.get('content-type'),'font/woff2');
});
