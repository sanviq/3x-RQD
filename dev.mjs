import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
const root=dirname(fileURLToPath(import.meta.url));
const python=join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const vite=join(root,'frontend/node_modules/vite/bin/vite.js');
if(!existsSync(python)||!existsSync(vite)){
  console.error('First install backend dependencies in .venv and run npm install inside frontend/. See RUNNING.md.');
  process.exitCode=1;
}else{
  const children=[];
  let stopping=false;
  const stop=()=>{
    if(stopping)return;stopping=true;
    for(const child of children){
      if(child.exitCode!==null||!child.pid)continue;
      if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
      else child.kill('SIGTERM');
    }
  };
  const launch=(name,command,args,cwd)=>{
    const child=spawn(command,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
    children.push(child);
    child.stdout.on('data',data=>process.stdout.write('['+name+'] '+data));
    child.stderr.on('data',data=>process.stderr.write('['+name+'] '+data));
    child.on('error',error=>{console.error(name+': '+error.message);process.exitCode=1;stop()});
    child.on('exit',code=>{if(!stopping){console.error(name+' exited ('+code+'). Stopping the development session.');process.exitCode=code||1;stop()}});
  };
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  console.log('Road Health: http://127.0.0.1:5173 · API: http://127.0.0.1:8000/docs');
  console.log('Press Ctrl+C to stop both services.');
  launch('api',python,['-m','uvicorn','app.main:app','--reload','--host','127.0.0.1','--port','8000'],root);
  launch('web',process.execPath,[vite,'--configLoader','native','--host','127.0.0.1','--port','5173','--strictPort'],join(root,'frontend'));
}
