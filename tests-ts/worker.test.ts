import { expect,test,afterEach,spyOn } from 'bun:test';
import worker,{type Env,type EmailPayload} from '../worker/src/index.ts';
import { sampleReport } from './fixtures.ts';
import { unzipSync,strFromU8 } from 'fflate';
import { PUBLIC_SUBMISSION_PHRASE } from '../src/submission-config.ts';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { publicReport } from '../src/public-report.ts';
import { createHash } from 'node:crypto';

const migrations=['0001_submissions.sql','0002_email_daily_budget.sql','0003_preparation_leases.sql','0004_delivery_events.sql'].map(file=>readFileSync('worker/migrations/'+file,'utf8'));
const databases=new Set<Database>();afterEach(()=>{for(const db of databases)db.close();databases.clear();});

function env(){
  const db=new Database(':memory:');databases.add(db);for(const sql of migrations)db.exec(sql);
  const sent:EmailPayload[]=[];let failSend=false;
  const value:Env={REPORT_FROM:'reports@example.com',REPORT_TO:'recipient@example.com',SUBMISSION_LIMIT:{limit:async()=>({success:true})},EMAIL:{send:async message=>{if(failSend)throw new Error('PROVIDER_SECRET');sent.push(message);return {}; }},DB:{prepare(sql:string){let args:any[]=[];return {bind(...values:unknown[]){args=values;return this;},async run(){const result=db.query(sql).run(...args);return {meta:{changes:result.changes}};},async first<T>(){return db.query(sql).get(...args) as T|null;}};}}};
  return {value,db,get rows(){return new Map((db.query('SELECT id,state FROM submissions').all() as {id:string;state:string}[]).map(r=>[r.id,r.state]));},get budget(){return new Map((db.query('SELECT day,attempts FROM email_daily_budget').all() as {day:string;attempts:number}[]).map(r=>[r.day,r.attempts]));},sent,fail:()=>{failSend=true;}};
}
function request(body:unknown={version:1,participant:'participant-1',report:sampleReport()},phrase=PUBLIC_SUBMISSION_PHRASE){return new Request('https://worker.example/reports',{method:'POST',headers:{'X-Report-Phrase':phrase,'X-Report-Protocol':'2','Content-Type':'application/json'},body:JSON.stringify(body)});}
const defaultId=()=>createHash('sha256').update(JSON.stringify({participant:'participant-1',report:publicReport(sampleReport())})).digest('hex');
test('Worker requires the public phrase before parsing and cannot relay to arbitrary recipients',async()=>{
  const e=env();const r=await worker.fetch(request(undefined,'wrong'),e.value);expect(r.status).toBe(401);expect(e.sent.length).toBe(0);expect(e.rows.size).toBe(0);
});
test('Worker emails a rebuilt sanitized attachment to its fixed configured recipient',async()=>{
  const e=env();const r=await worker.fetch(request(),e.value);expect(r.status).toBe(200);expect(e.sent.length).toBe(1);expect(e.sent[0].to).toBe('recipient@example.com');
  const zip=Uint8Array.from(atob(e.sent[0].attachments[0].content),c=>c.charCodeAt(0));const files=unzipSync(zip);expect(Object.keys(files).sort()).toEqual(['README.txt','daily.csv','report.html','report.json']);expect(strFromU8(files['report.json'])).not.toContain('PRIVATE_');
});
test('repeated identical submissions do not send duplicate emails',async()=>{
  const e=env();expect((await worker.fetch(request(),e.value)).status).toBe(200);expect((await worker.fetch(request(),e.value)).status).toBe(200);expect(e.sent.length).toBe(1);expect(e.rows.size).toBe(1);expect([...e.budget.values()]).toEqual([1]);
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
test('global daily email cap blocks additional distinct submissions',async()=>{
  const e=env();e.value.MAX_DAILY_EMAILS='1';expect((await worker.fetch(request(),e.value)).status).toBe(200);
  const second=await worker.fetch(request({version:1,participant:'participant-2',report:sampleReport()}),e.value);expect(second.status).toBe(429);expect((await second.json() as any).error).toBe('daily_email_limit');expect(e.sent.length).toBe(1);expect(e.rows.size).toBe(1);
});
test('concurrent distinct submissions cannot exceed reserved daily email slots',async()=>{
  const e=env();e.value.MAX_DAILY_EMAILS='3';
  const results=await Promise.all(Array.from({length:12},(_,i)=>worker.fetch(request({version:1,participant:'concurrent-'+i,report:sampleReport()}),e.value)));
  expect(results.filter(r=>r.status===200).length).toBe(3);expect(results.filter(r=>r.status===429).length).toBe(9);expect(e.sent.length).toBe(3);expect([...e.budget.values()]).toEqual([3]);
});
test('quota and receipt SQL execute against real SQLite with both migrations',async()=>{
  const db=new Database(':memory:');try{
    for(const sql of migrations)db.exec(sql);
    const e=env();e.value.MAX_DAILY_EMAILS='1';
    e.value.DB={prepare(sql:string){let args:any[]=[];return {bind(...values:unknown[]){args=values;return this;},async run(){const result=db.query(sql).run(...args);return {meta:{changes:result.changes}};},async first<T>(){return db.query(sql).get(...args) as T|null;}};}};
    expect((await worker.fetch(request(),e.value)).status).toBe(200);
    expect((await worker.fetch(request(),e.value)).status).toBe(200);
    expect((await worker.fetch(request({version:1,participant:'another',report:sampleReport()}),e.value)).status).toBe(429);
    expect(e.sent.length).toBe(1);expect(db.query('SELECT attempts FROM email_daily_budget').get()).toEqual({attempts:1});
  }finally{db.close();}
});
test('an expired preparation lease can recover without creating duplicate sends',async()=>{
  const e=env(),id=defaultId();e.db.query('INSERT INTO preparation_leases VALUES (?,?,unixepoch())').run(id,'old-owner');
  const busy=await worker.fetch(request(),e.value);expect(busy.status).toBe(202);expect(e.sent.length).toBe(0);expect(e.budget.size).toBe(0);
  e.db.exec('UPDATE preparation_leases SET updated_at=unixepoch()-91');
  expect((await worker.fetch(request(),e.value)).status).toBe(200);expect(e.sent.length).toBe(1);expect([...e.budget.values()]).toEqual([1]);
});
test('concurrent retries wait for an in-flight email instead of sending again',async()=>{
  const e=env();let started!:()=>void,finish!:()=>void;const sending=new Promise<void>(r=>started=r),gate=new Promise<void>(r=>finish=r);
  e.value.EMAIL.send=async message=>{e.sent.push(message);started();await gate;};
  const first=worker.fetch(request(),e.value);await sending;
  const pending=await worker.fetch(request(),e.value);expect(pending.status).toBe(202);expect((await pending.json() as any).stage).toBe('sending');expect(e.sent.length).toBe(1);
  finish();expect((await first).status).toBe(200);expect((await worker.fetch(request(),e.value)).status).toBe(200);expect(e.sent.length).toBe(1);
});
test('a stale owner cannot send after its preparation lease is replaced',async()=>{
  const e=env(),original=e.value.DB.prepare.bind(e.value.DB);
  e.value.DB.prepare=(sql:string)=>{const statement=original(sql);if(sql.startsWith('INSERT INTO email_daily_budget')){const first=statement.first.bind(statement);statement.first=async<T>()=>{const result=await first<T>();e.db.exec("UPDATE preparation_leases SET token='new-owner'");return result;};}return statement;};
  expect((await worker.fetch(request(),e.value)).status).toBe(202);expect(e.sent.length).toBe(0);expect(e.rows.size).toBe(0);
});
test('old ambiguous sending receipts are never automatically resent',async()=>{
  const e=env();e.db.query("INSERT INTO submissions VALUES (?,'sending',unixepoch()-500,unixepoch()-500)").run(defaultId());
  expect((await worker.fetch(request(),e.value)).status).toBe(409);expect(e.sent.length).toBe(0);
});
test('older clients cannot mistake an in-progress preparation for delivered email',async()=>{
  const e=env();e.db.query('INSERT INTO preparation_leases VALUES (?,?,unixepoch())').run(defaultId(),'active-owner');
  const legacy=request();legacy.headers.delete('X-Report-Protocol');const response=await worker.fetch(legacy,e.value);expect(response.status).toBe(503);expect((await response.json() as any).error).toBe('report_processing');expect(e.sent.length).toBe(0);
});
test('the TimeSentry display name labels the email and embedded dashboard',async()=>{
  const e=env(),report=sampleReport();report.person={name:'Synthetic Person',source:'timesentry_profile'};
  expect((await worker.fetch(request({version:1,participant:'assigned-code',report}),e.value)).status).toBe(200);expect(e.sent[0].subject).toContain('Synthetic Person');const files=unzipSync(Uint8Array.from(atob(e.sent[0].attachments[0].content),c=>c.charCodeAt(0)));expect(strFromU8(files['report.html'])).toContain('<h1>Synthetic Person</h1>');
});
test('enabled execution logs record stages without report contents or identity',async()=>{
  const e=env();e.value.DELIVERY_LOGS='true';const report=sampleReport();report.person={name:'Sensitive Person',source:'timesentry_profile'};
  const lines:string[]=[],spy=spyOn(console,'info').mockImplementation(value=>{lines.push(String(value));});
  try{const response=await worker.fetch(request({version:1,participant:'SENSITIVE_CODE',report}),e.value);expect(response.status).toBe(200);const events=lines.map(line=>JSON.parse(line));expect(events.map(e=>e.stage)).toContain('prepare_started');expect(events.map(e=>e.stage)).toContain('bundle_ready');expect(events.map(e=>e.stage)).toContain('email_accepted');expect(events.map(e=>e.stage)).not.toContain('email_uncertain');expect(events.every(e=>e.request_id===response.headers.get('X-Delivery-Request-Id'))).toBe(true);expect(lines.join('')).not.toContain('Sensitive Person');expect(lines.join('')).not.toContain('SENSITIVE_CODE');expect(lines.join('')).not.toContain('PRIVATE_');expect(lines.join('')).not.toContain('recipient@example.com');const stored=e.db.query('SELECT * FROM delivery_events').all() as any[];expect(stored.map(r=>r.stage)).toContain('prepare_started');expect(stored.map(r=>r.stage)).toContain('email_accepted');expect(JSON.stringify(stored)).not.toContain('Sensitive Person');expect(JSON.stringify(stored)).not.toContain('SENSITIVE_CODE');}finally{spy.mockRestore();}
});
