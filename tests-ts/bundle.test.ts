import { expect,test } from 'bun:test';
import { unzipSync,strFromU8 } from 'fflate';
import { publicReport } from '../src/public-report.ts';
import { reportBundle } from '../src/bundle.ts';
import { sampleReport } from './fixtures.ts';

test('report bundle includes only aggregate JSON, offline HTML, CSV and instructions',()=>{
  const result=reportBundle(sampleReport()),files=unzipSync(result.zip);expect(Object.keys(files).sort()).toEqual(['README.txt','daily.csv','project-daily.csv','report.html','report.json']);
  for(const bytes of Object.values(files)){const text=strFromU8(bytes);for(const privateValue of ['PRIVATE_SESSION','PRIVATE_DIRECTORY','PRIVATE_CONVERSATION','PRIVATE_SOURCE','PRIVATE_TOOL_ID'])expect(text).not.toContain(privateValue);}
  expect(result.html).toContain('connect-src');expect(result.html).toContain('period_summaries');expect(result.csv).toContain('tool_recorded_ms');expect(result.json).not.toContain('profiling');
});
test('unknown fields cannot be smuggled into shareable reports',()=>{
  const report=sampleReport() as any;report.conversation_text='SECRET';expect(()=>publicReport(report)).toThrow();
});
test('tool categories cannot carry arbitrary names or raw commands',()=>{
  const report=sampleReport();(report.clients.opencode!.details!.tools.by_category as any).customer_secret={};expect(()=>publicReport(report)).toThrow();
});
test('arbitrary explanation fields are replaced rather than forwarded',()=>{
  const report=sampleReport();report.daily_ratio_interpretation='SECRET_TEXT';report.telemetry_interpretation='SECRET_TEXT';expect(JSON.stringify(publicReport(report))).not.toContain('SECRET_TEXT');
});
test('daily details include overlap, tool distributions, attribution and null unavailable cost',()=>{
  const report=publicReport(sampleReport()),d=report.days[0].details_by_client!.opencode!;expect(d.tools.recorded_duration.total_ms).toBe(5000);expect(d.activity.elapsed_union_hours).toBe(1);expect(d.usage.reported_estimated_cost_usd).toBeNull();expect(d.attribution.model).toBe(1);expect(report.period_summaries?.week[0].details.tools.recorded_duration.total_ms).toBe(5000);
});
test('weekly and monthly ratios remain ratio-of-sums on paired dates',()=>{
  const report=sampleReport();expect(report.period_summaries?.week[0].ratio).toBe(.5);expect(report.period_summaries?.month[0].ratio).toBe(.5);
});
