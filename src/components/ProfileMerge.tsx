// 관리자 설정 › 👥 사람 정보 합치기
//   모든 대시보드(1~3조 · 무역사무 · 팀장님/이사님 개인 공간)의 담당자 카드를 이메일로 모아서 사람마다 하나(profiles/{이메일})로
//   우선: 그 사람의 원래 소속 대시보드 카드 (조원 = 그 조 · 무역사무 = 무역사무 · 팀장님/이사님 = 개인 공간)
//   이메일이 안 붙은 카드는 관리자가 여기서 계정을 골라 연결 (조원에게 시키지 않음)
//   합치기 전에 모은 카드 전부를 profilesBackup/{시각} 에 저장 · 예전 카드는 지우지 않음
import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE } from '../data/store';
import { physName, TEAMS } from '../lib/team';
import { PROFILE_KEYS, writeProfile, type Profile } from '../lib/profiles';
import { usePeople } from './AddressBook';
import type { Member } from '../types';

type Card = { m: Member; where: string; path: string }; // where: '1' · '2' · '3' · 'trade' · 'p…'
const low = (e?: string) => (e ?? '').trim().toLowerCase();
const whereLabel = (w: string, leaderName?: string) => (w === 'trade' ? '무역사무' : /^\d+$/.test(w) ? `${w}조` : `${leaderName ?? '개인'} 대시보드`);
const show = (v: unknown) => (v === undefined || v === '' ? '—' : Array.isArray(v) ? `시계 ${v.length}개` : String(v));

export default function ProfileMerge() {
  const { roles, contacts } = usePeople();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const spaces = useMemo(() => [...new Set((roles ?? []).map((r) => r.space).filter((x): x is string => !!x))], [roles]);

  const gather = useCallback(async () => {
    if (DATA_MODE === 'local') return setCards([]);
    const out: Card[] = [];
    const read = async (where: string, path: string) => {
      try {
        const snap = await getDocs(collection(db, path));
        snap.docs.forEach((d) => out.push({ m: { ...(d.data() as Omit<Member, 'id'>), id: d.id }, where, path }));
      } catch {
        /* 못 읽는 곳은 건너뜀 */
      }
    };
    await Promise.all([...TEAMS.map((t) => read(t, physName('members', t))), read('trade', 'tradeMembers'), ...spaces.map((sp) => read(sp, physName('members', sp)))]);
    setCards(out);
  }, [spaces]);
  useEffect(() => {
    if (roles) void gather();
  }, [roles, gather]);

  // 이메일 → 원래 소속 (조원 = 조 · 무역사무 = trade · 팀장님/이사님 = 개인 공간)
  const homeOf = useCallback(
    (email: string) => {
      const r = (roles ?? []).find((x) => x.email === email);
      if (!r) return '';
      if (r.role === 'trade') return 'trade';
      if (r.role === 'lead' || r.role === 'director') return r.space ?? '';
      return r.team ?? '2';
    },
    [roles],
  );
  const nameOfEmail = (e: string) => contacts[e]?.name || (roles ?? []).find((r) => r.email === e)?.name || e.split('@')[0];
  const leaderBySpace = (sp: string) => {
    const r = (roles ?? []).find((x) => x.space === sp);
    return r ? nameOfEmail(r.email) : undefined;
  };

  const plan = useMemo(() => {
    if (!cards) return null;
    const by = new Map<string, Card[]>();
    for (const c of cards) {
      const e = low(c.m.email);
      if (!e) continue;
      by.set(e, [...(by.get(e) ?? []), c]);
    }
    const people = [...by.entries()].map(([email, list]) => {
      const home = homeOf(email);
      const main = list.find((c) => c.where === home) ?? list[0];
      const diffs = PROFILE_KEYS.flatMap((k) => {
        const vals = [...new Set(list.map((c) => JSON.stringify(c.m[k] ?? '')))];
        return vals.length > 1 ? [{ k, list: list.map((c) => ({ where: c.where, v: c.m[k] })) }] : [];
      });
      return { email, home, main, list, diffs, homeMissing: !!home && !list.some((c) => c.where === home) };
    });
    const unlinked = cards.filter((c) => !low(c.m.email));
    return { people: people.sort((a, b) => a.main.m.name.localeCompare(b.main.m.name, 'ko')), unlinked };
  }, [cards, homeOf]);

  const linkCard = async (c: Card, email: string) => {
    if (!email) return;
    setBusy(true);
    try {
      await setDoc(doc(db, c.path, c.m.id), { email }, { merge: true });
      setMsg(`'${c.m.name}' (${whereLabel(c.where, leaderBySpace(c.where))}) 카드를 ${nameOfEmail(email)} 계정에 연결했어요`);
      await gather();
    } catch (e) {
      setMsg(`연결 못 했어요: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!plan || !cards) return;
    if (!confirm(`${plan.people.length}명의 카드를 사람마다 하나로 합칠까요?\n· 원래 소속 대시보드 카드를 우선해요\n· 합치기 전 카드 전부를 백업해 두고, 예전 카드는 지우지 않아요`)) return;
    setBusy(true);
    try {
      const ts = new Date().toISOString();
      await setDoc(doc(db, 'profilesBackup', ts.replace(/[:.]/g, '-')), { at: ts, data: JSON.stringify(cards.map((c) => ({ where: c.where, path: c.path, ...c.m }))) });
      for (const p of plan.people) {
        const v: Profile = { home: p.main.where };
        for (const k of PROFILE_KEYS) {
          const val = p.main.m[k];
          if (val !== undefined && val !== '') (v as Record<string, unknown>)[k] = val;
        }
        await writeProfile(p.email, v);
      }
      setMsg(`✓ ${plan.people.length}명 합쳤어요 (백업: ${ts.slice(0, 16).replace('T', ' ')})`);
    } catch (e) {
      setMsg(`못 합쳤어요: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const accounts = (roles ?? []).map((r) => r.email).sort((a, b) => nameOfEmail(a).localeCompare(nameOfEmail(b), 'ko'));
  return (
    <section className="card">
      <h2>👥 사람 정보 합치기</h2>
      <p className="muted small">
        모든 대시보드의 담당자 카드를 이메일로 모아서 <b>사람마다 하나</b>로 합쳐요 (이름 · 캐릭터 · 색 · 말풍선 · 시계 · mem 이름). 합친 뒤에는 어느 대시보드에서 고쳐도 모두에게 같이 보여요. <b>원래 소속 대시보드 카드</b>를 우선하고, 합치기 전 카드는 백업 · 예전 카드는 그대로 둬요.
      </p>
      {DATA_MODE === 'local' && <p className="muted small">로컬 모드에서는 못 해요.</p>}
      {!plan ? (
        <p className="muted small">카드 모으는 중…</p>
      ) : (
        <>
          <div className="pm-top">
            <b>{plan.people.length}명</b>
            <span className="muted small">카드 {cards?.length ?? 0}장 · 계정이 안 붙은 카드 {plan.unlinked.length}장</span>
            <button className="small" disabled={busy} onClick={() => void gather()}>
              ↻ 다시 모으기
            </button>
            <button className="primary" disabled={busy || !plan.people.length} onClick={() => void run()}>
              {busy ? '하는 중…' : '👥 합치기'}
            </button>
          </div>
          {msg && <p className="small">{msg}</p>}
          <table className="mini-table pm-table">
            <thead>
              <tr>
                <th>사람</th>
                <th>쓸 카드 (원래 소속)</th>
                <th>다른 곳 카드</th>
                <th>다른 값 (합치면 원래 소속 값으로)</th>
              </tr>
            </thead>
            <tbody>
              {plan.people.map((p) => (
                <tr key={p.email}>
                  <td>
                    <b>{p.main.m.name}</b> <span className="muted small">{p.email}</span>
                  </td>
                  <td>
                    {whereLabel(p.main.where, leaderBySpace(p.main.where))}
                    {p.homeMissing && <span className="warn small"> · 원래 소속({whereLabel(p.home, leaderBySpace(p.home))})에 카드가 없어서 이걸로</span>}
                  </td>
                  <td className="small">{p.list.filter((c) => c !== p.main).map((c) => whereLabel(c.where, leaderBySpace(c.where))).join(' · ') || '—'}</td>
                  <td className="small">
                    {p.diffs.length === 0
                      ? '—'
                      : p.diffs.map((d) => (
                          <div key={d.k}>
                            <b>{d.k}</b>: {d.list.map((x) => `${whereLabel(x.where, leaderBySpace(x.where))} ${show(x.v)}`).join(' / ')}
                          </div>
                        ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {plan.unlinked.length > 0 && (
            <>
              <h3 className="pm-sub">🔗 계정이 안 붙은 카드 — 관리자가 연결</h3>
              <p className="muted small">누구 카드인지 골라 주세요. 연결하면 위 목록에 들어가요 (대시보드 사용자가 아닌 카드는 그냥 두면 돼요).</p>
              <table className="mini-table pm-table">
                <tbody>
                  {plan.unlinked.map((c) => (
                    <tr key={c.path + c.m.id}>
                      <td>
                        <b>{c.m.name}</b>
                      </td>
                      <td className="small">{whereLabel(c.where, leaderBySpace(c.where))}</td>
                      <td>
                        <select disabled={busy} defaultValue="" onChange={(e) => void linkCard(c, e.target.value)}>
                          <option value="">계정 고르기…</option>
                          {accounts.map((e) => (
                            <option key={e} value={e}>
                              {nameOfEmail(e)} ({e})
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </section>
  );
}
