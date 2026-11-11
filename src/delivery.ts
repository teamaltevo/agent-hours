import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readFile,lstat } from 'node:fs/promises';
import { readJSON,SafeError } from './core.ts';
import { publicReport } from './public-report.ts';
import type { Report } from './types.ts';

export interface DeliveryConfig { endpoint:string; token_env:string; participant:string; token_file?:string }
async function tokenFor(config:DeliveryConfig):Promise<string> {
  let token=process.env[config.token_env];
  if(!token&&config.token_file){try{const info=await lstat(config.token_file);if(info.isSymbolicLink()||(process.platform!=='win32'&&(info.mode&0o077)!==0))throw 0;token=(await readFile(config.token_file,'utf8')).trim();}catch{throw new SafeError('delivery_token_missing');}}
  if(!token||token.length<32||token.length>512||/\s/.test(token))throw new SafeError('delivery_token_missing');return token;
}
export async function loadDelivery(directory:string,overrides:{endpoint?:string;disabled?:boolean;participant?:string}={}):Promise<DeliveryConfig|null> {
  if(overrides.disabled)return null;
  let value:any={};const path=join(directory,'local/delivery.json');if(existsSync(path))value=await readJSON(path);
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['endpoint','token_env','participant','token_file'].includes(k)))throw new SafeError('invalid_delivery_config');
  const endpoint=overrides.endpoint??process.env.AGENT_HOURS_SUBMIT_URL??value.endpoint;if(!endpoint)return null;
  if(value.token_file!==undefined&&value.token_file!=='delivery-upload-token')throw new SafeError('invalid_delivery_config');
  const config:DeliveryConfig={endpoint,token_env:value.token_env??'AGENT_HOURS_UPLOAD_TOKEN',participant:overrides.participant??process.env.AGENT_HOURS_PARTICIPANT??value.participant??'anonymous',...(value.token_file?{token_file:join(directory,'local',value.token_file)}:{})};
  let url:URL;try{url=new URL(config.endpoint);}catch{throw new SafeError('invalid_delivery_config');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/reports'||!/^[A-Z][A-Z0-9_]{0,79}$/.test(config.token_env)||typeof config.participant!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(config.participant))throw new SafeError('invalid_delivery_config');
  await tokenFor(config);
  return config;
}
export async function sendReport(input:Report,config:DeliveryConfig,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<void> {
  const report=publicReport(input);if(report.run_status!=='completed'||report.pending_sessions!==0)throw new SafeError('incomplete_report_not_sent');
  const token=await tokenFor(config);
  const body=JSON.stringify({version:1,participant:config.participant,report});if(new TextEncoder().encode(body).length>8*1024*1024)throw new SafeError('delivery_report_too_large');
  try{
    const response=await fetcher(config.endpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});
    if(!response.ok){await response.body?.cancel();throw new SafeError('delivery_failed');}
    // Response bodies and provider errors are not shown; successful acceptance
    // is not a guarantee of inbox delivery. No automatic retry on ambiguity.
    await response.body?.cancel();
  }catch{if(signal.aborted)throw new SafeError('cancelled');throw new SafeError('delivery_failed');}
}
