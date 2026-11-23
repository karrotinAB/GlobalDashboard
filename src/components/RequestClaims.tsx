// 무역사무 요청 ↔ 클레임 기록 연결: 요청한 조의 클레임 관리에서 골라 붙이고, 무역사무도 그 기록을 실시간으로 봄
import { useState } from 'react';
import { useSpaceData, useStore } from '../data/store';
import { useAccess } from './AuthGate';
import { Modal } from './ui';
import { CUR_SIGN } from '../lib/sales';
import type { Claim, ClaimLink } from '../types';

type Co = { id: string; name: string; exportCurrency?: string };
const dot = (iso?: string) => (iso ? iso.slice(2).replace(/-/g, '.') : '');
const curOf = (c: Claim, cos: Co[]) => (c.currency === 'FOREIGN' ? cos.find((x) => x.id === c.companyId)?.exportCurrency || 'USD' : c.currency || 'KRW');
const money = (n: number | undefined, cur: string) =>
  n === undefined || n === null ? '-' : `${CUR_SIGN[cur] ?? `${cur} `}${n.toLocaleString(undefined, { maximumFractionDigits: cur === 'KRW' || cur === 'JPY' ? 0 : 2 })}`;

/** 요청에 연결된 클레임 (조마다 한 표) */
export function LinkedClaims({ links }: { links: ClaimLink[] }) {
  const teams = [...new Set(links.map((l) => l.team))];
  return (
    <>
      {teams.map((t) => (
        <LinkedTeamClaims key={t} team={t} links={links.filter((l) => l.team === t)} />
      ))}
    </>
  );
}
function LinkedTeamClaims({ team, links }: { team: string; links: ClaimLink[] }) {
  const space = useSpaceData(team, ['claims', 'companies']);
  const claims = (space.data.claims as Claim[] | undefined) ?? [];
  const cos = (space.data.companies as Co[] | undefined) ?? [];
  const list = links.map((l) => ({ l, c: claims.find((x) => x.id === l.claimId) }));
  return (
    <div className="rq-linked rq-linked-claim">
      <div className="rq-linked-head">
        <b>🧾 연결된 클레임</b> <span className="muted small">{links.length}건</span>
      </div>
      {!space.ready ? (
        <p className="muted small">불러오는 중…</p>
      ) : space.error ? (
        <p className="muted small">클레임을 볼 권한이 없어요 (서버 규칙을 새로 올렸는지 확인 — deploy.bat)</p>
      ) : (
        <div className="sales-table-wrap">
          <table className="mini-table rq-linked-table">
            <thead>
              <tr>
                <th>클레임</th>
                <th>업체</th>
                <th>출고날짜</th>
                <th className="r">클레임 금액</th>
                <th>서류작성</th>
                <th>환급</th>
                <th>파일</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {list.map(({ l, c }) =>
                c ? (
                  <tr key={l.claimId}>
                    <td>
                      <a href={`#/claims?c=${c.companyId ?? ''}`} title="클레임 관리에서 보기">
                        {c.title}
                      </a>
                    </td>
                    <td>{cos.find((x) => x.id === c.companyId)?.name ?? ''}</td>
                    <td>{dot(c.shipDate) || '-'}</td>
                    <td className="r">{money(c.claimAmount, curOf(c, cos))}</td>
                    <td>{c.docDone ? '✅' : '—'}</td>
                    <td>{c.refunded ? '✅ 완료' : '대기'}</td>
                    <td>
                      {(c.files ?? []).map((f, i) => (
                        <a key={i} href={f.url} target="_blank" rel="noreferrer" title={f.name} className="rq-claim-file">
                          📎
                        </a>
                      ))}
                    </td>
                    <td className="rq-claim-note">{c.note ?? ''}</td>
                  </tr>
                ) : (
                  <tr key={l.claimId}>
                    <td colSpan={8} className="muted small">
                      {l.label} — 클레임이 지워졌어요
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** 클레임 연결하기 창: 무역사무는 조를 골라서, 조원은 우리 조 클레임에서 */
export function ClaimLinker({ side, defaultTeam, picked, onPick, onClose }: { side: 'team' | 'trade'; defaultTeam?: string; picked: ClaimLink[]; onPick: (l: ClaimLink) => void; onClose: () => void }) {
  const access = useAccess();
  const { data } = useStore();
  const isTrade = side === 'trade';
  const [team, setTeam] = useState(defaultTeam && /^[123]$/.test(defaultTeam) ? defaultTeam : '2');
  const linkTeam = isTrade ? team : access.viewTeam;
  const space = useSpaceData(linkTeam, isTrade ? ['claims', 'companies'] : []);
  const claims = isTrade ? ((space.data.claims as Claim[] | undefined) ?? []) : data.claims;
  const cos: Co[] = isTrade ? ((space.data.companies as Co[] | undefined) ?? []) : data.companies;
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const coName = (id?: string | null) => cos.find((c) => c.id === id)?.name ?? '';
  const list = claims
    .filter((c) => !query || `${c.title} ${coName(c.companyId)} ${c.note ?? ''}`.toLowerCase().includes(query))
    .sort((a, b) => Number(a.refunded) - Number(b.refunded) || (b.shipDate ?? b.createdAt).localeCompare(a.shipDate ?? a.createdAt));
  const has = (id: string) => picked.some((p) => p.team === linkTeam && p.claimId === id);
  return (
    <Modal title="클레임 연결하기" onClose={onClose}>
      {isTrade ? (
        <p className="rq-link-teams small">
          <span>어느 조 클레임인가요?</span>
          <span className="seg">
            {['1', '2', '3'].map((t) => (
              <button key={t} className={team === t ? 'on' : ''} onClick={() => setTeam(t)}>
                {t}조
              </button>
            ))}
          </span>
          {!space.ready && <span className="muted small">불러오는 중…</span>}
        </p>
      ) : (
        <p className="muted small">이 요청에 연결할 클레임을 골라 주세요. 무역사무가 요청을 열면 그 클레임 기록을 바로 볼 수 있어요.</p>
      )}
      <div className="link-tools">
        <input className="search" autoFocus placeholder="🔍 클레임 이름 · 업체 · 비고" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="link-list">
        {list.length === 0 && <li className="muted small">클레임 기록이 없어요.</li>}
        {list.map((c) => (
          <li key={c.id}>
            <button
              className={has(c.id) ? 'on' : ''}
              disabled={has(c.id)}
              onClick={() => onPick({ team: linkTeam, claimId: c.id, label: `${c.title}${coName(c.companyId) ? ` · ${coName(c.companyId)}` : ''}` })}
            >
              <b>{c.title}</b>
              <span className="muted small">
                {coName(c.companyId)}
                {c.shipDate ? ` · 출고 ${dot(c.shipDate)}` : ''} · {money(c.claimAmount, curOf(c, cos))}
              </span>
              <span className={`tag small ${c.refunded ? 'green' : 'gray'}`}>{has(c.id) ? '연결됨' : c.refunded ? '환급 완료' : '진행중'}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
