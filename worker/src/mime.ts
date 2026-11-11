import type { EmailPayload } from './index.ts';

function encoded(text:string):string {const bytes=new TextEncoder().encode(text);let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw);}
const wrapped=(text:string)=>(text.match(/.{1,76}/g)??[]).join('\r\n');
export function emailMIME(message:EmailPayload):string {
  const boundary='agent-hours-'+crypto.randomUUID();
  const words:string[]=[];let word='',bytes=0;for(const char of message.subject){const size=new TextEncoder().encode(char).length;if(bytes+size>42){words.push('=?UTF-8?B?'+encoded(word)+'?=');word='';bytes=0;}word+=char;bytes+=size;}if(word)words.push('=?UTF-8?B?'+encoded(word)+'?=');
  const parts=[`From: Agent Hours <${message.from}>`,`To: ${message.to}`,`Subject: ${words.join('\r\n ')}`,`Date: ${new Date().toUTCString()}`,'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',wrapped(encoded(message.text))];
  for(const attachment of message.attachments)parts.push(`--${boundary}`,`Content-Type: ${attachment.type}; name="${attachment.filename}"`,`Content-Disposition: attachment; filename="${attachment.filename}"`,'Content-Transfer-Encoding: base64','',wrapped(attachment.content));
  parts.push(`--${boundary}--`,'');return parts.join('\r\n');
}
