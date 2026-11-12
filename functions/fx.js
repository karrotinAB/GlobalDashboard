// 한국은행 ECOS 환율 (일별 · 매매기준율): 통계표 731Y001 '주요국 통화의 대원화환율'
// 인증키: secrets/ecos 문서 apiKey (설정 > 판매 데이터 API 에서 관리자가 저장, 사이트에서는 못 읽음)
// 결과: fxRates/{통화}_{YYYY-MM} = { cur, month, days: { '02': 1원 기준 환율, … }, item, unit, at }
//   '100엔' 처럼 100 단위로 나오는 통화는 1 단위로 나눠서 저장 → 금액 × 환율 = 원화
const ECOS = 'https://ecos.bok.or.kr/api';
const TABLE = '731Y001';

// ECOS 항목 이름에서 찾을 말 (통화 코드 → 이름 일부)
const NAMES = {
  USD: ['미국달러'], JPY: ['일본'], EUR: ['유로'], CNY: ['위안'], GBP: ['영국'], CAD: ['캐나다'], AUD: ['호주'],
  CHF: ['스위스'], HKD: ['홍콩'], SGD: ['싱가포르'], TWD: ['대만'], THB: ['태국'], MYR: ['말레이시아'], IDR: ['인도네시아'], PHP: ['필리핀'],
  VND: ['베트남'], INR: ['인도루피'], MNT: ['몽골'], KZT: ['카자흐스탄'], RUB: ['러시아'], MXN: ['멕시코'], BRL: ['브라질'], NZD: ['뉴질랜드'],
  SEK: ['스웨덴'], NOK: ['노르웨이'], DKK: ['덴마크'], PLN: ['폴란드'], TRY: ['튀르키예', '터키'], AED: ['아랍에미리트', 'UAE'], SAR: ['사우디'],
  UZS: ['우즈베키스탄'], KHR: ['캄보디아'], MMK: ['미얀마'], PKR: ['파키스탄'], BDT: ['방글라데시'], CZK: ['체코'], HUF: ['헝가리'], ILS: ['이스라엘'],
  EGP: ['이집트'], ZAR: ['남아프리카', '남아공'], CLP: ['칠레'], COP: ['콜롬비아'], PEN: ['페루'], ARS: ['아르헨티나'], QAR: ['카타르'], KWD: ['쿠웨이트'],
  BHD: ['바레인'], JOD: ['요르단'], LKR: ['스리랑카'], NPR: ['네팔'], BND: ['브루나이'], MOP: ['마카오'],
};
export const FX_CURRENCIES = Object.keys(NAMES);

const ymd = (iso) => iso.replaceAll('-', '');

async function ecos(path, fetchImpl) {
  const res = await fetchImpl(`${ECOS}/${path}`);
  if (!res.ok) throw new Error(`ECOS HTTP ${res.status}`);
  const body = await res.json();
  const key = Object.keys(body).find((k) => body[k]?.row);
  if (key) return body[key].row;
  const msg = body?.RESULT?.MESSAGE ?? JSON.stringify(body).slice(0, 120);
  if (/해당하는 데이터가 없습니다|INFO-200/.test(JSON.stringify(body))) return [];
  throw new Error(`ECOS: ${msg}`);
}

let itemCache = null;
/** 통화 코드 → ECOS 항목 { code, name, per } (per: 100엔 → 100) */
export async function ecosItem(key, cur, fetchImpl = fetch) {
  if (!itemCache) itemCache = await ecos(`StatisticItemList/${encodeURIComponent(key)}/json/kr/1/500/${TABLE}`, fetchImpl);
  const words = NAMES[cur];
  if (!words) return null;
  const hit = itemCache.find((r) => {
    const n = String(r.ITEM_NAME ?? '');
    return words.some((w) => n.includes(w));
  });
  if (!hit) return null;
  const name = String(hit.ITEM_NAME);
  const per = Number(name.match(/\((\d+)/)?.[1] ?? 1) || 1;
  return { code: String(hit.ITEM_CODE), name, per };
}

/** 한 달 일별 환율 (원 / 1 단위). 주말·공휴일은 없음 */
export async function monthRates(key, cur, month, fetchImpl = fetch) {
  if (cur === 'KRW') return null;
  const item = await ecosItem(key, cur, fetchImpl);
  if (!item) throw new Error(`${cur}: ECOS 환율표에서 이 통화를 못 찾았어요`);
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const rows = await ecos(`StatisticSearch/${encodeURIComponent(key)}/json/kr/1/100/${TABLE}/D/${ymd(`${month}-01`)}/${ymd(`${month}-${String(last).padStart(2, '0')}`)}/${item.code}`, fetchImpl);
  const days = {};
  for (const r of rows) {
    const t = String(r.TIME ?? '');
    const v = Number(String(r.DATA_VALUE ?? '').replace(/,/g, ''));
    if (t.length === 8 && Number.isFinite(v) && v > 0) days[t.slice(6, 8)] = Math.round((v / item.per) * 1e6) / 1e6;
  }
  return { days, item: item.code, unit: item.name };
}

/** 여러 통화 · 여러 달 → fxRates 에 저장 */
export async function syncFx(db, key, currencies, months, fetchImpl = fetch) {
  const errors = [];
  let saved = 0;
  for (const cur of [...new Set(currencies)].filter((c) => c && c !== 'KRW')) {
    for (const month of months) {
      try {
        const r = await monthRates(key, cur, month, fetchImpl);
        if (!r) continue;
        await db.doc(`fxRates/${cur}_${month}`).set({ cur, month, ...r, at: new Date().toISOString() });
        saved++;
      } catch (e) {
        errors.push(`${cur} ${month}: ${e.message}`);
      }
    }
  }
  return { saved, errors: errors.slice(0, 10) };
}
