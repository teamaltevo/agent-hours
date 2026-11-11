type Stage='request_received'|'body_read'|'validated'|'rejected'|'receipt_found'|'lease_busy'|'prepare_started'|'bundle_ready'|'email_started'|'email_accepted'|'email_uncertain'|'request_finished'|'request_failed';
const stages=new Set(['request_received','body_read','validated','rejected','receipt_found','lease_busy','prepare_started','bundle_ready','email_started','email_accepted','email_uncertain','request_finished','request_failed']);
const codes=new Set(['invalid_or_oversized_report','report_bundle_too_large','report_preparation_failed','daily_email_limit','temporarily_unavailable','delivery_uncertain','worker_unhandled_error','sending','sent','uncertain']);
export const requestIdPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function deliveryTrace(enabled:boolean,requestId:string,persist?:(event:Record<string,unknown>)=>Promise<unknown>){
  if(!requestIdPattern.test(requestId))requestId=crypto.randomUUID();
  const start=Date.now();let receipt:string|undefined;
  function record(stage:Stage,metadata:{code?:string;input_bytes?:number;zip_bytes?:number;http_status?:number}={}){
    if(!enabled||!stages.has(stage))return;const data:Record<string,unknown>={event:'agent_hours_delivery',request_id:requestId,stage,elapsed_ms:Date.now()-start};
    if(receipt)data.receipt=receipt;
    if(metadata.code&&codes.has(metadata.code))data.code=metadata.code;
    for(const key of ['input_bytes','zip_bytes','http_status'] as const)if(typeof metadata[key]==='number'&&Number.isFinite(metadata[key])&&metadata[key]!>=0)data[key]=metadata[key];
    console.info(JSON.stringify(data));return data;
  }
  return {requestId,setReceipt(value:string){if(/^[a-f0-9]{64}$/.test(value))receipt=value;},stage:record,async checkpoint(stage:Stage,metadata:Parameters<typeof record>[1]={}){const data=record(stage,metadata);if(data&&persist)await persist(data).catch(()=>{});}};
}
export type DeliveryTrace=ReturnType<typeof deliveryTrace>;
