import { Fault } from './core.js';
import { RequestError } from './client.js';
import { faultEnvelope } from './errors.js';
export function cliFailure(error:unknown) {
 const exitCode=error instanceof RequestError?({rejected:3,unknown:4,network:5} as const)[error.kind]:error instanceof Fault&&error.code==='NATIVE_NAMING_UNAVAILABLE'?3:error instanceof Fault&&error.code==='NATIVE_DIGEST'?2:error instanceof Fault&&error.code.startsWith('NATIVE_')?5:2;
 return {exitCode,body:{...faultEnvelope(error),submitted:error instanceof RequestError&&error.sent,sent:error instanceof RequestError&&error.sent,...(error instanceof RequestError&&error.kind==='unknown'&&error.retryBody?{retry:{method:'POST',path:'/v1/intents',body:error.retryBody}}:{})}};
}
