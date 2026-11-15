const API='https://models.dev/api.json';
async function testModel(m){
  const npm=m.provider?.npm ?? 'opencode';
  let endpoint='/chat/completions'; let headers={'Content-Type':'application/json','Authorization':'Bearer public'}; let body;
  if(npm==='@ai-sdk/anthropic'){ endpoint='/messages'; headers={'Content-Type':'application/json','x-api-key':'public','anthropic-version':'2023-06-01'}; body={model:m.id,max_tokens:12,messages:[{role:'user',content:'ping'}]}; }
  else if(npm==='@ai-sdk/openai'){ endpoint='/responses'; body={model:m.id,input:'ping',max_output_tokens:12}; }
  else { body={model:m.id,max_tokens:12,messages:[{role:'user',content:'ping'}],stream:false}; }
  try{
    const res=await fetch('https://opencode.ai/zen/v1'+endpoint,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    const text=await res.text();
    return {id:m.id,npm,status:res.status,text:text.slice(0,160).replace(/\s+/g,' ')};
  }catch(e){return {id:m.id,npm,status:0,text:e.message};}
}
(async()=>{
  const data=await (await fetch(API)).json();
  const free=Object.values(data.opencode.models).filter(m=>Number(m.cost?.input??1)===0);
  const results=[];
  for(let i=0;i<free.length;i+=8){ results.push(...await Promise.all(free.slice(i,i+8).map(testModel))); }
  const ok=results.filter(r=>r.status===200);
  console.log('total='+free.length+' ok='+ok.length);
  for(const r of ok) console.log('OK  '+r.id+'  npm='+r.npm);
  console.log('--- non-401 model-not-supported ---');
  for(const r of results.filter(r=>r.status!==200 && r.status!==401)) console.log(r.status+' '+r.id+' '+r.text);
})();