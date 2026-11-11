import { zipSync,strToU8 } from 'fflate';
import { publicReport,dailyCSV } from './public-report.ts';
import { dashboardHTML } from './dashboard.ts';
import type { Report } from './types.ts';

export function reportBundle(input:Report):{report:Report;json:string;html:string;csv:string;zip:Uint8Array} {
  const report=publicReport(input),json=JSON.stringify(report,null,2)+'\n',html=dashboardHTML(report),csv=dailyCSV(report);
  const readme='Agent Hours aggregate report\n\nOpen report.html in a browser. It is offline and contains the sanitized JSON used by its charts. report.json and daily.csv are machine-readable. No source history, conversation text, commands, paths, credentials or private indexes are included.\n\nRead the interpretation and coverage notes before comparing clients or treating missing values as zero. Tool time overlaps agent activity. Attribution is not verified productivity or billing.\n';
  const zip=zipSync({'report.json':strToU8(json),'report.html':strToU8(html),'daily.csv':strToU8(csv),'README.txt':strToU8(readme)},{level:6});
  return {report,json,html,csv,zip};
}
