import { expect,test } from 'bun:test';
import { applyTimeSentryHours } from '../src/ratio-policy.ts';
import { sampleReport } from './fixtures.ts';
import { newSession,addRecord } from '../src/sources.ts';
import { ReportBuilder } from '../src/report.ts';
import { publicReport } from '../src/public-report.ts';
import { dashboardHTML } from '../src/dashboard.ts';
import { DASHBOARD_SCRIPT } from '../src/dashboard-script.ts';
import type { Candidate,Client } from '../src/types.ts';

test('saved reports rebuild daily and period ratios without confirmation or reclassification',()=>{
  const r=sampleReport(),counts=JSON.stringify(r.classification_counts);r.timesentry_coverage='unknown';r.daily_ratio_policy.timesentry_complete_confirmed=false;r.days[0].developer_hours=null;r.days[0].ratio=null;
  const rebuilt=applyTimeSentryHours(r);expect(rebuilt.days[0].ratio).toBe(.5);expect(rebuilt.observed_day_aggregates.opencode?.ratio).toBe(.5);expect(rebuilt.period_summaries?.week[0].ratio).toBe(.5);expect(rebuilt.period_summaries?.month[0].ratio).toBe(.5);expect(JSON.stringify(rebuilt.classification_counts)).toBe(counts);expect(rebuilt.timesentry_coverage).toBe('complete');expect(()=>publicReport(rebuilt)).not.toThrow();
});
test('old unknown scope metadata is automatically upgraded on a successful read',()=>{
  const r=sampleReport();r.timesentry_coverage='unknown';r.days[0].developer_hours=null;r.days[0].ratios_by_client.opencode=null;const rebuilt=publicReport(r);expect(rebuilt.timesentry_coverage).toBe('complete');expect(rebuilt.days[0].ratios_by_client.opencode).toBe(.5);
});
test('failed retrieval cannot be upgraded into complete hours',()=>{
  const r=sampleReport();(r.timesentry_retrieval as any).status='failed';expect(()=>publicReport(r)).toThrow();expect(()=>applyTimeSentryHours(r)).toThrow('timesentry_read_not_completed');
});
function combinedReport(){
  const start=Date.parse('2026-06-01T12:00:00Z');
  const make=(client:Client,offset:number):Candidate=>{const s=newSession(client,'same-private-id');s.method='model';for(const [id,role,at]of [['u','user',start+offset],['a','assistant',start+offset+120000]] as const)addRecord(s,id,{role,start:at,end:role==='assistant'?at+120000:null,text:'PRIVATE_TEXT',cwd:null,fingerprint:id});return {client,identity:s.identity,directory:null,sources:[],size:2,history:['2026-06-01'],metadata:s,load:async()=>s};};
  const a=make('opencode',0),b=make('codex',60000),personal=make('claude',0),candidates=[a,b,personal];
  const status={coverage:'unverified' as const,source_issue_count:0,available_source_count:1};
  const builder=new ReportBuilder({since:'2026-06-01',until:'2026-06-02',statuses:{opencode:status,codex:status,claude:status},candidates,hours:new Map([['2026-06-01',1]]),confirmed:true,workOnly:false,workers:1,batchSize:1,directory:'/unused-synthetic',signal:new AbortController().signal,onProgress:()=>{}});
  builder.add(a,a.metadata,'work');builder.add(b,b.metadata,'work');builder.add(personal,personal.metadata,'personal');builder.report.run_status='completed';builder.ratios();return builder.report;
}
test('combined estimate unions comparable gaps across clients and counts work once',()=>{
  const report=combinedReport(),c=report.combined!;expect(c.details.activity.summed_hours).toBeCloseTo(4/60);expect(c.details.activity.elapsed_union_hours).toBeCloseTo(3/60);expect(c.details.activity.peak_concurrency).toBe(2);expect(c.aggregate.developer_hours).toBe(1);expect(c.aggregate.ratio).toBeCloseTo(3/60);expect(c.details.sessions.work).toBe(2);expect(c.details.sessions.personal).toBe(1);expect(c.details.activity.recorded_span_hours).toBeNull();expect(c.details.usage.input_tokens).toBeNull();expect(report.default_aggregate.ratio).toBeNull();expect(JSON.stringify(publicReport(report))).not.toContain('PRIVATE_TEXT');
});
test('combined day and period ratios can also be rebuilt from aggregates',()=>{
  const report=combinedReport();report.days[0].combined!.ratio=null;applyTimeSentryHours(report);expect(report.days[0].combined?.ratio).toBeCloseTo(3/60);expect(report.combined?.period_summaries.month[0].ratio).toBeCloseTo(3/60);
});
test('legacy reports do not get a fabricated cross-client overlap estimate',()=>{
  const r=sampleReport();delete r.combined;for(const d of r.days)delete d.combined;const report=publicReport(r);expect(report.combined).toBeUndefined();expect(dashboardHTML(report)).toContain('All clients');
});
test('dashboard uses concise headings and collapses technical interpretation',()=>{
  const html=dashboardHTML(sampleReport());expect(html).toContain('<summary>About these numbers</summary>');expect(html).not.toContain('with the gaps visible');expect(html).not.toContain('Coverage matters as much as');expect(html).not.toContain('Reproducible, offline report');expect(()=>new Function(DASHBOARD_SCRIPT)).not.toThrow();
});
