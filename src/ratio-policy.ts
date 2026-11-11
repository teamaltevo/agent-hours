import { metrics,type Report,type Client } from './types.ts';
import { allClientSummary } from './all-clients.ts';

/** TimeSentry's successful self-only read contains the full returned hours.
 * Old confirmation flags are deliberately ignored when rebuilding saved data. */
export function applyTimeSentryHours(report:Report):Report {
  if(report.timesentry_retrieval?.status!=='self_only_read_completed')throw new Error('timesentry_read_not_completed');
  report.timesentry_coverage='complete';report.timesentry_retrieval.scope_completeness='complete';
  report.daily_ratio_policy={schema_version:2,denominator:'all_returned_timesentry_hours',unknown_policy:'exclude_as_personal_for_ratio',ratio_mode:'observed_history_proxy'};
  for(const day of report.days){
    day.developer_hours=day.returned_punch_hours??0;
    for(const client of Object.keys(report.clients) as Client[]){
      const history=day.history_observed_by_client[client]===true,amount=day.observed_inferred_work_hours[client]??(history?0:null);
      day.captured_work_hours_by_client[client]=amount;
      day.ratios_by_client[client]=history&&day.developer_hours>0?amount!/day.developer_hours:null;
      day.ratio_status_by_client[client]=!history?'no_recorded_history':day.developer_hours===0?'zero_developer_hours':'observed_subset_proxy';
    }
    day.ratio=day.ratios_by_client[report.primary_ratio_client]??null;
    if(day.combined){const c=day.combined;c.ratio=c.history_observed&&day.developer_hours>0?c.captured_work_hours!/day.developer_hours:null;c.ratio_status=!c.history_observed?'no_recorded_history':day.developer_hours===0?'zero_developer_hours':'observed_subset_proxy';}
  }
  for(const client of Object.keys(report.clients) as Client[]){
    const paired=report.days.filter(d=>d.ratios_by_client[client]!=null),a=paired.reduce((n,d)=>n+(d.captured_work_hours_by_client[client]??0),0),w=paired.reduce((n,d)=>n+(d.developer_hours??0),0);
    report.observed_day_aggregates[client]={paired_days:paired.length,captured_activity_hours:paired.length?a:null,developer_hours:paired.length?w:null,ratio:paired.length?a/w:null,metric:metrics[client]};
  }
  if(report.period_summaries)for(const unit of ['week','month'] as const)for(const p of report.period_summaries[unit]){
    const days=periodDays(report,p.period,unit),paired=days.filter(d=>d.ratios_by_client[p.client]!=null),a=paired.reduce((n,d)=>n+(d.captured_work_hours_by_client[p.client]??0),0),w=paired.reduce((n,d)=>n+(d.developer_hours??0),0);
    p.developer_hours=days.reduce((n,d)=>n+(d.developer_hours??0),0);p.paired_days=paired.length;p.paired_activity_hours=paired.length?a:null;p.paired_developer_hours=paired.length?w:null;p.ratio=paired.length?a/w:null;p.days_with_activity_and_zero_work=days.filter(d=>(d.captured_work_hours_by_client[p.client]??0)>0&&d.developer_hours===0).length;
  }
  if(report.combined){
    const paired=report.days.filter(d=>d.combined?.ratio!=null),a=paired.reduce((n,d)=>n+(d.combined?.captured_work_hours??0),0),w=paired.reduce((n,d)=>n+(d.developer_hours??0),0);
    report.combined.aggregate={metric:report.combined.metric,paired_days:paired.length,captured_activity_hours:paired.length?a:null,developer_hours:paired.length?w:null,ratio:paired.length?a/w:null};
    for(const unit of ['week','month'] as const)for(const p of report.combined.period_summaries[unit]){
      const days=periodDays(report,p.period,unit),paired=days.filter(d=>d.combined?.ratio!=null),a=paired.reduce((n,d)=>n+(d.combined?.captured_work_hours??0),0),w=paired.reduce((n,d)=>n+(d.developer_hours??0),0);
      p.developer_hours=days.reduce((n,d)=>n+(d.developer_hours??0),0);p.paired_days=paired.length;p.paired_activity_hours=paired.length?a:null;p.paired_developer_hours=paired.length?w:null;p.ratio=paired.length?a/w:null;p.days_with_activity_and_zero_work=days.filter(d=>(d.combined?.captured_work_hours??0)>0&&d.developer_hours===0).length;
    }
  }
  if(report.all_clients)report.all_clients=allClientSummary(report);
  return report;
}
function periodDays(report:Report,period:string,unit:'week'|'month'){
  if(unit==='month')return report.days.filter(d=>d.date.startsWith(period));
  const end=new Date(Date.parse(period)+7*86400000).toISOString().slice(0,10);return report.days.filter(d=>d.date>=period&&d.date<end);
}
