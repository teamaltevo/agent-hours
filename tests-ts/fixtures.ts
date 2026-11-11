import { ReportBuilder } from '../src/report.ts';
import { newSession,addRecord } from '../src/sources.ts';
import { meta,claudeTelemetry } from '../src/telemetry.ts';
import { hash } from '../src/core.ts';
import type { Report,Candidate } from '../src/types.ts';

export function sampleReport():Report {
  const s=newSession('opencode','PRIVATE_SESSION','/PRIVATE_DIRECTORY');const start=Date.parse('2026-06-01T12:00:00Z');
  addRecord(s,'message',{role:'assistant',start,end:start+3600000,text:'PRIVATE_CONVERSATION',cwd:'/PRIVATE_DIRECTORY',fingerprint:hash('evidence')});s.sources=['/PRIVATE_SOURCE'];s.method='model';
  meta(s).tools.set('PRIVATE_TOOL_ID',{id:'PRIVATE_TOOL_ID',category:'shell',command_family:'version_control',start,end:start+5000,duration_ms:5000,timing:'recorded_interval',status:'success'});
  const candidate:Candidate={client:'opencode',identity:s.identity,directory:s.directory,sources:s.sources,size:1,history:['2026-06-01'],metadata:s,load:async()=>s};
  const b=new ReportBuilder({since:'2026-06-01',until:'2026-06-02',statuses:{opencode:{coverage:'unverified',source_issue_count:0,available_source_count:1}},candidates:[candidate],hours:new Map([['2026-06-01',2]]),confirmed:true,workOnly:false,workers:1,batchSize:1,directory:'/unused-synthetic-output',signal:new AbortController().signal,onProgress:()=>{}});
  b.add(candidate,s,'work');b.report.run_status='completed';b.ratios();return b.report;
}
