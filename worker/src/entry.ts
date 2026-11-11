import { EmailMessage } from 'cloudflare:email';
import handler,{type Env,type EmailPayload} from './index.ts';

function encoded(text:string):string {const bytes=new TextEncoder().encode(text);let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw);}
const wrapped=(text:string)=>(text.match(/.{1,76}/g)??[]).join('\r\n');
/** Legacy Email Routing API works with the account's existing verified domain;
 * it does not require onboarding the newer Email Sending beta service. */
function mime(message:EmailPayload):string {
  const boundary='agent-hours-'+crypto.randomUUID();
  const chars=Array.from(message.subject),words:string[]=[];for(let i=0;i<chars.length;i+=24)words.push('=?UTF-8?B?'+encoded(chars.slice(i,i+24).join(''))+'?=');
  const parts=[`From: Agent Hours <${message.from}>`,`To: ${message.to}`,`Subject: ${words.join('\r\n ')}`,`Date: ${new Date().toUTCString()}`,'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',wrapped(encoded(message.text))];
  for(const attachment of message.attachments)parts.push(`--${boundary}`,`Content-Type: ${attachment.type}; name="${attachment.filename}"`,`Content-Disposition: attachment; filename="${attachment.filename}"`,'Content-Transfer-Encoding: base64','',wrapped(attachment.content));
  parts.push(`--${boundary}--`,'');return parts.join('\r\n');
}
export default {fetch(request:Request,env:Omit<Env,'EMAIL'>&{EMAIL:{send(message:EmailMessage):Promise<unknown>}}){
  return handler.fetch(request,{...env,EMAIL:{send:message=>env.EMAIL.send(new EmailMessage(message.from,message.to,mime(message)))}});
}};
