// 식단 일기 로컬 서버
// - diet 폴더의 정적 파일(index.html 등)을 제공
// - 식약처 식품영양성분DB(공공데이터포털) API를 대신 호출해 CORS 문제와 인증키 노출을 막음
// 실행: node server.js  (또는 start.bat 더블클릭)

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5500;
// 공공데이터포털 "식품의약품안전처_식품영양성분DB정보" — 활용신청 상세의 미리보기 주소와 같은 버전(03)이어야 함
const API_URL = 'https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo03/getFoodNtrCpntDbInq03';

// ---------- .env 읽기 ----------
function loadEnv() {
  try {
    const text = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* .env 없음 */ }
}
loadEnv();

// 공공데이터포털의 "Encoding" 키를 넣어도 동작하도록 한 번 디코딩 (URLSearchParams가 다시 인코딩함)
let SERVICE_KEY = (process.env.DATA_GO_KR_KEY || '').trim();
if (SERVICE_KEY.includes('%')) {
  try { SERVICE_KEY = decodeURIComponent(SERVICE_KEY); } catch { /* 그대로 사용 */ }
}

// ---------- 식약처 API ----------
// 응답 필드 (FoodNtrCpntDbInfo03 실제 응답으로 확인)
const FIELDS = {
  code: ['FOOD_CD'],
  name: ['FOOD_NM_KR'],
  group: ['DB_GRP_NM'], // 음식 / 가공식품 / 농축수산물 …
  category: ['FOOD_CAT1_NM'],
  maker: ['MAKER_NM'],
  base: ['SERVING_SIZE'], // 영양성분 함량 기준량 (예: 100g)
  servingRef: ['NUTRI_AMOUNT_SERVING'], // 1회 섭취참고량 (가공식품, 예: 30g)
  weight: ['Z10500'], // 식품중량 (음식은 1인분, 가공식품은 제품 전체 중량)
  kcal: ['AMT_NUM1'],
  protein: ['AMT_NUM3'],
  fat: ['AMT_NUM4'],
  carb: ['AMT_NUM6'],
  sugar: ['AMT_NUM7'],
  fiber: ['AMT_NUM8'],
  sodium: ['AMT_NUM13'],
  cholesterol: ['AMT_NUM23'],
  satfat: ['AMT_NUM24'],
  transfat: ['AMT_NUM25'],
};
const NUTRIENT_KEYS = ['kcal', 'carb', 'sugar', 'fiber', 'protein', 'fat', 'satfat', 'transfat', 'cholesterol', 'sodium'];

const pick = (item, key) => {
  for (const f of FIELDS[key]) {
    if (item[f] != null && String(item[f]).trim() !== '') return item[f];
  }
  return undefined;
};
const num = v => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const r2 = n => Math.round(n * 100) / 100;

// 앱 형식으로 변환: 영양성분은 기준량(base g) 당 값 그대로 전달
function normalize(item) {
  const base = num(pick(item, 'base')) || 100;
  const servingRef = num(pick(item, 'servingRef'));
  const weight = num(pick(item, 'weight'));
  const isDish = pick(item, 'group') === '음식';
  // 1회 제공량: 1회 섭취참고량 → (음식이면) 1인분 중량 → 기준량 순으로 사용
  let serving = base;
  let unit = '기준량';
  if (servingRef > 0) { serving = servingRef; unit = '1회 섭취참고량'; }
  else if (isDish && weight > 0 && weight <= 2000) { serving = weight; unit = '1인분'; }
  const maker = pick(item, 'maker');
  return {
    id: 'api:' + (pick(item, 'code') || pick(item, 'name')),
    name: String(pick(item, 'name') || '').trim(),
    // 같은 이름이 여러 개라 제조사 또는 분류·데이터 구분(품목대표/상용제품 등)을 함께 표시
    cat: maker && maker !== '해당없음'
      ? maker
      : [item.FOOD_CAT1_NM || item.DB_GRP_NM, item.DB_CLASS_NM].filter(Boolean).join(' · ') || '식약처',
    base,
    serving: r2(serving),
    unit,
    nutr: Object.fromEntries(NUTRIENT_KEYS.map(k => [k, r2(num(pick(item, k)))])),
  };
}

const AUTH_ERRORS = {
  '30': '이 API에 등록되지 않은 인증키예요 (활용신청·승인 상태를 확인하세요)',
  '31': '인증키 사용 기간이 만료됐어요',
  '22': '오늘 호출 한도를 넘었어요',
  '20': '서비스 접근이 거부됐어요',
};

function extractItems(data) {
  // 인증/권한 오류는 OpenAPI_ServiceResponse 형태로 옴
  const auth = data.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (auth) {
    throw new Error(AUTH_ERRORS[auth.returnReasonCode] || auth.returnAuthMsg || auth.errMsg || '인증 오류');
  }
  const root = data.response || data;
  const code = root.header?.resultCode;
  if (code && code !== '00' && code !== '0') {
    throw new Error(root.header.resultMsg || `오류 코드 ${code}`);
  }
  let items = root.body?.items ?? [];
  if (items && !Array.isArray(items)) items = items.item ?? [];
  if (!Array.isArray(items)) items = [items];
  return items;
}

async function callApi(q, rows = 30) {
  if (!SERVICE_KEY) throw new Error('인증키가 설정되지 않았어요 (.env 확인)');
  const url = new URL(API_URL);
  url.search = new URLSearchParams({
    serviceKey: SERVICE_KEY,
    pageNo: '1',
    numOfRows: String(rows),
    type: 'json',
    FOOD_NM_KR: q,
  });
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // 인증 오류 등은 XML/텍스트로 오는 경우가 많음
    const msg = text.match(/<(returnAuthMsg|resultMsg|errMsg)>([^<]+)</);
    throw new Error(msg ? msg[2] : `응답을 해석할 수 없어요 (HTTP ${res.status}) ${text.slice(0, 80)}`);
  }
}

const cache = new Map();
async function searchFoods(q) {
  if (cache.has(q)) return cache.get(q);
  // 검색어와 정확히 같은 이름 → 검색어로 시작하는 이름 → 짧은 이름 순
  const rank = f => (f.name === q ? 0 : f.name.startsWith(q) ? 1 : 2) * 1000 + f.name.length;
  const seen = new Set();
  const items = extractItems(await callApi(q)).map(normalize)
    .filter(f => {
      const sig = [f.name, f.cat, f.serving, ...Object.values(f.nutr)].join('|'); // 완전히 같은 항목은 하나만
      if (!f.name || seen.has(sig)) return false;
      seen.add(sig);
      return true;
    })
    .sort((a, b) => rank(a) - rank(b));
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  cache.set(q, items);
  return items;
}

// ---------- HTTP 서버 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res, pathname) {
  const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = path.resolve(ROOT, '.' + rel);
  const name = path.basename(file);
  if (!file.startsWith(ROOT + path.sep) || name.startsWith('.') || name === 'server.js') {
    res.writeHead(404); return res.end('Not found');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (pathname === '/api/status') {
      return sendJson(res, 200, { enabled: Boolean(SERVICE_KEY) });
    }
    if (pathname === '/api/foods') {
      const q = (searchParams.get('q') || '').trim().slice(0, 40);
      if (!q) return sendJson(res, 200, { items: [] });
      return sendJson(res, 200, { items: await searchFoods(q) });
    }
    if (pathname === '/api/raw') {
      // 응답 형식 확인용: 원본 응답 앞부분을 그대로 보여줌
      const q = (searchParams.get('q') || '김치찌개').trim();
      const data = await callApi(q, 2);
      return sendJson(res, 200, data);
    }
    serveStatic(req, res, pathname);
  } catch (err) {
    sendJson(res, 502, { error: err.name === 'TimeoutError' ? '응답 시간 초과' : err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`식단 일기 실행 중: ${url}`);
  console.log(SERVICE_KEY ? '식약처 API: 인증키 확인됨' : '식약처 API: 인증키 없음 (.env에 DATA_GO_KR_KEY를 넣어주세요)');
  console.log('종료하려면 Ctrl+C');
  if (process.argv.includes('--open') && process.platform === 'win32') exec(`start "" "${url}"`);
});
