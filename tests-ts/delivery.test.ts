import { afterEach,beforeEach,expect,test } from 'bun:test';
import { mkdtemp,rm,mkdir,writeFile,chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDelivery,sendReport,type DeliveryConfig } from '../src/delivery.ts';
import { sampleReport } from './fixtures.ts';

let root:string;const key='AGENT_HOURS_TEST_UPLOAD_TOKEN',token='test-only-token-0000000000000000000000';
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'agent-hours-delivery-'));process.env[key]=token;});
afterEach(async()=>{delete process.env[key];await rm(root,{recursive:true,force:true});});
async function config(value:unknown){await mkdir(join(root,'local'),{recursive:true});await writeFile(join(root,'local/delivery.json'),JSON.stringify(value));}
const settings:DeliveryConfig={endpoint:'https://worker.example/reports',token_env:key,participant:'assigned-code'};
test('delivery is opt-in through explicit configuration, never a hidden upload',async()=>expect(await loadDelivery(root)).toBeNull());
test('configured delivery is automatic but an individual run can stay local',async()=>{await config(settings);expect((await loadDelivery(root))?.endpoint).toBe(settings.endpoint);expect(await loadDelivery(root,{disabled:true})).toBeNull();});
for(const endpoint of ['http://worker.example/reports','https://worker.example/reports?token=SECRET','https://user:secret@worker.example/reports','https://worker.example/other'])test('unsafe delivery endpoint rejected '+endpoint,async()=>{await config({...settings,endpoint});await expect(loadDelivery(root)).rejects.toThrow('invalid_delivery_config');});
test('request includes sanitized aggregates, no source paths, IDs or tokens in body',async()=>{
  let body='',auth='';const fake=(async(_input:any,init:any)=>{body=init.body;auth=init.headers.Authorization;expect(init.redirect).toBe('error');return Response.json({status:'accepted'});}) as unknown as typeof fetch;
  await sendReport(sampleReport(),settings,new AbortController().signal,fake);expect(auth).toBe('Bearer '+token);for(const secret of ['PRIVATE_SESSION','PRIVATE_SOURCE','PRIVATE_DIRECTORY','PRIVATE_CONVERSATION',token])expect(body).not.toContain(secret);expect(JSON.parse(body).participant).toBe('assigned-code');
});
test('failed delivery is not retried and does not expose response content',async()=>{
  let calls=0;const fake=(async()=>{calls++;return new Response('PROVIDER_SECRET',{status:503});}) as unknown as typeof fetch;
  await expect(sendReport(sampleReport(),settings,new AbortController().signal,fake)).rejects.toThrow('delivery_failed');expect(calls).toBe(1);
});
test('partial reports are rejected before any network request',async()=>{
  let called=false;const report=sampleReport();report.pending_sessions=1;const fake=(async()=>{called=true;return new Response();}) as unknown as typeof fetch;
  await expect(sendReport(report,settings,new AbortController().signal,fake)).rejects.toThrow('incomplete_report_not_sent');expect(called).toBe(false);
});
test('owner-only generated upload token can support unattended local runs',async()=>{
  delete process.env[key];await config({...settings,token_file:'delivery-upload-token'});await writeFile(join(root,'local/delivery-upload-token'),token,{mode:0o600});expect((await loadDelivery(root))?.token_file).toBe(join(root,'local/delivery-upload-token'));
});
test('group-readable token files are refused on Unix',async()=>{
  if(process.platform==='win32')return;delete process.env[key];await config({...settings,token_file:'delivery-upload-token'});await writeFile(join(root,'local/delivery-upload-token'),token,{mode:0o600});await chmod(join(root,'local/delivery-upload-token'),0o644);await expect(loadDelivery(root)).rejects.toThrow('delivery_token_missing');
});
