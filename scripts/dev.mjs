import {createServer} from "node:http";
import worker from "../dist/server/index.js";
const port=Number(process.env.PORT||8787);
if(!Number.isInteger(port)||port<1024||port>65535) throw new Error("Invalid PORT");
// Loopback only. Production uses the Worker runtime.
const server=createServer(async (req,res)=>{
  try {
    const chunks=[];let size=0;
    for await(const chunk of req){
      size+=chunk.length;
      if(size>28*1024*1024){res.writeHead(413);res.end("Request too large");return;}
      chunks.push(chunk);
    }
    const request=new Request(new URL(req.url,"http://"+req.headers.host),{
      method:req.method,headers:req.headers,
      ...(["GET","HEAD"].includes(req.method)?{}:{body:Buffer.concat(chunks)})
    });
    const response=await worker.fetch(request,{
      GEMINI_API_KEY:process.env.GEMINI_API_KEY,
      SESSION_SECRET:process.env.SESSION_SECRET,
      GEMINI_MODEL:process.env.GEMINI_MODEL
    });
    res.writeHead(response.status,Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {res.writeHead(500,{"content-type":"text/plain"});res.end("Local server error");}
});
server.listen(port,"127.0.0.1",()=>console.log("Local: http://127.0.0.1:"+port));
process.on("SIGINT",()=>server.close(()=>process.exit(0)));
