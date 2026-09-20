import assert from 'node:assert/strict';
const base = process.env.TEST_URL || 'http://127.0.0.1:4173';
const {samples} = await (await fetch(base+'/api/samples')).json();
assert.equal(samples.length,540);
assert.equal(new Set(samples.map(s=>s.id)).size,540);
assert.equal(samples.filter(s=>s.split==='test').length,270);
const invalid=await fetch(base+'/api/run',{method:'POST',body:JSON.stringify({message:''})});
assert.equal(invalid.status,400);
const forged=await fetch(base+'/api/run',{method:'POST',headers:{Origin:'https://unrelated.example'},body:JSON.stringify({message:'test'})});
assert.equal(forged.status,403);
const config=await (await fetch(base+'/api/config')).json();
assert.equal(Object.keys(config).some(k=>/key|secret|token/i.test(k)),false);
console.log('PASS: sample integrity, invalid request, origin check, safe config');
if(process.argv.includes('--live')){
 for(const [intent,team] of [['cancel_order','orders'],['track_order','shipping'],['track_refund','refunds'],['payment_issue','payments']]){
  const sample=samples.find(s=>s.intent===intent&&s.split==='test');
  const response=await fetch(base+'/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:sample.text,sampleId:sample.id})});
  const events=(await response.text()).trim().split('\n').map(JSON.parse);
  const saved=events.find(e=>e.stage==='saved');
  assert.ok(saved,JSON.stringify(events));
  assert.equal(saved.run.results[0].team,team);
  assert.equal(saved.run.expected,intent);
  assert.ok(saved.run.results[0].costUsd>0);
  const history=await (await fetch(base+'/api/history')).json();
  assert.ok(history.runs.some(r=>r.id===saved.run.id));
  console.log('PASS:',intent,'→',team,'persisted');
 }
}
