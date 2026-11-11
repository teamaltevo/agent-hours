import { expect,test } from 'bun:test';
import { allClientActivity,ALL_CLIENTS_SCRIPT } from '../src/all-clients.ts';
import { sampleReport } from './fixtures.ts';
import { dailyCSV,publicReport } from '../src/public-report.ts';

function fiveAgents(){const r=sampleReport();r.days[0].developer_hours=1;r.days[0].returned_punch_hours=1;r.clients.opencode!.observed_inferred_work_hours=3;r.days[0].captured_work_hours_by_client.opencode=3;r.days[0].observed_inferred_work_hours.opencode=3;r.clients.claude={...r.clients.opencode!,observed_inferred_work_hours:2,metric:'bounded_message_gap_estimate_ms'};r.days[0].captured_work_hours_by_client.claude=2;r.days[0].observed_inferred_work_hours.claude=2;r.days[0].history_observed_by_client.claude=true;return r;}
test('five captured agent-hours for one developer hour is 5x, not an elapsed union',()=>{
  const total=allClientActivity(fiveAgents());expect(total.captured_hours).toBe(5);expect(total.paired_work_hours).toBe(1);expect(total.ratio).toBe(5);expect(total.rows[0].ratio).toBe(5);
});
test('all-client totals preserve native measurements rather than switching estimators',()=>{
  const r=fiveAgents();r.clients.opencode!.details!.activity.bounded_message_gap_hours=.1;expect(allClientActivity(r).captured_hours).toBe(5);
});
test('zero-work dates keep agent-hours in the aggregate but have no daily ratio',()=>{
  const r=fiveAgents(),d=r.days[1];d.developer_hours=0;d.returned_punch_hours=0;d.history_observed_by_client.opencode=true;d.captured_work_hours_by_client.opencode=1;
  const total=allClientActivity(r);expect(total.captured_hours).toBe(6);expect(total.ratio).toBe(6);expect(total.rows[1].ratio).toBeNull();expect(total.paired_work_hours).toBe(1);
});
test('work hours on dates with no available agent history are not invented as matched time',()=>{
  const r=fiveAgents();r.days[1].developer_hours=8;expect(allClientActivity(r).paired_work_hours).toBe(1);
});
test('the offline browser uses the same aggregation implementation',()=>{
  const browser=new Function(ALL_CLIENTS_SCRIPT+'return allClientActivity;')();expect(browser(fiveAgents())).toEqual(allClientActivity(fiveAgents()));
});
test('summed CSV rows count the developer denominator once',()=>{
  const csv=dailyCSV(fiveAgents()).trim().split('\n').map(line=>line.split(',')),header=csv[0],row=csv.find(row=>row[header.indexOf('client')]==='all')!;
  expect(row[header.indexOf('captured_work_hours')]).toBe('5');expect(row[header.indexOf('developer_hours')]).toBe('1');expect(row[header.indexOf('ratio')]).toBe('5');
});
test('JSON summed summary is rebuilt from native values, independently of elapsed estimates',()=>{
  const report=publicReport(fiveAgents());expect(report.all_clients?.metric).toBe('summed_native_client_activity_ms');expect(report.all_clients?.captured_activity_hours).toBe(5);expect(report.all_clients?.developer_hours).toBe(1);expect(report.all_clients?.ratio).toBe(5);
});
