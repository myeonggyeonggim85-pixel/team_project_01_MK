// 로컬 실행용 서버 — public(화면) + /api/*(서버 함수)를 한 주소로 띄운다.
// 실행: node --env-file=.env server.js   (또는 npm start)
// 배포(Vercel)에서는 이 파일을 쓰지 않고 public 과 api 를 Vercel 이 직접 연결한다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const API = new Set(['extract', 'ask', 'law', 'status']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const m = url.pathname.match(/^\/api\/([a-z]+)\/?$/);
  if (m) {
    if (!API.has(m[1])) { res.statusCode = 404; return res.end('없는 API'); }
    try {
      const mod = await import(pathToFileURL(path.join(ROOT, 'api', `${m[1]}.js`)).href);
      return await mod.default(req, res);
    } catch (e) {
      console.error(`[api/${m[1]}]`, e);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ error: '서버 오류' }));
    }
  }
  // 정적 파일 — public 밖으로 나가지 못하게 막는다
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC)) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('찾을 수 없음'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`길잡이 실행 중: http://localhost:${PORT}`);
});
