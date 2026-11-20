// 휴대폰 알림 (웹 푸시): pushTokens/{토큰} = { email } 로 저장된 기기에 보냄
//   보고방: 새 보고 · 답글 · 이모티콘 반응 / 전도금: 마감 전날 오전 10시
import { getMessaging } from 'firebase-admin/messaging';

const low = (s) => String(s ?? '').trim().toLowerCase();

/** 이메일들에게 알림 (켜 둔 기기 전부). 없어진 토큰은 지움 */
export async function sendPush(db, emails, msg) {
  const list = [...new Set(emails.map(low).filter(Boolean))];
  if (!list.length) return { sent: 0 };
  const tokens = [];
  for (let i = 0; i < list.length; i += 30) {
    const snap = await db.collection('pushTokens').where('email', 'in', list.slice(i, i + 30)).get();
    snap.docs.forEach((d) => tokens.push(d.id));
  }
  return sendToTokens(db, tokens, msg);
}

/** 알림 켠 모든 기기 */
export async function sendPushAll(db, msg) {
  const snap = await db.collection('pushTokens').get();
  return sendToTokens(db, snap.docs.map((d) => d.id), msg);
}

async function sendToTokens(db, tokens, { title, body = '', link = './#/home', tag = '' }) {
  let sent = 0;
  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    const res = await getMessaging().sendEachForMulticast({
      tokens: chunk,
      webpush: { headers: { Urgency: 'high', TTL: '86400' }, data: { title, body: String(body).slice(0, 180), link, tag } },
    });
    sent += res.successCount;
    // 앱을 지웠거나 알림을 끈 기기 → 토큰 정리
    await Promise.all(
      res.responses.map((r, j) =>
        !r.success && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r.error?.code ?? '') ? db.doc(`pushTokens/${chunk[j]}`).delete().catch(() => {}) : null,
      ),
    );
  }
  return { sent };
}

const needsCheck = (r, k) => !Array.isArray(r.to) || r.to.includes(k);

/** 새 보고를 받을 사람: 그 보고방 사람들 + 확인자로 지정된 팀장님 · 이사님 (쓴 사람 빼고) */
export async function reportAudience(db, r) {
  const roles = (await db.collection('roles').get()).docs.map((d) => ({ email: low(d.id), level: d.get('level'), team: d.get('team') ?? '2' }));
  const out = roles.filter((x) => {
    if (x.level === 'lead') return needsCheck(r, 'lead');
    if (x.level === 'director') return needsCheck(r, 'director');
    if (r.team === 'trade') return x.level === 'trade';
    return (x.level === 'member' || x.level === 'admin') && String(x.team) === String(r.team);
  });
  return out.map((x) => x.email).filter((e) => e !== low(r.authorEmail));
}

const link = (id) => `./#/reports?r=${encodeURIComponent(id)}`;
const cut = (s, n) => (String(s ?? '').length > n ? `${String(s).slice(0, n)}…` : String(s ?? ''));
const plain = (html) => String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export async function onReportCreated(db, id, r) {
  const to = await reportAudience(db, r);
  return sendPush(db, to, { title: `📑 새 보고 · ${r.authorName ?? ''}`, body: `${r.title}${plain(r.body) ? ` — ${cut(plain(r.body), 60)}` : ''}`, link: link(id), tag: `rp-${id}` });
}

/** 바뀐 보고: 새 답글 · 새 반응만 골라서 알림 */
export async function onReportUpdated(db, id, before, after) {
  const was = new Map((before.replies ?? []).map((x) => [x.id, x]));
  const jobs = [];
  for (const rp of after.replies ?? []) {
    const old = was.get(rp.id);
    if (!old) {
      // 새 답글 → 보고 쓴 사람 + (대댓글이면) 원래 댓글 쓴 사람
      const parent = rp.parentId ? (after.replies ?? []).find((x) => x.id === rp.parentId) : null;
      const to = [after.authorEmail, parent?.email].filter((e) => e && low(e) !== low(rp.email));
      if (to.length) jobs.push(sendPush(db, to, { title: `💬 ${rp.name}님이 ${parent ? '댓글에 답글을' : '답글을'} 달았어요`, body: `${cut(after.title, 30)} — ${cut(rp.text, 70)}`, link: link(id), tag: `rp-${id}-${rp.id}` }));
      continue;
    }
    // 새 반응 → 그 댓글 쓴 사람
    for (const [emoji, people] of Object.entries(rp.reactions ?? {})) {
      const before = new Set((old.reactions?.[emoji] ?? []).map((p) => low(p.email) || p.name));
      for (const p of people ?? []) {
        const key = low(p.email) || p.name;
        if (before.has(key) || !rp.email || low(rp.email) === low(p.email)) continue;
        jobs.push(sendPush(db, [rp.email], { title: `${emoji} ${p.name}님이 내 댓글에 반응했어요`, body: `${cut(after.title, 30)} — ${cut(rp.text, 60)}`, link: link(id), tag: `rx-${id}-${rp.id}` }));
      }
    }
  }
  await Promise.all(jobs);
}

/** 전도금 마감 전날 (14일 → 상반기 · 말일 전날 → 하반기). 오늘(한국 날짜) 해당하면 보냄 */
export async function pettyReminder(db, now = new Date()) {
  const k = new Date(now.getTime() + 9 * 3600000);
  const y = k.getUTCFullYear();
  const m = k.getUTCMonth() + 1;
  const d = k.getUTCDate();
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const half = d === 14 ? '상반기' : d === last - 1 ? '하반기' : null;
  if (!half) return { sent: 0, skipped: true };
  return sendPushAll(db, { title: `💰 ${m}월 ${half} 전도금 마감이 내일이에요!`, body: '눌러서 전도금을 기록해 주세요', link: './#/petty', tag: `petty-${y}-${m}-${half}` });
}

/** 무역사무: 새 업무(요청) 등록 → 무역사무 사람들 (등록한 사람 빼고) */
export async function onRequestCreated(db, id, r, team) {
  const roles = (await db.collection('roles').get()).docs.map((d) => ({ email: low(d.id), level: d.get('level') }));
  const by = low(r.createdByEmail || r.requesterEmail);
  const to = roles.filter((x) => x.level === 'trade' && x.email !== by).map((x) => x.email);
  const self = !r.team && !r.requesterId && !r.requesterEmail && !r.teamName;
  const side = r.teamName || (self ? '무역사무' : `${r.team || team}조`);
  const who = r.requesterName ? ` ${r.requesterName}` : '';
  return sendPush(db, to, { title: `📨 새 업무 · ${side}${who}`, body: `${r.priority ? `[${r.priority}] ` : ''}${cut(r.title, 80)}`, link: './#/twork', tag: `rq-${id}` });
}
