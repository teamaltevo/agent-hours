import { publicReport } from '../../src/public-report.ts';
import { publicReportFiles,zipReportFiles,BundleSizeError } from '../../src/bundle.ts';
import { PUBLIC_SUBMISSION_PHRASE } from '../../src/submission-config.ts';
import { deliveryTrace,requestIdPattern,type DeliveryTrace } from './diagnostics.ts';

interface Statement {bind(...values:unknown[]):Statement;run():Promise<{meta?:{changes?:number}}> ;first<T>():Promise<T|null>}
export interface EmailPayload {to:string;from:string;subject:string;text:string;attachments:{content:string;filename:string;type:string;disposition:'attachment'}[]}
export interface Env {
  REPORT_FROM:string;REPORT_TO:string;MAX_DAILY_EMAILS?:string;DELIVERY_LOGS?:string;
  DB:{prepare(sql:string):Statement};
  SUBMISSION_LIMIT:{limit(options:{key:string}):Promise<{success:boolean}>};
  EMAIL:{send(message:EmailPayload):Promise<unknown>};
}
const json=(value:Record<string,unknown>,status=200,retryAfter?:number)=>Response.json({protocol:2,...value},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(retryAfter?{'Retry-After':String(retryAfter)}:{})}});
const preparing=(id:string,protocol:boolean)=>protocol?json({status:'processing',stage:'preparing',submission_id:id},202,15):json({error:'report_processing',submission_id:id},503,15);
interface Receipt {state:string;updated_at:number}
function receiptResponse(receipt:Receipt,id:string,protocol:boolean):Response {
  if(receipt.state==='sent')return json({status:'accepted',submission_id:id});
  if(receipt.state==='sending'&&receipt.updated_at>Date.now()/1000-120)return protocol?json({status:'processing',stage:'sending',submission_id:id},202,15):json({error:'report_processing',submission_id:id},503,15);
  return json({error:'delivery_uncertain',submission_id:id},409);
}
const hex=(bytes:ArrayBuffer)=>[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
async function digest(text:string):Promise<ArrayBuffer>{return crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));}
async function body(request:Request,onRead:(bytes:number)=>Promise<void>):Promise<string>{
  const max=8*1024*1024;if(Number(request.headers.get('content-length'))>max)throw new Error('too_large');const reader=request.body?.getReader();if(!reader)throw new Error('invalid_body');let total=0;const chunks:Uint8Array[]=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>max){await reader.cancel();throw new Error('too_large');}chunks.push(value);}}finally{reader.releaseLock();}
  await onRead(total);const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
function base64(bytes:Uint8Array):string {let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);}
async function handle(request:Request,env:Env,trace:DeliveryTrace):Promise<Response>{
    const path=new URL(request.url).pathname;if(path==='/health'&&request.method==='GET')return json({status:'ok'});
    if(path!=='/reports'||request.method!=='POST')return json({error:'not_found'},404);
    const protocol=request.headers.get('X-Report-Protocol')==='2';
    const dailyLimit=Number(env.MAX_DAILY_EMAILS??50);
    if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>1000||![env.REPORT_FROM,env.REPORT_TO].every(v=>typeof v==='string'&&/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(v)))return json({error:'delivery_not_configured'},503);
    if(request.headers.get('X-Report-Phrase')!==PUBLIC_SUBMISSION_PHRASE)return json({error:'phrase_required'},401);
    // The phrase is public, not authentication. All submitters share this
    // approximate short-window limiter; a D1 quota also caps daily send attempts.
    try{if(!(await env.SUBMISSION_LIMIT.limit({key:'public-report-submissions'})).success)return json({error:'rate_limited'},429,60);}catch{return json({error:'temporarily_unavailable'},503,15);}
    if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return json({error:'invalid_content_type'},415);
    await trace.checkpoint('request_received');
    let parsed:any,report:ReturnType<typeof publicReport>|undefined;
    try{parsed=JSON.parse(await body(request,bytes=>trace.checkpoint('body_read',{input_bytes:bytes})));if(!parsed||Object.keys(parsed).sort().join(',')!=='participant,report,version'||parsed.version!==1||typeof parsed.participant!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(parsed.participant))throw new Error('invalid');report=publicReport(parsed.report);parsed={version:1,participant:parsed.participant};if(report.run_status!=='completed'||report.pending_sessions!==0)throw new Error('incomplete');}
    catch{await trace.checkpoint('rejected',{code:'invalid_or_oversized_report'});return json({error:'invalid_or_oversized_report'},400);}
    if(!report)return json({error:'invalid_or_oversized_report'},400);
    const id=hex(await digest(JSON.stringify({participant:parsed.participant,report})));
    trace.setReceipt(id);await trace.checkpoint('validated');
    const lease=crypto.randomUUID();
    try{
      // D1 stores only hashes, state and timestamps, never reports or identities.
      const prior=await env.DB.prepare('SELECT state,updated_at FROM submissions WHERE id=?').bind(id).first<Receipt>();
      if(prior){await trace.checkpoint('receipt_found',{code:prior.state});return receiptResponse(prior,id,protocol);}
      const claimed=await env.DB.prepare('INSERT INTO preparation_leases (id,token,updated_at) VALUES (?,?,unixepoch()) ON CONFLICT(id) DO UPDATE SET token=excluded.token,updated_at=unixepoch() WHERE updated_at <= unixepoch()-90 RETURNING token').bind(id,lease).first<{token:string}>();
      if(claimed?.token!==lease){await trace.checkpoint('lease_busy');return preparing(id,protocol);}
    }catch{return json({error:'temporarily_unavailable'},503,15);}
    const info={since:report.since,until:report.until,name:report.person?.name};let zip:Uint8Array;
    try{
      await trace.checkpoint('prepare_started');
      // Rebuild attachments from the allowlisted report, never forward a
      // caller-supplied ZIP/HTML or accept caller-selected email recipients.
      const files=publicReportFiles(report);report=undefined;zip=zipReportFiles(files,6*1024*1024);
      await trace.checkpoint('bundle_ready',{zip_bytes:zip.length});
    }catch(error){
      await env.DB.prepare('DELETE FROM preparation_leases WHERE id=? AND token=?').bind(id,lease).run().catch(()=>{});
      if(error instanceof BundleSizeError){await trace.checkpoint('rejected',{code:'report_bundle_too_large'});return json({error:'report_bundle_too_large',submission_id:id},413);}
      await trace.checkpoint('request_failed',{code:'report_preparation_failed'});
      return json({error:'report_preparation_failed',submission_id:id},503,15);
    }
    try{
      const day=new Date().toISOString().slice(0,10);
      const slot=await env.DB.prepare('INSERT INTO email_daily_budget (day,attempts) VALUES (?,1) ON CONFLICT(day) DO UPDATE SET attempts=attempts+1 WHERE attempts < ? RETURNING attempts').bind(day,dailyLimit).first<{attempts:number}>();
      if(!slot){await env.DB.prepare('DELETE FROM preparation_leases WHERE id=? AND token=?').bind(id,lease).run();await trace.checkpoint('rejected',{code:'daily_email_limit'});return json({error:'daily_email_limit'},429);}
      // The lease token fences off a process that resumes after its preparation
      // lease expired. Only one attempt can transition to an actual email send.
      const inserted=await env.DB.prepare("INSERT OR IGNORE INTO submissions (id,state,created_at,updated_at) SELECT id,'sending',unixepoch(),unixepoch() FROM preparation_leases WHERE id=? AND token=?").bind(id,lease).run();
      if(inserted.meta?.changes!==1){const prior=await env.DB.prepare('SELECT state,updated_at FROM submissions WHERE id=?').bind(id).first<Receipt>();return prior?receiptResponse(prior,id,protocol):preparing(id,protocol);}
    }catch{return json({error:'temporarily_unavailable',submission_id:id},503,15);}
    try{
      const test=parsed.participant.startsWith('test-');
      const person=info.name??parsed.participant;
      await trace.checkpoint('email_started');
      await env.EMAIL.send({to:env.REPORT_TO,from:env.REPORT_FROM,subject:`${test?'TEST — ':''}Agent Hours · ${person} · ${info.since}–${info.until}`,text:`${test?'TEST REPORT — SYNTHETIC DATA ONLY\n\n':''}Agent Hours: ${person}\n${info.since}–${info.until} · Montréal\n\nOpen report.html inside the attached ZIP. JSON and CSV data are included.\nUnverified submission; measurement definitions are in the dashboard.`,attachments:[{filename:`agent-hours-${id.slice(0,12)}.zip`,type:'application/zip',disposition:'attachment',content:base64(zip)}]});
      await env.DB.prepare("UPDATE submissions SET state='sent',updated_at=unixepoch() WHERE id=?").bind(id).run();
      await trace.checkpoint('email_accepted');
      await env.DB.prepare('DELETE FROM preparation_leases WHERE id=? AND token=?').bind(id,lease).run().catch(()=>{});
      return json({status:'accepted',submission_id:id});
    }catch{
      // A send may have succeeded before an acknowledgement failed. Mark it
      // uncertain and do not auto-resend, avoiding duplicate emails.
      await env.DB.prepare("UPDATE submissions SET state='uncertain',updated_at=unixepoch() WHERE id=? AND state='sending'").bind(id).run().catch(()=>{});
      await env.DB.prepare('DELETE FROM preparation_leases WHERE id=? AND token=?').bind(id,lease).run().catch(()=>{});
      await trace.checkpoint('email_uncertain',{code:'delivery_uncertain'});
      return json({error:'delivery_uncertain',submission_id:id},503);
    }
}
export default {async fetch(request:Request,env:Env):Promise<Response>{
  const supplied=request.headers.get('X-Delivery-Request-Id'),id=supplied&&requestIdPattern.test(supplied)?supplied:crypto.randomUUID();let cleaned=false,acceptedForLogging=false;
  const trace=deliveryTrace(env.DELIVERY_LOGS==='true',id,async event=>{
    if(event.stage==='request_received')acceptedForLogging=true;if(!acceptedForLogging)return;
    if(!cleaned){cleaned=true;await env.DB.prepare('DELETE FROM delivery_events WHERE created_at < unixepoch()-604800').run().catch(()=>{});}
    await env.DB.prepare('INSERT INTO delivery_events (request_id,receipt,stage,elapsed_ms,input_bytes,zip_bytes,http_status,code) VALUES (?,?,?,?,?,?,?,?)').bind(event.request_id,event.receipt??null,event.stage,event.elapsed_ms,event.input_bytes??null,event.zip_bytes??null,event.http_status??null,event.code??null).run();
  });
  let response:Response;try{response=await handle(request,env,trace);}catch{await trace.checkpoint('request_failed',{code:'worker_unhandled_error'});response=json({error:'temporarily_unavailable'},503,15);}
  response.headers.set('X-Delivery-Request-Id',id);await trace.checkpoint('request_finished',{http_status:response.status});return response;
}};
