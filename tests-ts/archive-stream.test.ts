import { expect,test } from 'bun:test';
import { unzipSync,strFromU8 } from 'fflate';
import { zipReportFiles,BundleSizeError } from '../src/bundle.ts';

test('streamed archive reproduces large files without full-file UTF-8 buffers',()=>{
  const json='{"value":"'+'x'.repeat(2*1024*1024)+'"}',html='<html>'+('a'.repeat(32767))+'𐐀'+('b'.repeat(150000))+'</html>',files={json,html,csv:'date,hours\n2026-06-01,1\n',readme:'Synthetic test'};
  const archive=unzipSync(zipReportFiles(files));expect(strFromU8(archive['report.json'])).toBe(json);expect(strFromU8(archive['report.html'])).toBe(html);expect(strFromU8(archive['daily.csv'])).toBe(files.csv);
});
test('archive size guard aborts compression with a fixed safe error',()=>{
  expect(()=>zipReportFiles({json:'{}',html:'<html>test</html>',csv:'date\n',readme:'test'},10)).toThrow(BundleSizeError);
});
