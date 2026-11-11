import { Transform, type TransformCallback } from 'node:stream';
import { SafeError } from './core.ts';

/** Bun's streaming decoder accepts truncated EOF. Validate frame structure too.
 * Only small headers are buffered; compressed blocks are skipped incrementally.
 * Supports concatenated and skippable frames; caps windows before decompression.
 */
export class StrictZstdFrames extends Transform {
  private buffer=Buffer.alloc(0);private stage:'magic'|'descriptor'|'header'|'block'|'checksum'|'skipLength'|'skip'='magic';
  private skip=0;private afterSkip:'magic'|'block'|'checksum'='magic';private checksum=false;
  private descriptor=0;private seen=false;private encoded=0;
  private consume(size:number):Buffer {const value=this.buffer.subarray(0,size);this.buffer=this.buffer.subarray(size);return value;}
  override _transform(chunk:Buffer,_encoding:BufferEncoding,callback:TransformCallback):void {
    try {
      this.encoded+=chunk.length;if(this.encoded>256*1024*1024)throw new SafeError('compressed_size_limit');
      this.buffer=Buffer.concat([this.buffer,chunk]);
      while(true){
        if(this.stage==='skip'){
          const n=Math.min(this.skip,this.buffer.length);this.consume(n);this.skip-=n;
          if(this.skip)break;this.stage=this.afterSkip;continue;
        }
        if(this.stage==='magic'){
          if(this.buffer.length<4)break;const magic=this.consume(4).readUInt32LE();
          if(magic===0xfd2fb528){this.seen=true;this.stage='descriptor';}
          else if(magic>=0x184d2a50&&magic<=0x184d2a5f)this.stage='skipLength';
          else throw new SafeError('invalid_zstd_frame');
        }else if(this.stage==='skipLength'){
          if(this.buffer.length<4)break;this.skip=this.consume(4).readUInt32LE();this.afterSkip='magic';this.stage='skip';
        }else if(this.stage==='descriptor'){
          if(this.buffer.length<1)break;this.descriptor=this.consume(1)[0];
          if(this.descriptor&0x18)throw new SafeError('invalid_zstd_frame');
          this.checksum=Boolean(this.descriptor&4);this.stage='header';
        }else if(this.stage==='header'){
          const single=Boolean(this.descriptor&32);const flag=this.descriptor>>6;
          const dict=[0,1,2,4][this.descriptor&3];const size=flag===0?(single?1:0):[0,2,4,8][flag];
          const length=(single?0:1)+dict+size;if(this.buffer.length<length)break;
          const header=this.consume(length);
          if(!single){const wd=header[0];const base=2**(10+(wd>>3));if(base+base/8*(wd&7)>64*1024*1024)throw new SafeError('zstd_window_limit');}
          if(single){const offset=dict;const contentSize=size===8?header.readBigUInt64LE(offset):BigInt(header.readUIntLE(offset,size));
            const actual=contentSize+(flag===1?256n:0n);if(actual>64n*1024n*1024n)throw new SafeError('zstd_window_limit');}
          this.stage='block';
        }else if(this.stage==='block'){
          if(this.buffer.length<3)break;const value=this.consume(3).readUIntLE(0,3);const last=Boolean(value&1),type=(value>>1)&3,size=value>>3;
          if(type===3||size>128*1024)throw new SafeError('invalid_zstd_block');
          this.skip=type===1?1:size;this.afterSkip=last?(this.checksum?'checksum':'magic'):'block';this.stage='skip';
        }else if(this.stage==='checksum'){
          if(this.buffer.length<4)break;this.consume(4);this.stage='magic';
        }
      }
      this.push(chunk);callback();
    }catch{callback(new SafeError('invalid_or_truncated_zstd'));}
  }
  override _flush(callback:TransformCallback):void {
    callback(this.seen&&this.stage==='magic'&&this.buffer.length===0?undefined:new SafeError('invalid_or_truncated_zstd'));
  }
}
