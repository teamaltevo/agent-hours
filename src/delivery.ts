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
interface RetryOptions {sleep?:(ms:number,signal:AbortSignal)=>Promise<void>;now?:()=>number;maxElapsedMs?:number;maxAttempts?:number}
function sleep(ms:number,signal:AbortSignal):Promise<void>{return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(new SafeError('cancelled'));return;}
  const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new SafeError('cancelled'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});
});}
async function responseData(response:Response):Promise<any>{
  const reader=response.body?.getReader();if(!reader)return null;const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096)return null;chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return JSON.parse(new TextDecoder().decode(bytes));}
  catch{return null;}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function sendReport(input:Report,config:DeliveryConfig,signal:AbortSignal,fetcher:typeof fetch=fetch,retry:RetryOptions={}):Promise<void> {
  const report=publicReport(input);if(report.run_status!=='completed'||report.pending_sessions!==0)throw new SafeError('incomplete_report_not_sent');
  const body=JSON.stringify({version:1,participant:config.participant,report});if(new TextEncoder().encode(body).length>8*1024*1024)throw new SafeError('delivery_report_too_large');
  const now=retry.now??Date.now,pause=retry.sleep??sleep,deadline=now()+(retry.maxElapsedMs??180000);let retryEnabled=config.endpoint===DEFAULT_SUBMISSION_ENDPOINT,last='delivery_failed';
  for(let attempt=0;attempt<(retry.maxAttempts??8)&&now()<deadline;attempt++){
    signal.throwIfAborted();let response:Response;
    try{response=await fetcher(config.endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Report-Phrase':config.phrase,'X-Report-Protocol':'2'},body,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(Math.max(1,Math.min(60000,deadline-now())))])});}
    catch{if(signal.aborted)throw new SafeError('cancelled');if(!retryEnabled)throw new SafeError('delivery_failed');last='delivery_uncertain';await pause(Math.min(15000,Math.max(0,deadline-now())),signal);continue;}
    const data=await responseData(response);if(data?.protocol===2)retryEnabled=true;
    if(response.status===200&&data?.status==='accepted')return;
    const code=typeof data?.error==='string'?data.error:'';
    const terminal:Record<string,string>={daily_email_limit:'delivery_daily_limit',report_bundle_too_large:'delivery_report_too_large',invalid_or_oversized_report:'delivery_report_rejected',phrase_required:'delivery_phrase_rejected',delivery_not_configured:'delivery_service_unavailable',delivery_uncertain:'delivery_uncertain',submission_pending_or_uncertain:'delivery_uncertain'};
    if(terminal[code])throw new SafeError(terminal[code]);
    const processing=response.status===202&&data?.status==='processing';
    const transient=['rate_limited','temporarily_unavailable','report_preparation_failed','report_processing'].includes(code)||retryEnabled&&!data&&[500,502,503,504].includes(response.status);
    if(!retryEnabled||!processing&&!transient)throw new SafeError('delivery_failed');
    last=processing&&data.stage==='sending'?'delivery_uncertain':'delivery_busy';
    const delay=Math.max(1000,Math.min(60000,Number(response.headers.get('retry-after')??15)*1000||15000));
    await pause(Math.min(delay,Math.max(0,deadline-now())),signal);
  }
  throw new SafeError(last);
}
