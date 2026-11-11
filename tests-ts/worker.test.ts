import { expect,test } from 'bun:test';
import worker,{type Env,type EmailPayload} from '../worker/src/index.ts';
import { sampleReport } from './fixtures.ts';
import { unzipSync,strFromU8 } from 'fflate';

const token='synthetic-test-upload-token-0000000000000';
function env(){
  const rows=new Map<string,string>();const sent:EmailPayload[]=[];let failSend=false;
  const value:Env={UPLOAD_TOKEN:token,REPORT_FROM:'reports@example.com',REPORT_TO:'recipient@example.com',SUBMISSION_LIMIT:{limit:async()=>({success:true})},EMAIL:{send:async message=>{if(failSend)throw new Error('PROVIDER_SECRET');sent.push(message);return {}; }},DB:{prepare(sql:string){let args:unknown[]=[];return {bind(...values:unknown[]){args=values;return this;},async run(){const id=String(args[0]);if(sql.startsWith('INSERT')){const exists=rows.has(id);if(!exists)rows.set(id,'sending');return {meta:{changes:exists?0:1}};}if(sql.includes("state='sent'"))rows.set(id,'sent');if(sql.includes("state='uncertain'"))rows.set(id,'uncertain');return {meta:{changes:1}};},async first<T>(){return rows.has(String(args[0]))?{state:rows.get(String(args[0]))} as T:null;}};}}};
  return {value,rows,sent,fail:()=>{failSend=true;}};
}
function request(body:unknown={version:1,participant:'participant-1',report:sampleReport()},auth=token){return new Request('https://worker.example/reports',{method:'POST',headers:{authorization:'Bearer '+auth,'Content-Type':'application/json'},body:JSON.stringify(body)});}
test('Worker authenticates before parsing reports and never acts as an open email relay',async()=>{
  const e=env();const r=await worker.fetch(request(undefined,'wrong'),e.value);expect(r.status).toBe(401);expect(e.sent.length).toBe(0);expect(e.rows.size).toBe(0);
});
test('Worker emails a rebuilt sanitized attachment to its fixed configured recipient',async()=>{
  const e=env();const r=await worker.fetch(request(),e.value);expect(r.status).toBe(200);expect(e.sent.length).toBe(1);expect(e.sent[0].to).toBe('recipient@example.com');
  const zip=Uint8Array.from(atob(e.sent[0].attachments[0].content),c=>c.charCodeAt(0));const files=unzipSync(zip);expect(Object.keys(files).sort()).toEqual(['README.txt','daily.csv','report.html','report.json']);expect(strFromU8(files['report.json'])).not.toContain('PRIVATE_');
});
test('repeated identical submissions do not send duplicate emails',async()=>{
  const e=env();expect((await worker.fetch(request(),e.value)).status).toBe(200);expect((await worker.fetch(request(),e.value)).status).toBe(200);expect(e.sent.length).toBe(1);expect(e.rows.size).toBe(1);
});
test('raw/private fields and caller-selected recipients are rejected',async()=>{
  const e=env();const report=sampleReport() as any;report.raw_commands=['SECRET'];expect((await worker.fetch(request({version:1,participant:'one',report}),e.value)).status).toBe(400);expect((await worker.fetch(request({version:1,participant:'one',report:sampleReport(),to:'attacker@example.com'}),e.value)).status).toBe(400);expect(e.sent.length).toBe(0);
});
test('incomplete reports are never automatically emailed',async()=>{
  const e=env(),report=sampleReport();report.run_status='interrupted';expect((await worker.fetch(request({version:1,participant:'one',report}),e.value)).status).toBe(400);expect(e.sent.length).toBe(0);
});
test('ambiguous email failures are not automatically retried and do not leak provider text',async()=>{
  const e=env();e.fail();const r=await worker.fetch(request(),e.value);expect(r.status).toBe(503);expect(await r.text()).not.toContain('PROVIDER_SECRET');expect((await worker.fetch(request(),e.value)).status).toBe(409);expect([...e.rows.values()]).toEqual(['uncertain']);
});
test('rate-limited submissions do not email or allocate database rows',async()=>{
  const e=env();e.value.SUBMISSION_LIMIT.limit=async()=>({success:false});expect((await worker.fetch(request(),e.value)).status).toBe(429);expect(e.rows.size).toBe(0);
});
test('D1 stores hashes and delivery state, not report content or participant identity',async()=>{
  const e=env();await worker.fetch(request(),e.value);expect([...e.rows.keys()].every(k=>/^[a-f0-9]{64}$/.test(k))).toBe(true);expect(JSON.stringify([...e.rows])).not.toContain('participant-1');
});
