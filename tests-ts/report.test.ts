import { afterEach,beforeEach,expect,test } from 'bun:test';
import { mkdtemp,rm,readFile,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addRecord,newSession } from '../src/sources.ts';
import { ReportBuilder, dailyCSV } from '../src/report.ts';
import { Classifier } from '../src/classifier.ts';
import { hash } from '../src/core.ts';
import type { Candidate,Session } from '../src/types.ts';

let root:string;beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'agent-hours-report-test-'));});afterEach(async()=>{await rm(root,{recursive:true,force:true});});
function candidate(id:string,date='2026-06-01',client:'opencode'|'claude'|'codex'='opencode'):Candidate {
  const metadata=newSession(client,id,'/PRIVATE_DIRECTORY');metadata.sources=['/PRIVATE_SOURCE'];
  const start=Date.parse(date+'T12:00:00Z');
  addRecord(metadata,'m1',{role:'assistant',start,end:start+3600000,text:'',cwd:null,fingerprint:hash(id)});
  if(client!=='opencode')addRecord(metadata,'m2',{role:'user',start:start+120000,end:null,text:'',cwd:null,fingerprint:hash(id+'2')});
  return {client,identity:id,directory:metadata.directory,sources:metadata.sources,size:1,history:[date],metadata,load:async()=>{throw new Error('WORK_ONLY_MUST_NOT_LOAD_CONTENT');}};
}
function builder(candidates:Candidate[],confirmed=true,hours=new Map([['2026-06-01',2],['2026-06-02',8]])) {
  return new ReportBuilder({since:'2026-06-01',until:'2026-06-03',statuses:{opencode:{coverage:'unverified',source_issue_count:0,available_source_count:1}},candidates,hours,confirmed,workOnly:true,workers:2,batchSize:5,directory:root,signal:new AbortController().signal,onProgress:()=>{}});
}
test('work-only run never loads conversations; report is aggregate-only',async()=>{
  const b=builder([candidate('PRIVATE_SESSION_ID')]);const report=await b.run();expect(report.classification_counts.work).toBe(1);expect(report.clients.opencode?.observed_inferred_work_hours).toBe(1);
  const text=await readFile(b.path,'utf8');for(const privateValue of ['PRIVATE_DIRECTORY','PRIVATE_SOURCE','PRIVATE_SESSION_ID','WORK_ONLY_MUST_NOT_LOAD_CONTENT'])expect(text).not.toContain(privateValue);
  expect((await stat(b.path)).mode&0o777).toBe(0o600);expect((await stat(b.indexPath)).mode&0o777).toBe(0o600);expect(await readFile(b.indexPath,'utf8')).toContain('PRIVATE_SESSION_ID');
});
test('ratios use only history dates, not all TimeSentry hours',async()=>{
  const report=await builder([candidate('a')]).run();expect(report.observed_day_aggregates.opencode?.ratio).toBe(.5);expect(report.observed_day_aggregates.opencode?.developer_hours).toBe(2);expect(report.days[1].ratios_by_client.opencode).toBeNull();
});
test('sum concurrent sessions; do not merge across session identities',async()=>{
  const report=await builder([candidate('a'),candidate('b'),candidate('c')],true,new Map([['2026-06-01',1]])).run();expect(report.observed_day_aggregates.opencode?.ratio).toBe(3);expect(report.clients.opencode?.observed_inferred_work_hours).toBe(3);
});
test('zero denominator is missing ratio, not infinity',async()=>{
  const report=await builder([candidate('a')],true,new Map()).run();expect(report.days[0].developer_hours).toBe(0);expect(report.days[0].ratios_by_client.opencode).toBeNull();expect(report.days[0].ratio_status_by_client.opencode).toBe('zero_developer_hours');
});
test('legacy confirmation flags do not suppress successfully returned hours',async()=>{
  const report=await builder([candidate('a')],false).run();expect(report.timesentry_coverage).toBe('complete');expect(report.days[0].developer_hours).toBe(2);expect(report.observed_day_aggregates.opencode?.ratio).toBe(.5);
});
test('aggregate is ratio of sums, not mean daily ratios',async()=>{
  const report=await builder([candidate('a'),candidate('b','2026-06-02')]).run();expect(report.observed_day_aggregates.opencode?.ratio).toBe(.2);expect(report.observed_day_aggregates.opencode?.paired_days).toBe(2);
});
test('conflicting evidence remains unknown even when declared work-only',async()=>{
  const c=candidate('a');c.metadata.conflict=true;c.metadata.reasons.add('conflicting_messages');const report=await builder([c]).run();expect(report.classification_counts.unknown).toBe(1);expect(report.classification_counts.work).toBe(0);expect(report.days[0].captured_work_hours_by_client.opencode).toBe(0);
});
test('CSV contains only observed history with fixed client fields',async()=>{
  const report=await builder([candidate('a')]).run();const csv=dailyCSV(report);expect(csv.split('\n').filter(Boolean).length).toBe(2);expect(csv).not.toContain('PRIVATE');expect(csv).toContain('recorded_assistant_response_span_ms');
});
test('new runs never overwrite previous outputs',async()=>{
  const a=builder([candidate('a')]),b=builder([candidate('b')]);await a.run();const original=await readFile(a.path,'utf8');await b.run();expect(a.path).not.toBe(b.path);expect(await readFile(a.path,'utf8')).toBe(original);
});
test('clients keep distinct timing metrics and no combined ratio',async()=>{
  const b=builder([candidate('a'),candidate('b','2026-06-01','claude')]);
  b.report.clients.claude={...b.report.clients.opencode!,metric:'bounded_message_gap_estimate_ms',classification_counts:{work:0,personal:0,mixed:0,unknown:0},observed_inferred_work_hours:null};
  const report=await b.run();expect(report.clients.claude?.observed_inferred_work_hours).toBeCloseTo(120000/3600000);expect(report.default_aggregate.ratio).toBeNull();
});
test('rolling workers refill before slow requests finish',async()=>{
  const events:string[]=[];let release!:()=>void;const wait=new Promise<void>(r=>release=r);
  const candidates=[candidate('slow'),candidate('fast'),candidate('next')].map(c=>({...c,load:async()=>{
    const s=newSession('opencode',c.identity);addRecord(s,'m1',{role:'user',start:Date.parse('2026-06-01T12:00:00Z'),end:null,text:c.identity,cwd:null,fingerprint:hash(c.identity)});return s;
  }}));
  const c=new Classifier({projects:[{key:'p0',title:'Synthetic project',client:'Synthetic',seen_in_own_punches:true,jira_references:[]}],model:{id:'test',providerID:'synthetic'},cache:join(root,'cache'),maxCalls:10,requestMs:1000,sessionMs:1000,keywords:false,signal:new AbortController().signal,transport:{models:async()=>({defaultModel:{id:'test',providerID:'synthetic'},models:[]}),generate:async prompt=>{
    const id=prompt.includes('"text":"user: slow"')?'slow':prompt.includes('"text":"user: fast"')?'fast':'next';events.push(id);if(id==='slow'){await wait;events.push('slow-finished');}if(id==='next')release();return JSON.stringify({label:'personal',project:null,confidence:1,reason:'personal_context'});
  }}});
  const b=new ReportBuilder({...builder([]).options,candidates,workOnly:false,classifier:c,batchSize:1});await b.run();expect(events).toContain('fast');expect(events.indexOf('next')).toBeLessThan(events.indexOf('slow-finished'));expect(b.report.classification_counts.personal).toBe(3);
});
test('interruption saves a marked partial checkpoint',async()=>{
  const controller=new AbortController();controller.abort();const b=new ReportBuilder({...builder([candidate('a')]).options,signal:controller.signal});await expect(b.run()).rejects.toThrow();const saved=JSON.parse(await readFile(b.path,'utf8'));expect(saved.run_status).toBe('interrupted');expect(saved.pending_sessions).toBe(1);expect(saved.classification_counts.work).toBe(0);
});
