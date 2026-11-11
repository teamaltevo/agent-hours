import { privateWrite } from './core.ts';
import type { DeliveryEvent } from './delivery.ts';
const errors=new Set(['delivery_failed','delivery_uncertain','delivery_busy','delivery_daily_limit','delivery_report_too_large','delivery_report_rejected','delivery_phrase_rejected','delivery_service_unavailable','delivery_network_error','delivery_request_timeout','cancelled','incomplete_report_not_sent']);

/** Separate, shareable transport diagnostics: never include the report payload,
 * person, participant, email addresses, endpoint, paths, headers or credentials. */
export function deliveryRecorder(reportPath:string){
  const events:DeliveryEvent[]=[],path=reportPath.replace(/\.json$/,'')+'.delivery-'+crypto.randomUUID().slice(0,8)+'.json';
  return {path,onDiagnostic(event:DeliveryEvent){
    if(events.length>=80||!['attempt','response','network_error','retry','accepted'].includes(event.event)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(event.request_id)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.at)||!Number.isFinite(Date.parse(event.at)))return;
    const clean:DeliveryEvent={event:event.event,at:event.at,request_id:event.request_id,attempt:event.attempt,elapsed_ms:event.elapsed_ms,input_bytes:event.input_bytes};
    if(![clean.attempt,clean.elapsed_ms,clean.input_bytes].every(v=>Number.isFinite(v)&&v>=0))return;
    if(typeof event.http_status==='number'&&event.http_status>=100&&event.http_status<=599)clean.http_status=event.http_status;
    if(event.receipt&&/^[a-f0-9]{64}$/.test(event.receipt))clean.receipt=event.receipt;
    if(event.stage==='preparing'||event.stage==='sending')clean.stage=event.stage;
    if(event.code&&errors.has(event.code))clean.code=event.code;events.push(clean);
  },async save(status:'accepted'|'failed',error?:string){
    const safeError=error&&errors.has(error)?error:undefined;
    await privateWrite(path,JSON.stringify({schema_version:1,status,...(safeError?{error:safeError}:{}),events},null,2)+'\n');
  }};
}
