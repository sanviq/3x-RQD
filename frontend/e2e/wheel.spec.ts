import { test, expect } from '@playwright/test';

test('wheel camera renders GPU road relief and spatially synchronized suspension',async({page,isMobile})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  if(isMobile)await page.getByRole('button',{name:'Open navigation'}).click();
  await page.getByRole('button',{name:'Scenario lab',exact:true}).click();
  const canvas=page.locator('.road-renderer');
  await expect(page.getByRole('group',{name:'Simulation camera'}).getByRole('button',{name:'Wheel',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(canvas).toHaveAttribute('data-renderer','webgl-wheel');
  const physics=await page.evaluate(async()=>{
    const base='/src/simulation/';
    const m=await import(base+'model.ts'),v=await import(base+'vehicle.ts'),r=await import(base+'render.ts'),image=await import(base+'image.ts');
    const config={width:6,length:30,speed:25},marks=m.wheelDemoMarks(config),path=m.defaultPath;
    let state=m.initialDrive(),before=0,peak=0,peakState=state;
    for(let i=0;i<650;i++){
      state=m.stepDrive(state,config,marks,path);const p=v.wheelPose(state,marks,path,config);
      if(state.z<5)before=Math.max(before,Math.abs(p.travel));
      if(Math.abs(p.travel)>peak){peak=Math.abs(p.travel);peakState=state;}
    }
    const c=document.querySelector('.road-renderer') as HTMLCanvasElement,texture=image.sampleTexture();
    r.renderRoad(c,{texture,marks,config,path,drive:peakState,camera:'Wheel',rotation:0,zoom:1,mesh:false,guides:true});
    return {before,peak,axle:peakState.wheels[1].axle,body:peakState.wheels[1].body,renderer:c.dataset.renderer,finite:peakState.wheels.every((w:Record<string,number>)=>Object.values(w).every(Number.isFinite))};
  });
  expect(physics.before).toBe(0);expect(physics.peak).toBeGreaterThan(.005);
  expect(physics.axle).not.toBe(physics.body);expect(physics.finite).toBe(true);
  expect(physics.renderer).toBe('webgl-wheel');expect(errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
