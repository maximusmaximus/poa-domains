// Archive only the already-tested explicit public allowlist, including discovery.
// The pinned upload-pages-artifact action excludes all dot directories by default.
import assert from 'node:assert/strict';
import {lstatSync,openSync,closeSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {PUBLIC_FILES,publicArtifactFiles} from '../dist/src/pages-build.js';
const [directory,archive]=process.argv.slice(2);
assert.ok(directory&&archive&&process.argv.length===4,'PAGES_ARCHIVE_ARGUMENTS');
const root=resolve(directory),stat=lstatSync(root);
assert.ok(stat.isDirectory()&&!stat.isSymbolicLink(),'ARTIFACT_DIRECTORY');
const files=publicArtifactFiles(root);
assert.deepEqual(files,[...PUBLIC_FILES].sort(),'UNEXPECTED_BUILD_ARTIFACT');
for(const file of files) assert.equal(lstatSync(resolve(root,file)).nlink,1,'ARTIFACT_HARDLINK');
const directories=readdirSync(root,{recursive:true}).filter(file=>lstatSync(resolve(root,file)).isDirectory()).sort();
assert.deepEqual(directories,[...new Set(files.filter(file=>file.includes('/')).map(file=>file.slice(0,file.lastIndexOf('/'))))].sort(),'UNEXPECTED_BUILD_DIRECTORY');
const fd=openSync(resolve(archive),'wx',0o600);
try { execFileSync('tar',['--format=gnu','--mode=u+rwX,go+rX','--directory',root,'--create','--file','-','--','.'],{stdio:['ignore',fd,'pipe']}); }
finally { closeSync(fd); }
console.log('Archived exactly '+files.length+' tested public files, including .well-known/agent.json and .nojekyll');
