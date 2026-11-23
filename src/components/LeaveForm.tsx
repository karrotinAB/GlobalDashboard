// 출장신청서 › 🌴 대체휴가 신청서: 왼쪽 내 신청서 목록 · 오른쪽 A4 신청서 (칸에 바로 적고 저장 · 프린트)
import { useEffect, useState } from 'react';
import { deleteLeaveReq, hoursBetween, saveLeaveReq, useLeaveReqs, type LeaveReq } from '../lib/leaveReq';
import { useFullName } from '../lib/fullName';
import { usePeople } from './AddressBook';
import { printSheet } from '../pages/Petty';
import { today, uid } from '../lib/date';

const ymd = (iso?: string) => (iso ? { y: iso.slice(0, 4), m: String(Number(iso.slice(5, 7))), d: String(Number(iso.slice(8, 10))) } : { y: '', m: '', d: '' });
const hm = (t?: string) => (t ? { h: String(Number(t.slice(0, 2))), m: t.slice(3, 5) } : { h: '', m: '' });

export default function LeaveForm({ email }: { email: string }) {
  const list = useLeaveReqs(email);
  // 성명: 주소록 · 대시보드 사용자 이름 (이름 석 자) → 없으면 계정 이름
  const { contacts, roles } = usePeople();
  const acct = useFullName(email);
  const low = email.toLowerCase();
  const full = contacts[low]?.name || roles?.find((r) => r.email === low)?.name || '';
  const myName = /[가-힣]/.test(full) ? full : /[가-힣]/.test(acct) ? acct : full || acct;
  // 사번 · 직급 · 부서명 · 성명: 마지막으로 저장한 신청서 값을 새 신청서에 그대로 (고치기 전까지)
  const lastSaved = () => [...(list ?? [])].sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt))[0];
  const blank = (): LeaveReq => {
    const l = lastSaved();
    return { id: uid(), email, dept: l?.dept || '글로벌사업부', empNo: l?.empNo, rank: l?.rank, name: l?.name && /[가-힣]/.test(l.name) ? l.name : myName || '', applyDate: today(), createdAt: new Date().toISOString() };
  };
  const [d, setD] = useState<LeaveReq>(blank);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState('');
  const saved = (list ?? []).some((x) => x.id === d.id);
  // 이름이 늦게 들어오면 새 신청서에 채움
  // 목록이 늦게 들어오면: 아직 손대지 않은 새 신청서에 지난번 사번 · 직급 · 부서명 채움
  useEffect(() => {
    if (saved || dirty) return;
    const l = lastSaved();
    if (l) setD((x) => ({ ...x, dept: x.dept && x.dept !== '글로벌사업부' ? x.dept : l.dept || x.dept, empNo: x.empNo || l.empNo, rank: x.rank || l.rank, name: x.name && /[가-힣]/.test(x.name) ? x.name : l.name || x.name }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);
  useEffect(() => {
    // 비어 있거나 계정 아이디(영문)로 들어간 새 신청서는 이름 석 자로
    if (!saved && myName && (!d.name || (!/[가-힣]/.test(d.name) && /[가-힣]/.test(myName)))) setD((x) => ({ ...x, name: myName }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myName]);
  const set = (p: Partial<LeaveReq>) => {
    setD((x) => {
      const n = { ...x, ...p };
      // 근무시간을 바꾸면 인정시간 자동 (직접 고친 값이 없을 때 · 또는 예전 자동값일 때)
      if (('start' in p || 'end' in p) && (!x.hours || x.hours === hoursBetween(x.start, x.end))) n.hours = hoursBetween(n.start, n.end);
      return n;
    });
    setDirty(true);
    setMsg('');
  };
  const save = async () => {
    await saveLeaveReq(d);
    setDirty(false);
    setMsg('저장했어요 ✓');
  };
  const open = (r: LeaveReq) => {
    if (dirty && !confirm('저장하지 않은 내용이 있어요. 그래도 다른 신청서를 열까요?')) return;
    setD(r);
    setDirty(false);
    setMsg('');
  };
  const fresh = () => {
    if (dirty && !confirm('저장하지 않은 내용이 있어요. 그래도 새 신청서를 열까요?')) return;
    setD(blank());
    setDirty(false);
    setMsg('');
  };
  const w = ymd(d.workDate);
  const a = ymd(d.applyDate);
  const s = hm(d.start);
  const e = hm(d.end);
  // 화면에선 입력칸, 프린트에선 글자 (printSheet 가 .no-print 를 지우고 .lv-print 만 보임)
  const both = (input: React.ReactNode, text: React.ReactNode) => (
    <>
      <span className="no-print lv-edit">{input}</span>
      <span className="lv-print">{text}</span>
    </>
  );
  return (
    <div className="lv-wrap">
      <aside className="card lv-side">
        <button className="primary" onClick={fresh}>
          ＋ 새 신청서
        </button>
        <h3 className="lv-side-title">내 대체휴가 신청서</h3>
        {list === null ? (
          <p className="muted small">불러오는 중…</p>
        ) : list.length === 0 ? (
          <p className="muted small">아직 저장한 신청서가 없어요.</p>
        ) : (
          <div className="lv-list">
            {list.map((r) => (
              <button key={r.id} className={`lv-item ${r.id === d.id ? 'on' : ''}`} onClick={() => open(r)}>
                <b>{r.workDate ? r.workDate.replace(/-/g, '.') : '근무일 없음'}</b>
                <span className="muted small">{r.reason || '근무사유 없음'}</span>
              </button>
            ))}
          </div>
        )}
      </aside>
      <div className="lv-main">
        <div className="pc-print-bar">
          <span className="muted small">칸을 눌러 바로 적어요 · 근무시간을 넣으면 인정시간이 자동으로 들어가요 (고칠 수 있어요)</span>
          <span className="lv-actions">
            {msg && <span className="small">{msg}</span>}
            {saved && (
              <button
                className="link small danger-text"
                onClick={async () => {
                  if (!confirm('이 신청서를 지울까요?')) return;
                  await deleteLeaveReq(d.id);
                  setD(blank());
                  setDirty(false);
                }}
              >
                🗑 지우기
              </button>
            )}
            <button className={dirty || !saved ? 'primary' : ''} onClick={() => void save()}>
              💾 저장
            </button>
            <button className="primary" onClick={() => printSheet('lv-sheet')}>
              🖨 프린트 / PDF
            </button>
          </span>
        </div>
        <div className="ps-page lv-page" id="lv-sheet">
          <div className="lv-top">
            <h1 className="lv-title">휴일 및 주말 대체휴가 신청서</h1>
            <table className="lv-appr">
              <tbody>
                <tr>
                  <th rowSpan={2} className="lv-appr-side">
                    결<br />재
                  </th>
                  {['담 당', '팀 장', '부서장', '임 원', '부사장', '회 장'].map((h) => (
                    <td key={h} className="lv-appr-h">
                      {h}
                    </td>
                  ))}
                </tr>
                <tr>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <td key={i} className="lv-appr-sign" />
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <table className="lv-table">
            <tbody>
              <tr>
                <th colSpan={4} className="lv-sec">
                  신청인 정보
                </th>
              </tr>
              <tr>
                <th>부서명</th>
                <td>{both(<input value={d.dept ?? ''} onChange={(x) => set({ dept: x.target.value })} />, d.dept)}</td>
                <th>사 번</th>
                <td>{both(<input value={d.empNo ?? ''} onChange={(x) => set({ empNo: x.target.value })} />, d.empNo)}</td>
              </tr>
              <tr>
                <th>직 급</th>
                <td>{both(<input value={d.rank ?? ''} onChange={(x) => set({ rank: x.target.value })} />, d.rank)}</td>
                <th>성 명</th>
                <td>{both(<input value={d.name ?? ''} onChange={(x) => set({ name: x.target.value })} />, d.name)}</td>
              </tr>
              <tr>
                <th colSpan={4} className="lv-sec">
                  신청 내용
                </th>
              </tr>
              <tr>
                <th>근무일자</th>
                <td colSpan={3}>
                  {both(
                    <input type="date" value={d.workDate ?? ''} onChange={(x) => set({ workDate: x.target.value || undefined })} />,
                    <>
                      {w.y || '20  '} 년 {w.m || '  '} 월 {w.d || '  '} 일
                    </>,
                  )}
                </td>
              </tr>
              <tr>
                <th>근무시간</th>
                <td>
                  {both(
                    <span className="lv-times">
                      <input type="time" value={d.start ?? ''} onChange={(x) => set({ start: x.target.value || undefined })} /> 부터
                      <input type="time" value={d.end ?? ''} onChange={(x) => set({ end: x.target.value || undefined })} /> 까지
                    </span>,
                    <>
                      {s.h || '  '} 시 {s.m || '  '} 분부터 {e.h || '  '} 시 {e.m || '  '} 분까지
                    </>,
                  )}
                </td>
                <th className="lv-hours-h">대체휴가 인정시간</th>
                <td className="lv-hours">
                  ({' '}
                  {both(<input className="lv-h-in" value={d.hours ?? ''} onChange={(x) => set({ hours: x.target.value })} />, <span className="lv-h-val">{d.hours}</span>)} ) 시간
                </td>
              </tr>
              <tr>
                <th>근무사유</th>
                <td colSpan={3} className="lv-reason">
                  {both(<textarea rows={2} value={d.reason ?? ''} onChange={(x) => set({ reason: x.target.value })} />, <span className="ps-text">{d.reason}</span>)}
                </td>
              </tr>
            </tbody>
          </table>

          <p className="lv-say">위와 같이 휴일 및 주말 대체휴가를 신청합니다.</p>
          <div className="lv-sign">
            <div>
              신청일{' '}
              {both(
                <input type="date" value={d.applyDate ?? ''} onChange={(x) => set({ applyDate: x.target.value || undefined })} />,
                <>
                  {a.y || '20  '} 년 {a.m || '  '} 월 {a.d || '  '} 일
                </>,
              )}
            </div>
            <div>
              신청인 <span className="lv-sign-name">{d.name}</span> (서명)
            </div>
          </div>
          <div className="lv-company">주식회사 아트박스</div>

          <table className="lv-table lv-guide">
            <tbody>
              <tr>
                <th colSpan={2} className="lv-sec">
                  신청 안내
                </th>
              </tr>
              <tr>
                <th>안내사항</th>
                <td>
                  - 연장근무를 신청할 수 있는 근로시간은 해당하는 주의 52시간 &amp; 월 25시간이 넘지 않는 범위에서 가능합니다.
                  <br />- 대체휴가 사용기간은 부여일로부터 6개월 이내이며, 미 사용시 보상하지 않습니다.
                </td>
              </tr>
            </tbody>
          </table>
          <div className="lv-foot">
            <span>주식회사 아트박스</span>
            <span>Rev. 2026.10</span>
          </div>
        </div>
      </div>
    </div>
  );
}
