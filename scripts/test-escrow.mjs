// All escrow signatures use deterministic public test seeds against a local mock, never mainnet.
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const root=resolve(import.meta.dirname,".."),work=mkdtempSync(join(tmpdir(),"poa-escrow-tests-"));
for(const [source,file] of [["escrow.test.ts","unit.mjs"],["escrow-runtime-fixture.ts","fixture.mjs"]]){
 await build({entryPoints:[join(root,"cloudflare/test",source)],bundle:true,platform:"node",format:"esm",alias:{"#poa-unicode-data":join(root,"cloudflare/unicode-data.ts")},outfile:join(work,file)});
}
const unit=spawnSync(process.execPath,["--test",join(work,"unit.mjs")],{cwd:root,stdio:"inherit"});
if(unit.status!==0)process.exit(unit.status??1);
if(!process.argv.includes("--unit")){
 const runtime=spawnSync(process.execPath,["cloudflare/test/escrow-runtime.mjs"],{cwd:root,stdio:"inherit",
 env:{...process.env,ESCROW_FIXTURE_MODULE:pathToFileURL(join(work,"fixture.mjs")).href}});
 if(runtime.status!==0)process.exit(runtime.status??1);
}
