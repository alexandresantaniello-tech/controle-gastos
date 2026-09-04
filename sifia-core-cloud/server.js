const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';
const startedAt = new Date().toISOString();

function json(res, code, body) {
  res.writeHead(code, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(body));
}

const server = http.createServer((req,res) => {
  const requestId = crypto.randomUUID();
  if (req.method === 'GET' && req.url === '/health') {
    return json(res,200,{service:'sifia-core-cloud',status:'ok',startedAt,requestId});
  }
  if (req.method === 'GET' && req.url === '/') {
    return json(res,200,{service:'sifia-core-cloud',role:'24x7 orchestration layer',requestId});
  }
  return json(res,404,{error:'not_found',requestId});
});

server.listen(PORT,HOST,()=>console.log(`sifia-core-cloud listening on ${HOST}:${PORT}`));
