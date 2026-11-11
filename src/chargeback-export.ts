import type { Chargeback } from './types.ts';
import { sumCosts } from './pricing.ts';
/** Catalogue labels only, never derive an export label from a filesystem path. */
export function projectLabel(value:unknown):string|null {
  if(typeof value!=='string'||value.length>160)return null;const label=value.normalize('NFC').trim();
  return label&&/^[\p{L}\p{M}\p{N} .,'’()&+_-]+$/u.test(label)&&!/^[\da-f]{8}-[\da-f-]{27}$/i.test(label)?label:null;
}
const csvCell=(v:unknown)=>{const s=v==null?'':String(v),safe=/^[\s]*[=+@-]/.test(s)?"'"+s:s;return '"'+safe.replaceAll('"','""')+'"';};
export function projectDailyCSV(report:{chargeback?:Chargeback}):string {
  const fields=['date','project','project_name','customer','agent_hours','developer_hours','ratio','sessions','tool_calls','tool_failures','input_tokens','output_tokens','cache_read_tokens','cache_write_tokens','reasoning_tokens','estimated_api_cost_usd','estimated_api_cost_upper_usd','priced_samples','unpriced_samples'];
  const b=report.chargeback;if(!b)return fields.join(',')+'\n';
  const groups=new Map<string,typeof b.days>(),workHours=new Map<string,number>(),catalog=new Map(b.projects.map(p=>[p.key,p]));
  for(const d of b.days){const key=d.date+':'+d.project,list=groups.get(key)??[];list.push(d);groups.set(key,list);}for(const d of b.work_days){const key=d.date+':'+d.project;workHours.set(key,(workHours.get(key)??0)+d.developer_hours);}
  const keys=[...new Set([...groups.keys(),...workHours.keys()])].sort();
  const rows=keys.map(key=>{const [date,project]=key.split(':'),data=groups.get(key)??[],p=catalog.get(project),hours=workHours.get(key)??null;
    const row:Record<string,unknown>={date,project,project_name:p?.title??'Unattributed',customer:p?.client??'',...sumCosts(data),developer_hours:hours};for(const k of ['agent_hours','sessions','tool_calls','tool_failures'])row[k]=data.length?data.reduce((n,d)=>n+(d as any)[k],0):null;row.ratio=data.length&&hours!==null&&hours>0?Number(row.agent_hours)/hours:null;return fields.map(k=>csvCell(row[k])).join(',');});
  return [fields.join(','),...rows].join('\n')+'\n';
}
