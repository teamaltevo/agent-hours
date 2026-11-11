import { publicReport } from '../../src/public-report.ts';
import { reportBundle } from '../../src/bundle.ts';
import { PUBLIC_SUBMISSION_PHRASE } from '../../src/submission-config.ts';

interface Statement {bind(...values:unknown[]):Statement;run():Promise<{meta?:{changes?:number}}> ;first<T>():Promise<T|null>}
export interface EmailPayload {to:string;from:string;subject:string;text:string;attachments:{content:string;filename:string;type:string;disposition:'attachment'}[]}
export interface Env {
  REPORT_FROM:string;REPORT_TO:string;MAX_DAILY_EMAILS?:string;
  DB:{prepare(sql:string):Statement};
  SUBMISSION_LIMIT:{limit(options:{key:string}):Promise<{success:boolean}>};
  EMAIL:{send(message:EmailPayload):Promise<unknown>};
}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const hex=(bytes:ArrayBuffer)=>[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
async function digest(text:string):Promise<ArrayBuffer>{return crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));}
async function body(request:Request):Promise<string>{
  const max=8*1024*1024;if(Number(request.headers.get('content-length'))>max)throw new Error('too_large');const reader=request.body?.getReader();if(!reader)throw new Error('invalid_body');let total=0;const chunks:Uint8Array[]=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>max){await reader.cancel();throw new Error('too_large');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
function base64(bytes:Uint8Array):string {let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);}
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const path=new URL(request.url).pathname;if(path==='/health'&&request.method==='GET')return json({status:'ok'});
    if(path!=='/reports'||request.method!=='POST')return json({error:'not_found'},404);
    const dailyLimit=Number(env.MAX_DAILY_EMAILS??50);
    if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>1000||![env.REPORT_FROM,env.REPORT_TO].every(v=>typeof v==='string'&&/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(v)))return json({error:'delivery_not_configured'},503);
    if(request.headers.get('X-Report-Phrase')!==PUBLIC_SUBMISSION_PHRASE)return json({error:'phrase_required'},401);
    // The phrase is public, not authentication. All submitters share this
    // approximate short-window limiter; a D1 quota also caps daily send attempts.
    try{if(!(await env.SUBMISSION_LIMIT.limit({key:'public-report-submissions'})).success)return json({error:'rate_limited'},429);}catch{return json({error:'temporarily_unavailable'},503);}
    if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return json({error:'invalid_content_type'},415);
    let parsed:any,report:ReturnType<typeof publicReport>;
    try{parsed=JSON.parse(await body(request));if(!parsed||Object.keys(parsed).sort().join(',')!=='participant,report,version'||parsed.version!==1||typeof parsed.participant!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(parsed.participant))throw new Error('invalid');report=publicReport(parsed.report);if(report.run_status!=='completed'||report.pending_sessions!==0)throw new Error('incomplete');}
    catch{return json({error:'invalid_or_oversized_report'},400);}
    const id=hex(await digest(JSON.stringify({participant:parsed.participant,report})));
    try{
      // D1 stores only hashes, state and timestamps, never reports or identities.
      const prior=await env.DB.prepare('SELECT state FROM submissions WHERE id=?').bind(id).first<{state:string}>();
      if(prior)return prior.state==='sent'?json({status:'accepted',submission_id:id}):json({error:'submission_pending_or_uncertain',submission_id:id},409);
      const day=new Date().toISOString().slice(0,10);
      const slot=await env.DB.prepare('INSERT INTO email_daily_budget (day,attempts) VALUES (?,1) ON CONFLICT(day) DO UPDATE SET attempts=attempts+1 WHERE attempts < ? RETURNING attempts').bind(day,dailyLimit).first<{attempts:number}>();
      if(!slot)return json({error:'daily_email_limit'},429);
      const inserted=await env.DB.prepare("INSERT OR IGNORE INTO submissions (id,state,created_at,updated_at) VALUES (?,'sending',unixepoch(),unixepoch())").bind(id).run();
      if(inserted.meta?.changes!==1){const prior=await env.DB.prepare('SELECT state FROM submissions WHERE id=?').bind(id).first<{state:string}>();return prior?.state==='sent'?json({status:'accepted',submission_id:id}):json({error:'submission_pending_or_uncertain',submission_id:id},409);}
    }catch{return json({error:'temporarily_unavailable'},503);}
    try{
      // Rebuild attachments from the allowlisted report, never forward a
      // caller-supplied ZIP/HTML or accept caller-selected email recipients.
      const bundle=reportBundle(report);if(bundle.zip.length>6*1024*1024)throw new Error('too_large');
      const test=parsed.participant.startsWith('test-');
      await env.EMAIL.send({to:env.REPORT_TO,from:env.REPORT_FROM,subject:`${test?'TEST — ':''}Agent Hours · ${parsed.participant} · ${report.since}–${report.until}`,text:`${test?'TEST REPORT: SYNTHETIC DATA ONLY. Not actual work or agent usage.\n\n':''}An aggregate Agent Hours report is attached for participant code ${parsed.participant}.\n\nPeriod: ${report.since}–${report.until} (Montréal).\nOpen report.html inside the ZIP for the offline dashboard; report.json and daily.csv contain its data.\n\nEstimates are not productivity, billing or guaranteed bounds. Clients and timing sources remain separate. No conversations, command text, source paths, session IDs or credentials are attached.`,attachments:[{filename:`agent-hours-${id.slice(0,12)}.zip`,type:'application/zip',disposition:'attachment',content:base64(bundle.zip)}]});
      await env.DB.prepare("UPDATE submissions SET state='sent',updated_at=unixepoch() WHERE id=?").bind(id).run();
      return json({status:'accepted',submission_id:id});
    }catch{
      // A send may have succeeded before an acknowledgement failed. Mark it
      // uncertain and do not auto-resend, avoiding duplicate emails.
      await env.DB.prepare("UPDATE submissions SET state='uncertain',updated_at=unixepoch() WHERE id=?").bind(id).run().catch(()=>{});
      return json({error:'delivery_uncertain',submission_id:id},503);
    }
  }
};
