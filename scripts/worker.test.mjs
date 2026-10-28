import test from "node:test";
import assert from "node:assert/strict";
import worker from "../dist/server/index.js";

const origin="https://demo.example";
function request(path, body, ip="198.51.100.1") {
  return new Request(origin+path,{method:body?"POST":"GET",headers:{"Origin":origin,"Content-Type":"application/json","CF-Connecting-IP":ip,...(body?{}:{})},...(body?{body:JSON.stringify(body)}:{})});
}

test("public page and textbook index never expose the uploaded PDF",async()=>{
  const html=await worker.fetch(request("/"),{}).then(r=>r.text());
  assert.match(html,/熱力学ノート/); assert.doesNotMatch(html,/\/materials\/textbook\.pdf/);
  const index=await worker.fetch(request("/materials.json"),{}).then(r=>r.json());
  assert.ok(index.entries.length>0); assert.equal("pdfPage" in index.entries[0],false);
});

test("session reports server configuration without returning secrets",async()=>{
  const result=await worker.fetch(request("/api/session"),{}).then(r=>r.json());
  assert.equal(result.ready,false); assert.ok(result.token.length>20);
  assert.equal(JSON.stringify(result).includes("GEMINI_API_KEY"),false);
});

test("normal solve then opted-in search use separate single Gemini calls",async t=>{
  let calls=[]; const prior=globalThis.fetch;
  t.after(()=>{globalThis.fetch=prior;});
  globalThis.fetch=async (_url,init)=>{
    const payload=JSON.parse(init.body); calls.push(payload);
    if(payload.tools) return Response.json({candidates:[{finishReason:"STOP",content:{parts:[{text:"COP is heating output divided by work input."}]},groundingMetadata:{webSearchQueries:["COP definition"],groundingChunks:[{web:{uri:"https://example.org/cop",title:"COP source"}}],groundingSupports:[{segment:{text:"COP is heating output divided by work input."},groundingChunkIndices:[0]}]}}]});
    return Response.json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({coverage:"not_found",problem_reading:"COP",approach:"Use its definition.",feedback:"Your thought is not provided.",answer:"COP = Qh / W.",limitations:"The textbook index has no COP entry.",source_ids:[],recommendations:[]})}]}}]});
  };
  const env={GEMINI_API_KEY:"test-only-secret",SESSION_SECRET:"test-signing-secret",GEMINI_MODEL:"mock-model"};
  const base={question:"COP?",reasoning:"",images:[]};
  const first=await worker.fetch(request("/api/ask",base,"198.51.100.2"),env).then(r=>r.json());
  assert.ok(first.fallback_token); assert.equal(first.answer,"COP = Qh / W.");
  const second=await worker.fetch(request("/api/ask",{...base,allow_external:true,fallback_token:first.fallback_token},"198.51.100.2"),env).then(r=>r.json());
  assert.equal(calls.length,2); assert.deepEqual(calls[1].tools,[{google_search:{}}]);
  assert.equal(second.external_sources[0].url,"https://example.org/cop"); assert.ok(second.citations.length);
  assert.equal(JSON.stringify(second).includes("test-only-secret"),false);
});

test("foreign origins are rejected before any model call",async()=>{
  const req=new Request(origin+"/api/ask",{method:"POST",headers:{Origin:"https://bad.example","Content-Type":"application/json"},body:JSON.stringify({question:"q"})});
  const r=await worker.fetch(req,{GEMINI_API_KEY:"unused",SESSION_SECRET:"unused"});
  assert.equal(r.status,403);
});

test("follow-up sends history and binds external permission to the same history",async t=>{
  const prior=globalThis.fetch; t.after(()=>globalThis.fetch=prior);
  let sent,calls=0;
  globalThis.fetch=async (_url,init)=>{
    calls++;sent=JSON.parse(init.body);
    return Response.json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({coverage:"not_found",problem_reading:"",approach:"Use a ratio.\n[[式: η = Pout / Pin]]",feedback:"",answer:"Divide by efficiency.",limitations:"",source_ids:[],recommendations:[]})}]}}]});
  };
  const env={GEMINI_API_KEY:"mock",SESSION_SECRET:"mock-sign"};
  const base={question:"Why divide?",history:[{question:"Motor efficiency?",answer:"Pin = Pout / η"}]};
  const result=await worker.fetch(request("/api/ask",base,"198.51.100.8"),env).then(r=>r.json());
  assert.deepEqual(JSON.parse(sent.contents[0].parts[0].text).conversation_history,base.history);
  assert.match(result.approach,/\[\[式:/);
  assert.ok(result.material_title);
  const changed=await worker.fetch(request("/api/ask",{...base,history:[],allow_external:true,fallback_token:result.fallback_token},"198.51.100.8"),env);
  assert.equal(changed.status,403);assert.equal(calls,1);
  const long=await worker.fetch(request("/api/ask",{question:"q",history:Array(4).fill(base.history[0])},"198.51.100.9"),env);
  assert.equal(long.status,400);assert.equal(calls,1);
});
