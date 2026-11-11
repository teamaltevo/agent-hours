import { afterEach,beforeEach,expect,test } from 'bun:test';
import { mkdtemp,rm,mkdir,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDelivery,sendReport,type DeliveryConfig } from '../src/delivery.ts';
import { sampleReport } from './fixtures.ts';
import { DEFAULT_SUBMISSION_ENDPOINT,PUBLIC_SUBMISSION_PHRASE } from '../src/submission-config.ts';

let root:string;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'agent-hours-delivery-'));});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
async function config(value:unknown){await mkdir(join(root,'local'),{recursive:true});await writeFile(join(root,'local/delivery.json'),JSON.stringify(value));}
const settings:DeliveryConfig={endpoint:'https://worker.example/reports',phrase:PUBLIC_SUBMISSION_PHRASE,participant:'assigned-code'};
test('default receiver uses the public phrase without requiring credentials',async()=>{const config=await loadDelivery(root);expect(config?.endpoint).toBe(DEFAULT_SUBMISSION_ENDPOINT);expect(config?.phrase).toBe(PUBLIC_SUBMISSION_PHRASE);});
test('configured delivery is automatic but an individual run can stay local',async()=>{await config(settings);expect((await loadDelivery(root))?.endpoint).toBe(settings.endpoint);expect(await loadDelivery(root,{disabled:true})).toBeNull();});
for(const endpoint of ['http://worker.example/reports','https://worker.example/reports?token=SECRET','https://user:secret@worker.example/reports','https://worker.example/other'])test('unsafe delivery endpoint rejected '+endpoint,async()=>{await config({...settings,endpoint});await expect(loadDelivery(root)).rejects.toThrow('invalid_delivery_config');});
test('request uses the public phrase and includes only sanitized aggregates',async()=>{
  let body='',phrase='',auth:unknown;const fake=(async(_input:any,init:any)=>{body=init.body;phrase=init.headers['X-Report-Phrase'];auth=init.headers.Authorization;expect(init.redirect).toBe('error');return Response.json({status:'accepted'});}) as unknown as typeof fetch;
  await sendReport(sampleReport(),settings,new AbortController().signal,fake);expect(phrase).toBe(PUBLIC_SUBMISSION_PHRASE);expect(auth).toBeUndefined();for(const secret of ['PRIVATE_SESSION','PRIVATE_SOURCE','PRIVATE_DIRECTORY','PRIVATE_CONVERSATION'])expect(body).not.toContain(secret);expect(JSON.parse(body).participant).toBe('assigned-code');
});
test('failed delivery is not retried and does not expose response content',async()=>{
  let calls=0;const fake=(async()=>{calls++;return new Response('PROVIDER_SECRET',{status:503});}) as unknown as typeof fetch;
  await expect(sendReport(sampleReport(),settings,new AbortController().signal,fake)).rejects.toThrow('delivery_failed');expect(calls).toBe(1);
});
test('partial reports are rejected before any network request',async()=>{
  let called=false;const report=sampleReport();report.pending_sessions=1;const fake=(async()=>{called=true;return new Response();}) as unknown as typeof fetch;
  await expect(sendReport(report,settings,new AbortController().signal,fake)).rejects.toThrow('incomplete_report_not_sent');expect(called).toBe(false);
});
test('legacy token settings are ignored without reading a credential file',async()=>{
  await config({endpoint:settings.endpoint,token_env:'UNSET_LEGACY_TOKEN',token_file:'missing-legacy-token',participant:'assigned-code'});expect((await loadDelivery(root))?.phrase).toBe(PUBLIC_SUBMISSION_PHRASE);
});
test('control characters in configurable phrases are rejected',async()=>{
  await config({...settings,phrase:'unsafe\r\nheader'});await expect(loadDelivery(root)).rejects.toThrow('invalid_delivery_config');
});
