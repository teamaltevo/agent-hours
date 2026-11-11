import { expect,test } from 'bun:test';
import { ChargebackBuilder } from '../src/chargeback.ts';
import { projectDailyCSV } from '../src/chargeback-export.ts';
import { ProjectAttributor } from '../src/projects.ts';
import { projectWorkDays } from '../src/timesentry.ts';
import { boundaries } from '../src/core.ts';
import { newSession,addRecord } from '../src/sources.ts';
import { meta,nativeUsage } from '../src/telemetry.ts';
import { publicReport } from '../src/public-report.ts';
import { sampleReport } from './fixtures.ts';
import type { Project } from '../src/types.ts';
const projects:Project[]=[{key:'p0000',title:'DistinctiveProduct',client:'Example Customer',seen_in_own_punches:true,jira_references:[]},{key:'p0001',title:'AnotherProduct',client:'Second Customer',seen_in_own_punches:true,jira_references:[]}];
const bounds=boundaries('2026-06-01','2026-06-02'),start=Date.parse('2026-06-01T12:00:00Z');
function session(id='PRIVATE_SESSION',model='gpt-5.3-codex'){
  const s=newSession('opencode',id,'/Users/PRIVATE_USER/DistinctiveProduct');addRecord(s,'PRIVATE_RECORD',{role:'assistant',start,end:start+3600000,text:'PRIVATE_CONVERSATION',cwd:s.directory,fingerprint:'synthetic'});const e=nativeUsage('PRIVATE_USAGE',start,{input:1000,output:500,reasoning:20,cache:{read:500,write:0}},0,'opencode',model)!;meta(s).usage.set(e.id,e);return s;
}
test('per-project native agent-hours count parallel agents additively',()=>{
  const b=new ChargebackBuilder(bounds,projects,[{date:'2026-06-01',project:'p0000',developer_hours:1}]);for(let i=0;i<5;i++)b.add(session(String(i)),['2026-06-01'],true);const v=b.build();expect(v.days.reduce((n,d)=>n+d.agent_hours,0)).toBe(5);expect(v.work_days[0].developer_hours).toBe(1);expect(v.total.priced_samples).toBe(5);expect(v.days.every(d=>d.project==='p0000')).toBe(true);
});
test('timing is not duplicated when one session uses several models',()=>{
  const s=session();const e=nativeUsage('second',start,{input_tokens:100,output_tokens:10},null,'claude','claude-sonnet-4-5')!;meta(s).usage.set(e.id,e);const b=new ChargebackBuilder(bounds,projects);b.add(s,['2026-06-01'],true);expect(b.build().days.reduce((n,d)=>n+d.agent_hours,0)).toBe(1);expect(b.build().total.priced_samples).toBe(2);
});
test('work-only attribution does not use conversation text',()=>{
  const s=session();s.directory='/synthetic';for(const r of s.records.values()){r.cwd=null;r.text='DistinctiveProduct';}const b=new ChargebackBuilder(bounds,projects);b.add(s,['2026-06-01'],true);expect(b.build().days.every(d=>d.project==='unattributed')).toBe(true);
});
test('ambiguous project evidence never bills each project for the same session',()=>{
  const s=session();s.directory='/synthetic';for(const r of s.records.values()){r.cwd=null;r.text='DistinctiveProduct and AnotherProduct';}const b=new ChargebackBuilder(bounds,projects);b.add(s,['2026-06-01'],false);expect(b.build().days.every(d=>d.project==='unattributed')).toBe(true);expect(b.build().days.reduce((n,d)=>n+d.agent_hours,0)).toBe(1);
});
test('only catalogue names and known pricing model keys reach exported aggregates',()=>{
  const b=new ChargebackBuilder(bounds,projects);b.add(session('PRIVATE_SESSION','PRIVATE_MODEL'),['2026-06-01'],true);const r=sampleReport();r.chargeback=b.build();const text=JSON.stringify(publicReport(r));expect(text).not.toContain('PRIVATE_');expect(text).toContain('DistinctiveProduct');expect(r.chargeback.total.unpriced_samples).toBe(1);
});
test('public chargeback validation rejects raw paths and extra fields',()=>{
  const b=new ChargebackBuilder(bounds,projects);b.add(session(),['2026-06-01'],true);const r=sampleReport();r.chargeback=b.build();(r.chargeback.days[0] as any).command='PRIVATE_COMMAND';expect(()=>publicReport(r)).toThrow();delete (r.chargeback.days[0] as any).command;r.chargeback.projects[0].title='/Users/private/repo';expect(()=>publicReport(r)).toThrow();
});
test('project daily CSV counts project developer hours once across models and clients',()=>{
  const b=new ChargebackBuilder(bounds,projects,[{date:'2026-06-01',project:'p0000',developer_hours:1}]);b.add(session('a'),['2026-06-01'],true);b.add(session('b'),['2026-06-01'],true);const lines=projectDailyCSV({chargeback:b.build()}).trim().split('\n');expect(lines.length).toBe(2);const fields=lines[0].split(','),row=lines[1].split(',').map(s=>s.replaceAll('"',''));expect(row[fields.indexOf('agent_hours')]).toBe('2');expect(row[fields.indexOf('developer_hours')]).toBe('1');expect(row[fields.indexOf('ratio')]).toBe('2');
});
test('project punches use opaque catalogue keys, exact hours and duplicate protection',()=>{
  const employee='00000000-0000-4000-8000-000000000000',wrap=(value:unknown)=>({structuredContent:value}),p={id:'PRIVATE_PUNCH',userId:employee,projectId:'PRIVATE_PROJECT',workDate:'2026-06-01',hours:.1},groups=[{name:'Customer',projects:[{id:'PRIVATE_PROJECT',title:'DistinctiveProduct'}]}];
  const value=projectWorkDays(wrap({employeeId:employee}),wrap([p,p,{...p,id:'second',hours:.2}]),groups,'2026-06-01','2026-06-02');expect(value).toEqual([{date:'2026-06-01',project:'p0000',developer_hours:.3}]);expect(JSON.stringify(value)).not.toContain('PRIVATE_');expect(()=>projectWorkDays(wrap({employeeId:employee}),wrap([p,{...p,projectId:'changed'}]),groups,'2026-06-01','2026-06-02')).toThrow();
});
test('project name matching does not use a username as project evidence',()=>{
  expect(new ProjectAttributor(projects).match('',['/Users/DistinctiveProduct/unrelated'])).toBeNull();
});
test('cross-midnight spans split in Montreal while usage follows its request date',()=>{
  const s=session();for(const r of s.records.values()){r.start=Date.parse('2026-06-02T03:30:00Z');r.end=Date.parse('2026-06-02T04:30:00Z');}const b=new ChargebackBuilder(bounds,projects);b.add(s,['2026-06-01','2026-06-02'],true);const v=b.build();expect(v.days.filter(d=>d.agent_hours>0).map(d=>d.agent_hours)).toEqual([.5,.5]);expect(v.total.priced_samples).toBe(1);
});
test('work dates with no agent observations retain unavailable agent activity in CSV',()=>{
  const b=new ChargebackBuilder(bounds,projects,[{date:'2026-06-02',project:'p0000',developer_hours:8}]);const lines=projectDailyCSV({chargeback:b.build()}).trim().split('\n'),fields=lines[0].split(','),row=lines[1].split(',').map(s=>s.replaceAll('"',''));expect(row[fields.indexOf('agent_hours')]).toBe('');expect(row[fields.indexOf('developer_hours')]).toBe('8');expect(row[fields.indexOf('estimated_api_cost_usd')]).toBe('');expect(row[fields.indexOf('ratio')]).toBe('');
});
