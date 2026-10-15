import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeRoad, getHealth, isAnalysisResponse } from '../src/api/roadQuality';
import { demoResult } from '../src/data/demo';
afterEach(()=>vi.unstubAllGlobals());
describe('runtime response validation',()=>{
  it('accepts an unassessable response and null physical values without converting to zero',()=>{
    const response={...demoResult,assessment:{...demoResult.assessment,road_quality_index:null,band:'unassessable'}};
    expect(isAnalysisResponse(response)).toBe(true);
    expect(response.physical_measurements.area_sq_ft).toBeNull();
  });
  it('rejects incomplete and non-finite feature values',()=>{
    expect(isAnalysisResponse({assessment:{road_quality_index:75}})).toBe(false);
    expect(isAnalysisResponse({...demoResult,features:{...demoResult.features,boundary_contrast:Infinity}})).toBe(false);
  });
});
describe('multipart API client',()=>{
  it('sends exact keys, omits blank calibration, preserves zero pitch and lets fetch set content type',async()=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify(demoResult),{status:200}));
    vi.stubGlobal('fetch',fetchMock);
    await analyzeRoad({image:new File(['image'],'road.png',{type:'image/png'}),pitchDegrees:0,includeOverlay:false});
    const [url,init]=fetchMock.mock.calls[0];
    expect(url).toBe('/api/analyze');
    expect(init.headers).toBeUndefined();
    expect([...init.body.keys()].sort()).toEqual(['image','include_overlay','pitch_degrees']);
    expect(init.body.get('pitch_degrees')).toBe('0');
    expect(init.body.get('include_overlay')).toBe('false');
  });
  it('allows reachable heuristic mode',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'ok',model_loaded:false,feature_version:'surface-v1'}))));
    await expect(getHealth()).resolves.toMatchObject({model_loaded:false});
  });
  it('normalizes FastAPI validation arrays',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({detail:[{loc:['body','mm_per_pixel'],msg:'Must be greater than 0',type:'value_error'}]}),{status:422})));
    await expect(analyzeRoad({image:new File(['x'],'road.png'),includeOverlay:true})).rejects.toThrow('mm_per_pixel: Must be greater than 0');
  });
  it.each([413,500])('handles HTTP %s without exposing HTML',async status=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('<html>private stack trace</html>',{status})));
    await expect(analyzeRoad({image:new File(['x'],'road.png'),includeOverlay:true})).rejects.toThrow(status===413?'12 MiB':'Please try again');
  });
  it('retains a useful message for non-JSON proxy errors',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('Bad gateway',{status:502})));
    await expect(getHealth()).rejects.toThrow('service encountered an error');
  });
});
