import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJSON,SafeError } from './core.ts';
import { publicReport } from './public-report.ts';
import type { Report } from './types.ts';
import { DEFAULT_SUBMISSION_ENDPOINT,PUBLIC_SUBMISSION_PHRASE } from './submission-config.ts';

export interface DeliveryConfig { endpoint:string; phrase:string; participant:string }
export async function loadDelivery(directory:string,overrides:{endpoint?:string;disabled?:boolean;participant?:string}={}):Promise<DeliveryConfig|null> {
  if(overrides.disabled)return null;
  let value:any={};const path=join(directory,'local/delivery.json');if(existsSync(path))value=await readJSON(path);
  // Legacy token settings are ignored, never read. No secret is needed now.
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['endpoint','phrase','participant','token_env','token_file'].includes(k)))throw new SafeError('invalid_delivery_config');
  const endpoint=overrides.endpoint??process.env.AGENT_HOURS_SUBMIT_URL??value.endpoint??DEFAULT_SUBMISSION_ENDPOINT;
  const config:DeliveryConfig={endpoint,phrase:value.phrase??PUBLIC_SUBMISSION_PHRASE,participant:overrides.participant??process.env.AGENT_HOURS_PARTICIPANT??value.participant??'anonymous'};
  let url:URL;try{url=new URL(config.endpoint);}catch{throw new SafeError('invalid_delivery_config');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/reports'||typeof config.phrase!=='string'||!/[\S]/.test(config.phrase)||config.phrase.length>128||/[^\x20-\x7e]/.test(config.phrase)||typeof config.participant!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(config.participant))throw new SafeError('invalid_delivery_config');
  return config;
}
export async function sendReport(input:Report,config:DeliveryConfig,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<void> {
  const report=publicReport(input);if(report.run_status!=='completed'||report.pending_sessions!==0)throw new SafeError('incomplete_report_not_sent');
  const body=JSON.stringify({version:1,participant:config.participant,report});if(new TextEncoder().encode(body).length>8*1024*1024)throw new SafeError('delivery_report_too_large');
  try{
    const response=await fetcher(config.endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Report-Phrase':config.phrase},body,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});
    if(!response.ok){await response.body?.cancel();throw new SafeError('delivery_failed');}
    // Response bodies and provider errors are not shown; successful acceptance
    // is not a guarantee of inbox delivery. No automatic retry on ambiguity.
    await response.body?.cancel();
  }catch{if(signal.aborted)throw new SafeError('cancelled');throw new SafeError('delivery_failed');}
}
