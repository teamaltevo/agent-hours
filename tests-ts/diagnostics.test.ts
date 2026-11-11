import { expect,test,spyOn } from 'bun:test';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliveryTrace } from '../worker/src/diagnostics.ts';
import { deliveryRecorder } from '../src/delivery-diagnostics.ts';
import { sendReport } from '../src/delivery.ts';
import { sampleReport } from './fixtures.ts';

test('Worker stage logs drop payloads, identities and arbitrary exception strings',()=>{
  const messages:string[]=[];const spy=spyOn(console,'info').mockImplementation(value=>{messages.push(String(value));});
  try{const log=deliveryTrace(true,'00000000-0000-4000-8000-000000000000');log.setReceipt('a'.repeat(64));log.stage('bundle_ready',{zip_bytes:123,code:'PRIVATE_EXCEPTION',person:'PRIVATE_PERSON',body:'PRIVATE_BODY',headers:'PRIVATE_HEADERS'} as any);const data=JSON.parse(messages[0]);expect(data.stage).toBe('bundle_ready');expect(data.zip_bytes).toBe(123);expect(data.receipt).toBe('a'.repeat(64));expect(messages.join('')).not.toContain('PRIVATE_');}finally{spy.mockRestore();}
});
test('client request IDs correlate to safe diagnostics without leaking report content',async()=>{
  const root=await mkdtemp(join(tmpdir(),'agent-hours-diag-'));try{
    const recorder=deliveryRecorder(join(root,'report.json'));let requestId='';
    const fake=(async(_input:any,init:any)=>{requestId=init.headers['X-Delivery-Request-Id'];return Response.json({protocol:2,status:'accepted',submission_id:'b'.repeat(64)});}) as unknown as typeof fetch;
    await sendReport(sampleReport(),{endpoint:'https://worker.example/reports',phrase:'public-phrase',participant:'PRIVATE_PARTICIPANT'},new AbortController().signal,fake,{onDiagnostic:recorder.onDiagnostic});
    await recorder.save('accepted');const text=await readFile(recorder.path,'utf8'),data=JSON.parse(text);expect(data.events[0].request_id).toBe(requestId);expect(data.events.at(-1).receipt).toBe('b'.repeat(64));expect(text).not.toContain('PRIVATE_');expect(text).not.toContain('worker.example');expect(text).not.toContain('public-phrase');
  }finally{await rm(root,{recursive:true,force:true});}
});
