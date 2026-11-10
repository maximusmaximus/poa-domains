export interface NetworkObservation {
 kind: 'native-network-observation'; source: 'https://minepoa.com'; chainId: 'poa-mainnet-1'; observedAt: number; expiresAt: number;
 verification:'node-reported-unverified'; finalityVerified:false; registryReady:false;
 checkpoint:{height:number;cutoffTs:number}; epochsClosed:number; agentsJoined:number; transactions:number; reportedFinalTransactions:number;
 attestationThreshold:number; engineSha256:string; paramsSha256:string;
}
export interface AvailabilityStatus { epochsClosed:number; checkpointHeight:number|null; agentsJoined:number|null; txs:number|null; final:number|null; stale:boolean|null; staleAgeS:number|null }
export function parseNetworkStatus(status:unknown, options:{facts:unknown;now:number;fail:(code:string)=>never;availabilityOnly?:false}):NetworkObservation;
export function parseNetworkStatus(status:unknown, options:{availabilityOnly:true;now:number;fail:(code:string)=>never}):AvailabilityStatus;
