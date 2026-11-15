const API='https://models.dev/api.json';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const data=await (await fetch(API)).json();
  const oc=data.opencode;
  const free=Object.values(oc.models).filter(m=>Number(m.cost?.input??1)===0);
  console.log('free models='+free.length);
  for(const m of free){
    const npm=m.provider?.npm ?? oc.npm;
    let endpoint='/chat/completions'; let headers={'Content-Type':'application/json','Authorization':'Bearer public'}; let body;
    if(npm==='@ai-sdk/anthropic'){
      endpoint='/messages'; headers={'Content-Type':'application/json','x-api-key':'public','anthropic-version':'2023-06-01'}; body={model:m.id,max_tokens:16,messages:[{role:'user',content:'ping'}]};
    } else if(npm==='@ai-sdk/openai'){
      endpoint='/responses'; body={model:m.id,input:'ping',max_output_tokens:16};
    } else {
      body={model:m.id,max_tokens:16,messages:[{role:'user',content:'ping'}],stream:false};
    }
    try{
      const res=await fetch('https://opencode.ai/zen/v1'+endpoint,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
      const text=await res.text();
      console.log((res.ok?'OK ':'FAIL ')+m.id+' npm='+npm+' status='+res.status+' '+text.slice(0,180).replace(/\n/g,' '));
    }catch(e){ console.log('ERR '+m.id+' '+e.message); }
    await sleep(1200);
  }
})();