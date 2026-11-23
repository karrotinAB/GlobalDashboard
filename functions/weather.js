// 날씨: 기상청 초단기예보 (공공데이터포털 VilageFcstInfoService_2.0 / getUltraSrtFcst)
//   인증키: Firestore 콘솔 > secrets 컬렉션 > weather 문서 > apiKey 칸 (공공데이터포털 '일반 인증키')
//           (선택) nx · ny 칸: 예보 격자 (없으면 사무실 서초구 반포대로 61 · 125)
//   결과: weatherNow/main = { temp, sky, pty, rain: { at, kind } | null, now: kind | null, hours: [...], at }
const URL_BASE = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst';

const pad = (n) => String(n).padStart(2, '0');
/** 지금 쓸 수 있는 발표 시각: 매시 30분 발표 · 45분쯤부터 받을 수 있음 */
export function baseOf(now = new Date()) {
  const k = new Date(now.getTime() + 9 * 3600000); // 한국 시간
  if (k.getUTCMinutes() < 45) k.setUTCHours(k.getUTCHours() - 1);
  return { date: `${k.getUTCFullYear()}${pad(k.getUTCMonth() + 1)}${pad(k.getUTCDate())}`, time: `${pad(k.getUTCHours())}30` };
}
// PTY 강수형태: 0 없음 · 1 비 · 2 비/눈 · 3 눈 · 5 빗방울 · 6 빗방울눈날림 · 7 눈날림
const ptyKind = (v) => (['1', '2', '5', '6'].includes(String(v)) ? (String(v) === '2' || String(v) === '6' ? 'sleet' : 'rain') : ['3', '7'].includes(String(v)) ? 'snow' : null);

export async function weatherCfg(db) {
  const d = (await db.doc('secrets/weather').get()).data() ?? {};
  const kf = Object.keys(d).find((k) => k.replace(/[_\s-]/g, '').toLowerCase() === 'apikey');
  const key = kf ? String(d[kf]).trim() : '';
  if (!key) throw new Error('secrets/weather 문서에 apiKey 칸이 없어요');
  return { key, nx: Number(d.nx) || 61, ny: Number(d.ny) || 125 };
}

export async function fetchWeather(cfg, { fetchImpl = fetch, now = new Date() } = {}) {
  // 최신 발표가 아직 안 나왔으면 (기상청이 몇 분 늦을 때) 한 시간 전 발표로
  try {
    return await fetchAt(cfg, baseOf(now), fetchImpl);
  } catch (e) {
    try {
      return await fetchAt(cfg, baseOf(new Date(now.getTime() - 3600000)), fetchImpl);
    } catch {
      throw e;
    }
  }
}
async function fetchAt(cfg, b, fetchImpl) {
  // 인증키: 이미 % 로 바뀐 키(Encoding)면 그대로, 아니면(Decoding) 주소용으로 바꿔서
  const key = /%[0-9A-Fa-f]{2}/.test(cfg.key) ? cfg.key : encodeURIComponent(cfg.key);
  const url = `${URL_BASE}?serviceKey=${key}&pageNo=1&numOfRows=100&dataType=JSON&base_date=${b.date}&base_time=${b.time}&nx=${cfg.nx}&ny=${cfg.ny}`;
  const res = await fetchImpl(url);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`기상청: JSON 이 아님 (${text.slice(0, 120)})`); // 키가 틀리면 XML 에러가 옴
  }
  const head = body?.response?.header;
  if (head && head.resultCode !== '00') throw new Error(`기상청 ${head.resultCode} ${head.resultMsg}`);
  const items = body?.response?.body?.items?.item ?? [];
  // 시각별로 모으기
  const by = new Map();
  for (const it of items) {
    const t = `${it.fcstDate}${it.fcstTime}`;
    if (!by.has(t)) by.set(t, { t });
    by.get(t)[it.category] = it.fcstValue;
  }
  const hours = [...by.values()].sort((a, b2) => a.t.localeCompare(b2.t)).map((h) => ({ at: `${h.t.slice(0, 4)}-${h.t.slice(4, 6)}-${h.t.slice(6, 8)}T${h.t.slice(8, 10)}:${h.t.slice(10, 12)}`, temp: Number(h.T1H), sky: Number(h.SKY), kind: ptyKind(h.PTY), rn: h.RN1 }));
  if (!hours.length) throw new Error('기상청: 예보가 비어 있어요');
  const first = hours[0];
  const next = hours.find((h) => h.kind);
  return { temp: first.temp, sky: first.sky, now: first.kind, rain: next ? { at: next.at, kind: next.kind } : null, hours, base: `${b.date} ${b.time}` };
}

export async function syncWeather(db, opts = {}) {
  const ref = db.doc('weatherNow/main');
  const tried = new Date().toISOString();
  try {
    const cfg = await weatherCfg(db);
    const w = await fetchWeather(cfg, opts);
    await ref.set({ ...w, at: tried, triedAt: tried, error: '' });
    return w;
  } catch (e) {
    // 못 받았어도 받아 둔 날씨는 그대로 두고, 언제 왜 못 받았는지만 적어 둠 (설정 › 헤더 설정에서 보임)
    await ref.set({ triedAt: tried, error: String(e.message ?? e) }, { merge: true }).catch(() => {});
    throw e;
  }
}
