// 키 상태 확인 — 값은 절대 돌려주지 않고 「값 있음 / 비어 있음」만 알려 준다
import { send, readKey } from './_lib/http.js';
import { keyStatus } from './_lib/ai.js';
import { chunkCount } from './_lib/chunks.js';

export default function handler(req, res) {
  const law = ['LAW_OC', 'LAWMAKING_OC'].map((name) => ({ name, filled: !!readKey(name).value }));
  send(res, 200, { ai: keyStatus(), law, chunks: chunkCount() });
}
