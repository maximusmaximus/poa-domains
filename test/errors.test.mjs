import {intentId} from '../dist/src/auth.js';
import {setup} from '../dist/test/helpers.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ERROR_CATALOGUE,errorEnvelope,errorReply,correlationId} from '../dist/src/errors.js';
import {literalErrorCodes,sourceErrorCodes} from '../scripts/error-codes.mjs';
import {errorArtifacts} from '../scripts/errors-generate.mjs';
import {RequestError,request} from '../dist/src/client.js';
import {cliFailure} from '../dist/src/cli-errors.js';
export function assertEnvelope(body) {for(const key of ['code','message','docs','requestId'])assert.equal(typeof body[key],'string',key);assert.equal(typeof body.retryable,'boolean');assert.ok([false,true,'unknown'].includes(body.accepted));assert.ok(Object.hasOwn(ERROR_CATALOGUE,body.code));}
test('every literal need/Fault/error code has catalogue status and retryability; generated docs/JSON cannot drift',()=>{
 assert.deepEqual(literalErrorCodes('need(fn(1, "not-code"), "MY_ERROR"); new Fault("OTHER_ERROR"); // need(a,"COMMENT_ERROR")'),['MY_ERROR','OTHER_ERROR']);
 const actual=sourceErrorCodes();assert.ok(actual.length>=290);for(const code of actual)assert.ok(Object.hasOwn(ERROR_CATALOGUE,code),'Undocumented code: '+code);
 for(const [file,value]of Object.entries(errorArtifacts()))assert.equal(readFileSync(file,'utf8'),value,file);
 for(const e of Object.values(ERROR_CATALOGUE)){assert.ok(e.httpStatus>=400&&e.httpStatus<600);assert.equal(typeof e.retryable,'boolean');assertEnvelope(errorEnvelope(e.code,'catalogue-test'));}
 assert.equal(correlationId('safe-request_1'),'safe-request_1');assert.notEqual(correlationId('unsafe value'),'unsafe value');
 assert.equal(errorReply(409,{code:'CONTENT_TYPE'},'test').status,400);assert.equal(errorReply(503,{code:'ESCROW_DISABLED'},'test').status,503);
});
test('client never treats an ordinary 404 or missing receipt as success, and classifies exact-resend uncertainty',async()=>{
 const previous=globalThis.fetch;let calls=0;const packet=setup().packet('cancelAuction',{auctionId:'a'.repeat(64),expectedVersion:1});
 try {
  globalThis.fetch=async()=>{calls++;return Response.json({code:'NOT_FOUND',accepted:false},{status:404});};
  await assert.rejects(request('http://127.0.0.1:18800','/missing'),e=>e instanceof RequestError&&e.kind==='rejected'&&cliFailure(e).exitCode===3);
  globalThis.fetch=async()=>Response.json({status:'unknown',code:'UNKNOWN_OUTCOME'},{status:404});
  await assert.rejects(request('http://127.0.0.1:18800','/v1/receipts/'+'0'.repeat(64)),e=>e.kind==='unknown'&&e.detail.accepted==='unknown'&&cliFailure(e).exitCode===4);
  globalThis.fetch=async()=>{calls++;throw Error('synthetic connection loss');};
  await assert.rejects(request('http://127.0.0.1:18800','/v1/state'),e=>e.kind==='network'&&!e.sent&&cliFailure(e).exitCode===5);
  await assert.rejects(request('http://127.0.0.1:18800','/v1/intents',packet),e=>e.kind==='unknown'&&e.sent&&e.detail.accepted==='unknown'&&cliFailure(e).exitCode===4&&cliFailure(e).body.retry.body===JSON.stringify(packet));
  const before=calls;await assert.rejects(request('https://not-allowed.invalid','/v1/intents',packet));assert.equal(calls,before,'invalid endpoint was never sent');
  const circular={};circular.self=circular;await assert.rejects(request('http://127.0.0.1:18800','/v1/intents',circular));assert.equal(calls,before,'serialization failure was never sent');
  globalThis.fetch=async()=>new Response('<html>bad gateway</html>',{status:502});
  await assert.rejects(request('http://127.0.0.1:18800','/v1/intents',packet),e=>e.kind==='unknown');
  globalThis.fetch=async()=>Response.json({unexpected:'missing receipt'});
  await assert.rejects(request('http://127.0.0.1:18800','/v1/intents',packet),e=>e.kind==='unknown');
  globalThis.fetch=async()=>Response.json({status:'rejected',intentId:intentId(packet.body),code:'MIN_RAISE',accepted:true});
  await assert.rejects(request('http://127.0.0.1:18800','/v1/intents',packet),e=>e.kind==='rejected'&&e.detail.accepted===true);
 }finally{globalThis.fetch=previous;}
});

test('real CLI processes use 2/3/4/5 and MCP errors carry the same envelope',async()=>{
 const {execFile,spawn}=await import('node:child_process');const {promisify}=await import('node:util');const {createServer}=await import('node:http');const exec=promisify(execFile);
 const failure=async(args,expected)=>assert.rejects(exec(process.execPath,['dist/src/reference-cli.js',...args]),e=>{assert.equal(e.code,expected);assertEnvelope(JSON.parse(e.stderr));return true;});
 await failure(['not-a-command'],2);
 const server=createServer((req,res)=>{res.setHeader('content-type','application/json');res.statusCode=req.url.startsWith('/v1/receipts/')?404:400;res.end(JSON.stringify(req.url.startsWith('/v1/receipts/')?{code:'UNKNOWN_OUTCOME',status:'unknown',accepted:'unknown'}:{code:'INVALID_REQUEST',accepted:false}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;
 try{await failure(['capabilities','--url',url],3);await failure(['receipt','--url',url,'--id','0'.repeat(64)],4);}finally{await new Promise(resolve=>server.close(resolve));}
 await failure(['capabilities','--url',url],5);
 const child=spawn(process.execPath,['dist/src/reference-cli.js','mcp','--url',url],{stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',chunk=>output+=chunk);child.stdin.end([{jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'error-test',version:'1'}}},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:1,method:'not-a-method'}].map(x=>JSON.stringify(x)).join('\n')+'\n');await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('MCP fixture exit '+code)));});
 const rpc=output.trim().split('\n').map(line=>JSON.parse(line)).find(x=>x.id===1);assert.equal(rpc.error.code,-32601);assertEnvelope(rpc.error.data);assert.equal(rpc.error.data.code,'METHOD_NOT_FOUND');
});
