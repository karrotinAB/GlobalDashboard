// mem 근태 자동 가져오기 (서버에서만 — 아이디·비밀번호는 Firebase 비밀값 저장소에, 사이트로는 절대 안 내려감)
//
// 하는 일은 딱 두 가지: ① mem 로그인 ② 부서 근태 현황 읽기. 다른 화면은 열지 않음.
//
// 설정 (비밀번호 아님, Firestore 콘솔 > secrets > mem 문서):
//   loginUrl        로그인 요청 주소 (F12 > 네트워크에서 로그인 버튼을 눌렀을 때 나가는 요청)
//                   예: https://(mem 주소)/…/login.json
//   idField         아이디 칸 이름        (예: loginId)
//   pwField         비밀번호 칸 이름      (예: loginPw)
//   loginFormat     (선택) json 또는 form — 주소가 .json 으로 끝나면 기본 json
//   loginPageUrl    (선택) 로그인 화면 주소 — 숨은 보안 값(csrf)을 먼저 받아야 할 때
//   csrfField       (선택) 그 숨은 칸 이름
//   extra           (선택) 로그인에 같이 보내는 칸들, 예: {"auto_login":"N"}
//   attendanceUrl   부서 근태 현황 요청 주소 ({date} = 2026-11-11, {dateDot} = 2026.11.11 로 바뀜)
//   attendanceMethod (선택) GET 또는 POST (기본 GET)
//   attendanceBody  (선택) POST 일 때 보내는 내용 (JSON 글자), 예: {"attend_date":"{dateDot}"}
//   attendanceFormat (선택) json 또는 form — POST 는 기본 json
// 비밀값 (cmd 에서 한 번): npx firebase-tools functions:secrets:set MEM_ID / MEM_PASSWORD

import * as cheerio from 'cheerio';

const t = (s) => (s || '').replace(/\s+/g, ' ').trim();
const fill = (s, date) => String(s ?? '').replaceAll('{date}', date).replaceAll('{dateDot}', date.replaceAll('-', '.'));

/** 아주 단순한 쿠키 보관함 (로그인 세션 유지용) */
class Jar {
  constructor() {
    this.c = new Map();
  }
  take(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    for (const line of list) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.c.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header() {
    return [...this.c].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

/** 쿠키를 들고 요청 (리다이렉트도 쿠키를 챙기며 따라감) */
async function go(jar, url, init = {}, fetchImpl = fetch, hops = 0) {
  const res = await fetchImpl(url, {
    ...init,
    redirect: 'manual',
    headers: { 'User-Agent': 'Mozilla/5.0 (GlobalDashboard attendance sync)', ...(init.headers ?? {}), Cookie: jar.header() },
  });
  jar.take(res);
  const loc = res.headers.get('location');
  if (res.status >= 300 && res.status < 400 && loc && hops < 6) return go(jar, new URL(loc, url).toString(), { method: 'GET' }, fetchImpl, hops + 1);
  return res;
}

/** 응답 모양만 (칸 이름·종류, 실제 값은 안 담음) — 실패 원인 확인용 */
export function shapeOf(text, depth = 0) {
  let v;
  try {
    v = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    const s = String(text);
    const tags = [...new Set((s.match(/<([a-z][a-z0-9]*)[^>]*class="([^"]+)"/gi) ?? []).slice(0, 8).map((m) => m.replace(/<([a-z0-9]+)[^>]*class="([^"]+)".*/i, '$1.$2')))];
    return `글자 ${s.length}자${tags.length ? `, 태그: ${tags.join(' ')}` : ''}`;
  }
  const f = (x, d) => {
    if (Array.isArray(x)) return `[${x.length}개${x.length && d < 3 ? ` ${f(x[0], d + 1)}` : ''}]`;
    if (x && typeof x === 'object') return d >= 3 ? '{…}' : `{${Object.entries(x).slice(0, 15).map(([k, y]) => `${k}:${f(y, d + 1)}`).join(', ')}}`;
    if (typeof x === 'string') return x.includes('<') ? `html${x.length}` : x.length > 24 ? `글자${x.length}` : 'str';
    return typeof x;
  };
  return f(v, depth);
}

/** 부서 근태 현황 HTML → 줄 목록 (확장 프로그램 mem.js 와 같은 규칙) */
export function parseAttendance(html) {
  // JSON 으로 감싸져 오면 그 안에서 근태 목록 HTML 이 든 글자를 찾아 꺼냄
  let body = html;
  if (/^\s*[{[]/.test(html)) {
    try {
      const find = (v) => (typeof v === 'string' ? (v.includes('user_gubn') ? v : null) : v && typeof v === 'object' ? Object.values(v).map(find).find(Boolean) ?? null : null);
      body = find(JSON.parse(html)) ?? html;
    } catch {
      /* 그대로 */
    }
  }
  const $ = cheerio.load(body);
  const rows = [];
  $('li.user_gubn').each((_, li) => {
    const c = $(li).children();
    if (c.length < 2) return;
    const times = $(c[0]).find('span').filter((_, s) => /\d{1,2}:\d{2}/.test($(s).text()) || $(s).children().length === 0);
    const bold = $(c[1]).find('.bold').first();
    const name = t(bold.contents().first().text());
    if (!name) return;
    const extra = c[2] ? $(c[2]).find('span') : [];
    rows.push({
      name,
      start: t($(times[0]).text()),
      end: t($(times[1]).text()),
      status: t($(c[1]).children().eq(1).text()),
      period: t(extra[1] ? $(extra[1]).text() : ''),
    });
  });
  return rows;
}

/** 로그인 → 부서 근태 현황 → 줄 목록 */
export async function fetchMemRows(cfg, id, pw, date, fetchImpl = fetch) {
  for (const k of ['loginUrl', 'idField', 'pwField', 'attendanceUrl']) if (!cfg[k]) throw new Error(`secrets/mem 문서에 ${k} 칸이 없어요`);
  const jar = new Jar();
  const form = new URLSearchParams();
  if (cfg.loginPageUrl) {
    const page = await go(jar, cfg.loginPageUrl, { method: 'GET' }, fetchImpl);
    const html = await page.text();
    if (cfg.csrfField) {
      const v = cheerio.load(html)(`input[name="${cfg.csrfField}"]`).attr('value');
      if (v) form.set(cfg.csrfField, v);
    }
  }
  const extra = typeof cfg.extra === 'string' ? JSON.parse(cfg.extra || '{}') : cfg.extra ?? {};
  for (const [k, v] of Object.entries(extra)) form.set(k, String(v));
  form.set(cfg.idField, id);
  form.set(cfg.pwField, pw);
  // mem 은 로그인을 JSON 으로 보냄 ({"loginId":"…","loginPw":"…"})
  const asJson = (cfg.loginFormat ?? (/\.json(\?|$)/.test(cfg.loginUrl) ? 'json' : 'form')) === 'json';
  const login = await go(
    jar,
    cfg.loginUrl,
    asJson
      ? { method: 'POST', headers: { 'Content-Type': 'application/json;charset=UTF-8', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify(Object.fromEntries(form)) }
      : { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() },
    fetchImpl,
  );
  if (login.status >= 400) throw new Error(`로그인 실패 (HTTP ${login.status})`);
  const loginText = await login.text().catch(() => '');
  const loginInfo = `로그인 응답 ${login.status} ${shapeOf(loginText)}, 쿠키: ${[...jar.c.keys()].join(',') || '없음'}`;
  // JSON 응답에 실패 표시가 있으면 그 메시지로 (비밀번호 틀림 등)
  try {
    const j = JSON.parse(loginText);
    const failed = j && (j.success === false || j.result === false || j.ok === false || /fail|error|denied/i.test(String(j.status ?? j.resultCode ?? j.code ?? '')));
    if (failed) throw new Error(`로그인 실패: ${String(j.message ?? j.msg ?? j.resultMsg ?? j.error ?? '아이디·비밀번호 확인').slice(0, 120)}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('로그인 실패')) throw e;
  }

  const method = String(cfg.attendanceMethod || 'GET').toUpperCase();
  const bodyCfg = typeof cfg.attendanceBody === 'string' ? JSON.parse(cfg.attendanceBody || '{}') : cfg.attendanceBody ?? {};
  // 글자 안의 {date}/{dateDot} 만 오늘 날짜로 (null 같은 값은 그대로)
  const fillDeep = (v) => (typeof v === 'string' ? fill(v, date) : Array.isArray(v) ? v.map(fillDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillDeep(x)])) : v);
  const filled = fillDeep(bodyCfg);
  const json = method === 'POST' && (cfg.attendanceFormat ?? 'json') === 'json';
  const body = method !== 'POST' ? undefined : json ? JSON.stringify(filled) : new URLSearchParams(Object.fromEntries(Object.entries(filled).map(([k, v]) => [k, String(v ?? '')]))).toString();
  const res = await go(
    jar,
    fill(cfg.attendanceUrl, date),
    {
      method,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        ...(method === 'POST' ? { 'Content-Type': json ? 'application/json;charset=UTF-8' : 'application/x-www-form-urlencoded' } : {}),
      },
      body,
    },
    fetchImpl,
  );
  const html = await res.text();
  if (res.status >= 400) throw new Error(`근태 화면을 못 열었어요 (HTTP ${res.status})`);
  const rows = parseAttendance(html);
  if (!rows.length) {
    const info = `근태 응답 ${res.status} ${res.headers.get('content-type') ?? ''} ${shapeOf(html)} / ${loginInfo}`;
    throw new Error(
      (/password|비밀번호|login|로그인/i.test(html) ? '로그인이 안 된 것 같아요' : '근태 목록(li.user_gubn)을 못 찾았어요') + ` — ${info}`.slice(0, 600),
    );
  }
  return rows;
}

/** 대시보드에 등록된 이름만 골라 공용 근태함 기록으로 (확장 프로그램과 같은 규칙: 같거나, mem 이름이 대시보드 이름으로 끝나면) */
export function toRecords(rows, names, date) {
  const TIME = /^\d{1,2}:\d{2}$/;
  const now = new Date().toISOString();
  const out = new Map();
  for (const r of rows) {
    const n = names.find((x) => r.name === x) ?? names.find((x) => r.name.endsWith(x));
    if (!n) continue;
    out.set(n, {
      id: `${date}_${n}`,
      memberId: '',
      name: n,
      date,
      status: (r.status || '근무').slice(0, 20),
      start: TIME.test(r.start) ? r.start : undefined,
      end: TIME.test(r.end) ? r.end : undefined,
      period: r.period ? r.period.slice(0, 40) : undefined,
      source: 'mem',
      updatedAt: now,
    });
  }
  return [...out.values()];
}
