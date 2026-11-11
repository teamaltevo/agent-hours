import type { Report,Day } from './types.ts';

/** Sum native captured session durations; parallel sessions remain additive.
 * The work-hour denominator is counted once per matched calendar date. */
export function allClientActivity(report:Report,days:Day[]=report.days){
  const active=Object.keys(report.clients).filter(c=>report.clients[c as keyof typeof report.clients]?.observed_inferred_work_hours!=null);
  const rows=days.map(d=>{
    let hours=0,available=false;
    for(const client of active){const c=client as keyof typeof report.clients,v=d.captured_work_hours_by_client[c];if(d.history_observed_by_client[c]===true&&v!=null){hours+=v;available=true;}}
    const work=d.developer_hours;
    return {date:d.date,activity:available?hours:null,work,ratio:available&&work!=null&&work>0?hours/work:null};
  });
  const measured=rows.filter(d=>d.activity!=null),paired=rows.filter(d=>d.ratio!=null);
  const captured=measured.reduce((n,d)=>n+(d.activity??0),0),pairedAgent=paired.reduce((n,d)=>n+(d.activity??0),0),pairedWork=paired.reduce((n,d)=>n+(d.work??0),0);
  return {rows,captured_hours:measured.length?captured:null,paired_agent_hours:paired.length?pairedAgent:null,paired_work_hours:paired.length?pairedWork:null,paired_days:paired.length,ratio:paired.length?captured/pairedWork:null};
}
// This function is intentionally self-contained: its compiled source is embedded
// for the offline browser, while the same implementation is unit-tested in Bun.
export const ALL_CLIENTS_SCRIPT='const allClientActivity='+allClientActivity.toString()+';';
export function allClientSummary(report:Report){const totals=allClientActivity(report);return {metric:'summed_native_client_activity_ms',paired_days:totals.paired_days,captured_activity_hours:totals.captured_hours,developer_hours:totals.paired_work_hours,ratio:totals.ratio};}
