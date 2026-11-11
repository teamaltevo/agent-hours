/** Browser-only Chart.js adapters, embedded alongside the offline runtime. */
export const CHARTING_SCRIPT=String.raw`
const chartInstances=new Map();let chartSequence=0;
Chart.defaults.font.family='"Avenir Next", "Segoe UI", Verdana, sans-serif';Chart.defaults.font.size=13;
function disposeCharts(prefix){for(const [key,instance]of chartInstances)if(key===prefix||key.startsWith(prefix+'-')){instance.destroy();chartInstances.delete(key);}}
function paint(value){if(!value?.startsWith('var('))return value;return getComputedStyle(document.documentElement).getPropertyValue(value.slice(4,-1)).trim();}
function chartTheme(){const style=getComputedStyle(document.documentElement);return {text:style.getPropertyValue('--text').trim(),dim:style.getPropertyValue('--dim').trim(),line:style.getPropertyValue('--line').trim(),accent:style.getPropertyValue('--accent').trim()};}
function baseOptions(){const t=chartTheme();return {responsive:true,maintainAspectRatio:false,animation:false,color:t.text,font:{family:'"Avenir Next", "Segoe UI", Verdana, sans-serif',size:13},plugins:{legend:{labels:{color:t.text,usePointStyle:true,boxWidth:8,boxHeight:8,padding:16,font:{size:13}}},tooltip:{padding:10,displayColors:true}},scales:{x:{grid:{display:false},border:{display:false},ticks:{color:t.dim,font:{size:13}}},y:{beginAtZero:true,grid:{color:t.line},border:{display:false},ticks:{color:t.dim,font:{size:13}}}}};}
function calendarRows(rows,unit){
 const sorted=[...rows].sort((a,b)=>a.date.localeCompare(b.date));if(!sorted.length)return [];
 const found=new Map(sorted.map(d=>[d.date,d])),last=sorted.at(-1).date,result=[];let current=sorted[0].date;
 for(let count=0;current<=last&&count<3662;count++){
  result.push(found.get(current)??{date:current,values:{}});
  const d=new Date(current+(current.length===7?'-01':'')+'T00:00:00Z');
  if(unit==='month')d.setUTCMonth(d.getUTCMonth()+1);else d.setUTCDate(d.getUTCDate()+(unit==='week'?7:1));
  current=d.toISOString().slice(0,unit==='month'?7:10);
 }return result;
}
function chart(rows,series,ratio){
 disposeCharts('activity');const visible=rows.filter(d=>series.some(s=>d.values[s.key]!=null));
 if(!visible.length)return '<p class="unavailable">'+(ratio?'Ratios unavailable.':'No measurements for this selection.')+'</p>';
 const data=calendarRows(visible,$('period').value),shown=series.filter(s=>data.some(d=>d.values[s.key]!=null)),id='activity-canvas-'+(++chartSequence),options=baseOptions();
 options.interaction={mode:'index',intersect:false};options.plugins.legend.position='top';
 options.plugins.tooltip.filter=item=>item.parsed.y!=null;
 options.plugins.tooltip.callbacks={label:item=>item.dataset.label+': '+fmt(item.parsed.y,4)+(ratio?'×':' h')};
 options.scales.x.ticks.maxTicksLimit=7;options.scales.x.ticks.maxRotation=0;
 options.scales.y.ticks.callback=value=>fmt(value,2)+(ratio?'×':' h');
 if(ratio)options.scales.y.suggestedMax=1;
 const datasets=shown.map(s=>({label:s.label,data:data.map(d=>d.values[s.key]??null),backgroundColor:paint(s.color),borderColor:paint(s.color),borderWidth:ratio?2:0,borderRadius:2,maxBarThickness:18,pointRadius:ratio?(data.length>150?2:3):0,pointHoverRadius:6,pointHitRadius:8,spanGaps:false,skipNull:true}));
 const reference={id:'ratio-reference',afterDraw(instance){if(!ratio)return;const y=instance.scales.y,pixel=y.getPixelForValue(1);if(pixel<instance.chartArea.top||pixel>instance.chartArea.bottom)return;const c=instance.ctx;c.save();c.setLineDash([5,5]);c.strokeStyle=chartTheme().dim;c.lineWidth=1;c.beginPath();c.moveTo(instance.chartArea.left,pixel);c.lineTo(instance.chartArea.right,pixel);c.stroke();c.restore();}};
 queueMicrotask(()=>{const canvas=$(id);if(!canvas)return;chartInstances.set('activity',new Chart(canvas,{type:ratio?'line':'bar',data:{labels:data.map(d=>d.date),datasets},options,plugins:[reference]}));});
 return '<div class="chart-box"><canvas id="'+id+'" role="img" aria-label="'+(ratio?'Agent activity per work hour':'Agent activity and work hours by date')+'">See Daily data for the numbers.</canvas></div>';
}
function horizontalChart(id,labels,datasets,unit='h',empty='No measurements.'){
 disposeCharts(id);const target=$(id);if(!labels.length){target.innerHTML='<p class="unavailable">'+empty+'</p>';return;}
 target.innerHTML='<div class="chart-box compact" style="height:'+Math.max(150,labels.length*36+65)+'px"><canvas role="img" aria-label="'+(id.startsWith('top-days')?'Most active dates':id==='tools'?'Tool duration by category':id==='commands'?'Shell calls by category':'Session totals and distinct elapsed activity')+'"></canvas></div>';
 const options=baseOptions();options.indexAxis='y';options.interaction={mode:'index',intersect:false};options.plugins.legend.display=datasets.length>1;
 options.plugins.tooltip.filter=item=>item.parsed.x!=null;options.plugins.tooltip.callbacks={label:item=>item.dataset.label+': '+fmt(item.parsed.x,unit==='calls'?0:3)+' '+unit};
 options.scales.x.beginAtZero=true;options.scales.x.grid={color:chartTheme().line};options.scales.x.ticks.callback=value=>fmt(value,unit==='calls'?0:2)+(unit==='calls'?'':' '+unit);options.scales.y.grid={display:false};options.scales.y.ticks.autoSkip=false;
 chartInstances.set(id,new Chart(target.querySelector('canvas'),{type:'bar',data:{labels,datasets:datasets.map(d=>({...d,backgroundColor:paint(d.backgroundColor??'var(--accent)'),borderWidth:0,borderRadius:2,maxBarThickness:18,skipNull:true}))},options}));
}
function classificationChart(counts){
 disposeCharts('classification');const target=$('classification'),labels=['work','personal','mixed','unknown'],shades=['var(--accent)','var(--neutral)','#a38b65','var(--line)'];
 target.innerHTML='<div class="chart-box compact" style="height:140px"><canvas role="img" aria-label="Work, personal, mixed and unknown session counts"></canvas></div><table><tbody>'+Object.entries(counts).map(([key,v])=>row(key,fmt(v,0))).join('')+'</tbody></table>';
 const options=baseOptions();options.indexAxis='y';options.scales.x={stacked:true,display:false,beginAtZero:true};options.scales.y={stacked:true,display:false};options.plugins.legend.position='bottom';options.plugins.tooltip.callbacks={label:item=>item.dataset.label+': '+fmt(item.parsed.x,0)};
 chartInstances.set('classification',new Chart(target.querySelector('canvas'),{type:'bar',data:{labels:['Sessions'],datasets:labels.map((key,i)=>({label:key[0].toUpperCase()+key.slice(1),data:[counts[key]],backgroundColor:paint(shades[i]),borderWidth:1,borderColor:chartTheme().line,maxBarThickness:35}))},options}));
}
`;
