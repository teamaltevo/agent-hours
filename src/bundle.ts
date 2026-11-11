import { zipSync,strToU8 } from 'fflate';
import { publicReport,dailyCSV,type PublicReport } from './public-report.ts';
import { publicDashboardHTML } from './dashboard.ts';
import type { Report } from './types.ts';

export function reportBundle(input:Report):{report:Report;json:string;html:string;csv:string;zip:Uint8Array} {
  return publicReportBundle(publicReport(input));
}
/** Avoid repeating deep validation/copies after the Worker validates its input. */
export function publicReportBundle(report:PublicReport):{report:Report;json:string;html:string;csv:string;zip:Uint8Array} {
  const json=JSON.stringify(report)+'\n',html=publicDashboardHTML(report),csv=dailyCSV(report);
  const readme='Agent Hours\n\nOpen report.html to view the dashboard.\nreport.json contains its aggregate data; daily.csv opens in a spreadsheet.\nMeasurement definitions are under About these numbers in the dashboard.\n';
  const zip=zipSync({'report.json':strToU8(json),'report.html':strToU8(html),'daily.csv':strToU8(csv),'README.txt':strToU8(readme)},{level:1});
  return {report,json,html,csv,zip};
}
