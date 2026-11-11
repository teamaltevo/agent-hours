import { Zip,ZipDeflate } from 'fflate';
import { publicReport,dailyCSV,type PublicReport } from './public-report.ts';
import { publicDashboardHTML } from './dashboard.ts';
import type { Report } from './types.ts';

export function reportBundle(input:Report):{report:Report;json:string;html:string;csv:string;zip:Uint8Array} {
  return publicReportBundle(publicReport(input));
}
/** Avoid repeating deep validation/copies after the Worker validates its input. */
export function publicReportBundle(report:PublicReport):{report:Report;json:string;html:string;csv:string;zip:Uint8Array} {
  const files=publicReportFiles(report);return {report,...files,zip:zipReportFiles(files)};
}
export interface ReportFiles {json:string;html:string;csv:string;readme:string}
export class BundleSizeError extends Error {constructor(){super('report_bundle_too_large');}}
export function publicReportFiles(report:PublicReport):ReportFiles {
  const data=JSON.stringify(report),json=data+'\n',html=publicDashboardHTML(report,data),csv=dailyCSV(report);
  const readme='Agent Hours\n\nOpen report.html to view the dashboard.\nreport.json contains its aggregate data; daily.csv opens in a spreadsheet.\nFor summed totals, filter daily.csv to client=all; do not add developer hours across client rows.\nMeasurement definitions are under About these numbers in the dashboard.\n';
  return {json,html,csv,readme};
}
/** Incremental encoding/compression avoids allocating full UTF-8 copies of the
 * report JSON and HTML simultaneously inside a 128 MiB Worker isolate. */
export function zipReportFiles(files:ReportFiles,maxBytes=Infinity):Uint8Array {
  const parts:Uint8Array[]=[];let total=0,error:Error|undefined,ended=false;
  const archive=new Zip((err,data,final)=>{if(err){error=err;return;}total+=data.length;if(total>maxBytes)throw new BundleSizeError();parts.push(data.slice());ended=final;});
  const encoder=new TextEncoder();
  for(const [name,text]of [['report.json',files.json],['report.html',files.html],['daily.csv',files.csv],['README.txt',files.readme]]){
    const entry=new ZipDeflate(name,{level:1});archive.add(entry);
    for(let offset=0;offset<text.length;){let end=Math.min(offset+32768,text.length);const last=text.charCodeAt(end-1);if(end<text.length&&last>=0xd800&&last<=0xdbff)end--;entry.push(encoder.encode(text.slice(offset,end)),end===text.length);offset=end;if(error)throw error;}
    if(!text.length)entry.push(new Uint8Array(),true);
  }
  archive.end();if(error)throw error;if(!ended)throw new Error('archive_not_finalized');
  const result=new Uint8Array(total);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;
}
