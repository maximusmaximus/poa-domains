import test from "node:test";
import assert from "node:assert/strict";
import { parseRestoreInput, RESTORE_INPUT_LIMIT } from "../cloudflare/restore-input.js";
import { parseJSON } from "../src/core.js";
const pem="-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n";
const keys=Object.fromEntries(["issuer","treasury","alice","bob","carol"].map(r=>[r,pem]));
const source=JSON.stringify({backup:"x".repeat(40000),keys});
test("isolated restore accepts multiline PEMs and backup strings exceeding public limits",()=>{
 const got=parseRestoreInput(source);assert.equal(got.backup.length,40000);assert.equal(got.keys.issuer,pem);
 assert.equal(Object.getPrototypeOf(got.keys),Object.prototype,"keys must be plain objects for Worker RPC");
});
test("restore parser rejects duplicate keys including nested/escaped keys",()=>{
 for(const x of ['{"backup":"x","backup":"y","keys":{}}','{"backup":"x","keys":{"issuer":"a","\\u0069ssuer":"b"}}'])
 assert.throws(()=>parseRestoreInput(x),/DUPLICATE_KEY/);
});
test("restore is bounded and rejects unsafe keys, trailing JSON and bad schemas",()=>{
 for(const x of ['{"__proto__":0}',source+'null',JSON.stringify({backup:'x',keys:{}}),JSON.stringify({backup:'x',keys,extra:1})])
 assert.throws(()=>parseRestoreInput(x));
 assert.throws(()=>parseRestoreInput(' '.repeat(RESTORE_INPUT_LIMIT+1)),/BODY_TOO_LARGE/);
 assert.throws(()=>parseRestoreInput('['.repeat(66)+'0'+']'.repeat(66)),/RESTORE_JSON_LIMIT/);
});
test("public ingress remains secret rejecting and bounded",()=>{
 assert.throws(()=>parseJSON(source));assert.throws(()=>parseJSON(JSON.stringify({keys})));assert.throws(()=>parseJSON('{"a":1,"a":2}'),/DUPLICATE_KEY/);
});
test("restore syntax/key errors never echo supplied private material",()=>{
 for(const x of ['{"backup":"DO_NOT_ECHO',JSON.stringify({backup:'x',keys:{...keys,issuer:'DO_NOT_ECHO'}})])
 assert.throws(()=>parseRestoreInput(x),(e:any)=>!e.message.includes('DO_NOT_ECHO'));
});
