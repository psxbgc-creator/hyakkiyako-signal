// Minimal signaling relay for hyakki-yako 2P co-op.
// Just passes two text blobs (A's offer, B's answer) through a room number.
// No game data ever touches this server — once both sides have the blobs,
// they talk directly to each other (P2P).
//
//   POST /room        A's connection string in the body -> returns a room number
//   GET  /room/1234   B fetches that string
//   POST /room/1234   B's response is uploaded
//   GET  /room/1234/a A fetches that response
//
// Zero dependencies — just Node's built-in http module.
const http = require('http');

const PORT = process.env.PORT || 8080;
const ROOM_TTL_MS = 10 * 60 * 1000; // rooms older than this are swept away
const rooms = new Map(); // code -> { offer, answer, createdAt }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 200000) req.destroy(); // guard against abuse
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function newRoomCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms.has(code));
  return code;
}

function sweep() {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (now - r.createdAt > ROOM_TTL_MS) rooms.delete(code);
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  sweep();
  const url = req.url.replace(/\/+$/, '') || '/';

  try {
    // POST /room  -> create room with A's offer, return the room code
    if (req.method === 'POST' && url === '/room') {
      const body = await readBody(req);
      if (!body) { res.writeHead(400); res.end('missing body'); return; }
      const code = newRoomCode();
      rooms.set(code, { offer: body, answer: null, createdAt: Date.now() });
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(code);
      return;
    }

    // GET /room/1234  -> B fetches A's offer
    let m = url.match(/^\/room\/(\d+)$/);
    if (req.method === 'GET' && m) {
      const r = rooms.get(m[1]);
      if (!r) { res.writeHead(404); res.end('room not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(r.offer);
      return;
    }

    // POST /room/1234  -> B uploads the answer
    if (req.method === 'POST' && m) {
      const r = rooms.get(m[1]);
      if (!r) { res.writeHead(404); res.end('room not found'); return; }
      const body = await readBody(req);
      if (!body) { res.writeHead(400); res.end('missing body'); return; }
      r.answer = body;
      res.writeHead(200); res.end('ok');
      return;
    }

    // GET /room/1234/a  -> A polls for B's answer
    m = url.match(/^\/room\/(\d+)\/a$/);
    if (req.method === 'GET' && m) {
      const r = rooms.get(m[1]);
      if (!r) { res.writeHead(404); res.end('room not found'); return; }
      if (!r.answer) { res.writeHead(204); res.end(); return; } // not yet answered
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(r.answer);
      return;
    }

    res.writeHead(404);
    res.end('not found');
  } catch (e) {
    res.writeHead(500);
    res.end('server error');
  }
});

server.listen(PORT, () => console.log('Signaling server listening on port ' + PORT));
