// ORIGINAL portable CI configuration. Build must exist; this test never builds or deploys production.
import {defineConfig} from '@playwright/test';
import path from 'node:path';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({testDir:here,testMatch:'emoji-format-product.spec.mjs',fullyParallel:false,workers:1,retries:0,timeout:45000,forbidOnly:!!process.env.CI,outputDir:path.resolve(process.cwd(),'test-results/emoji-format-product'),reporter:[['list'],['json',{outputFile:path.resolve(process.cwd(),'test-results/emoji-format-product-results.json')}]],use:{browserName:'chromium',headless:true,bypassCSP:false,serviceWorkers:'block',viewport:{width:1280,height:900}}});
