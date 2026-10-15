import { describe, expect, it } from 'vitest';
import { MAX_BYTES, optionalNumber, validateDimensions, validateFile } from '../src/utils/imageValidation';
describe('upload boundaries',()=>{
  it('accepts exactly 12 MiB, rejects one byte more, and rejects unsupported files',()=>{
    expect(validateFile(new File([new Uint8Array(MAX_BYTES)],'road.png',{type:'image/png'}))).toBeNull();
    expect(validateFile(new File([new Uint8Array(MAX_BYTES+1)],'road.png',{type:'image/png'}))).toContain('12 MiB');
    expect(validateFile(new File(['svg'],'road.svg',{type:'image/svg+xml'}))).toContain('JPEG');
  });
  it('allows 20 MP and 64 px, rejects excessive area or small dimensions',()=>{
    expect(validateDimensions(5000,4000)).toBeNull();
    expect(validateDimensions(64,64)).toBeNull();
    expect(validateDimensions(5001,4000)).toContain('20 megapixels');
    expect(validateDimensions(63,100)).toContain('64');
  });
});
describe('optional calibration values',()=>{
  it('omits blank values and preserves measured zero pitch',()=>{
    expect(optionalNumber(' ','scale')).toEqual({});
    expect(optionalNumber('','pitch')).toEqual({});
    expect(optionalNumber('0','pitch')).toEqual({value:0});
  });
  it.each(['0','-1','1000.1','Infinity','NaN'])('rejects invalid scale %s',raw=>expect(optionalNumber(raw,'scale').error).toBeTruthy());
  it.each(['-90','90','0'])('accepts inclusive pitch %s',raw=>expect(optionalNumber(raw,'pitch').value).toBe(Number(raw)));
  it.each(['-90.01','90.01','Infinity'])('rejects invalid pitch %s',raw=>expect(optionalNumber(raw,'pitch').error).toBeTruthy());
});
