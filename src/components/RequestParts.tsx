// 무역사무 요청: 새 요청 창, 상세 창(수정·취소·기록), 작은 표시들
import { useState, type ClipboardEvent, type CSSProperties } from 'react';
import { PRIORITIES, REQUEST_STATUS, WORK_TYPES, type Member, type Priority, type RequestFile, type RequestStatus, type TradeRequest } from '../types';
import { characterSrc, Modal, Ring } from './ui';
import DateInput from './DateInput';
import { DateCell } from './OrderCells';
import { today, uid } from '../lib/date';
import { deleteRequestFile, memberLabel, PRIORITY_CLASS, tradeChar, uploadRequestFile, workload } from '../lib/trade';

const dot = (iso?: string) => (iso ? iso.replace(/-/g, '.') : '');

export function PriorityTag({ p }: { p: string }) {
  return <span className={`prio ${PRIORITY_CLASS[p] ?? ''}`}>{p}</span>;
}
export function StatusTag({ s }: { s: RequestStatus }) {
  return <span className={`rstat rs-${s}`}>{REQUEST_STATUS[s]}</span>;
}

/** 사진 넣기: 파일 고르기 + 붙여넣기(Ctrl+V) */
function FileBox({ reqId, files, onChange }: { reqId: string; files: RequestFile[]; onChange: (f: RequestFile[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const add = async (list: File[]) => {
    if (!list.length) return;
    setBusy(true);
    setErr('');
    try {
      const up: RequestFile[] = [];
      for (const f of list) up.push(await uploadRequestFile(reqId, f));
      onChange([...files, ...up]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const onPaste = (e: ClipboardEvent) => {
    const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (imgs.length) {
      e.preventDefault();
      void add(imgs);
    }
  };
  return (
    <div className="rq-files" onPaste={onPaste} tabIndex={0}>
      {files.map((f, i) => (
        <div key={f.url + i} className="rq-thumb">
          <a href={f.url} target="_blank" rel="noreferrer" title={f.name}>
            {/\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name) || f.url.startsWith('data:image') ? <img src={f.url} alt={f.name} /> : <span>📄 {f.name}</span>}
          </a>
          <button
            className="rq-thumb-x"
            title="삭제"
            onClick={() => {
              if (!confirm('이 파일을 지울까요?')) return;
              void deleteRequestFile(f);
              onChange(files.filter((_, j) => j !== i));
            }}
          >
            ×
          </button>
        </div>
      ))}
      <label className="rq-add-file">
        {busy ? '올리는 중…' : '＋ 사진'}
        <input type="file" multiple accept="image/*,.pdf,.xlsx,.xls,.doc,.docx" onChange={(e) => void add([...(e.target.files ?? [])])} hidden />
      </label>
      <span className="muted small">캡처한 사진은 여기를 누르고 Ctrl+V 로 붙여넣어도 돼요</span>
      {err && <span className="rq-err">{err}</span>}
    </div>
  );
}

type Draft = Pick<TradeRequest, 'title' | 'body' | 'storeCode' | 'orderDate' | 'dueDate' | 'workType' | 'requesterId' | 'assigneeId' | 'files'> & { priority?: Priority };

/** 필수: 마감일 · 우선순위 · 작업유형 (창 제목 오른쪽) */
function HeadFields({ d, set, showMissing }: { d: Draft; set: (p: Partial<Draft>) => void; showMissing?: boolean }) {
  const miss = (v: unknown) => (showMissing && !v ? 'missing' : '');
  return (
    <div className="rq-head-fields">
      <div className={`rq-f req ${miss(d.dueDate)}`}>
        <span>마감일 *</span>
        <DateInput value={d.dueDate} placeholder="예: 20261110" onChange={(v) => set({ dueDate: v })} />
      </div>
      <label className={`rq-f req ${miss(d.priority)}`}>
        <span>우선순위 *</span>
        <select value={d.priority ?? ''} onChange={(e) => set({ priority: (e.target.value || undefined) as Priority })}>
          <option value="">(고르기)</option>
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <div className={`rq-f req wide ${miss(d.workType)}`}>
        <span>작업유형 *</span>
        <WorkTypePicker value={d.workType} onChange={(v) => set({ workType: v })} placeholder="고르거나 쳐서 찾기" />
      </div>
    </div>
  );
}

function Fields({
  d,
  set,
  reqId,
  team,
  trade,
  side,
  showMissing,
}: {
  d: Draft;
  set: (p: Partial<Draft>) => void;
  reqId: string;
  team: Member[];
  trade: Member[];
  side: 'team' | 'trade';
  showMissing?: boolean;
}) {
  const reqRequester = side === 'team'; // 무역사무가 넣는 자체 업무는 요청자 없어도 됨
  return (
    <div className="rq-form">
      <label className={`rq-f req rq-title-f ${showMissing && !d.title.trim() ? 'missing' : ''}`}>
        <span>업무 내용 (제목) *</span>
        <input value={d.title} autoFocus placeholder="예: 몽골 10월 주문 CI/PL 작성 부탁드려요" onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label className={`rq-f req ${showMissing && reqRequester && !d.requesterId ? 'missing' : ''}`}>
        <span>요청자{reqRequester ? ' *' : ''}</span>
        <select value={d.requesterId ?? ''} onChange={(e) => set({ requesterId: e.target.value || undefined })}>
          <option value="">{reqRequester ? '(고르기)' : '(없음 · 무역사무 자체 업무)'}</option>
          {team.map((m) => (
            <option key={m.id} value={m.id}>
              {memberLabel(m)}
            </option>
          ))}
        </select>
      </label>
      <label className="rq-f full">
        <span>자세한 내용</span>
        <textarea rows={4} value={d.body ?? ''} placeholder="필요한 내용을 자유롭게 적어 주세요" onChange={(e) => set({ body: e.target.value })} />
      </label>
      <div className="rq-f full">
        <span>사진 · 파일</span>
        <FileBox reqId={reqId} files={d.files ?? []} onChange={(files) => set({ files })} />
      </div>
      <div className="rq-optional full">
        <span className="rq-opt-label">선택</span>
        <label className="rq-f">
          <span>매장번호</span>
          <input value={d.storeCode ?? ''} onChange={(e) => set({ storeCode: e.target.value })} />
        </label>
        <div className="rq-f">
          <span>주문일자</span>
          <DateInput value={d.orderDate} placeholder="예: 20261110" onChange={(v) => set({ orderDate: v })} />
        </div>
        <label className="rq-f">
          <span>처리자</span>
          <select value={d.assigneeId ?? ''} onChange={(e) => set({ assigneeId: e.target.value || undefined })}>
            <option value="">미정 (무역사무가 정함)</option>
            {trade.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

/** 필수 칸이 다 찼는지 */
const missingOf = (d: Draft, side: 'team' | 'trade') =>
  [!d.title.trim() && '업무 내용', !d.dueDate && '마감일', !d.priority && '우선순위', !d.workType && '작업유형', side === 'team' && !d.requesterId && '요청자'].filter(
    Boolean,
  ) as string[];

/** 새 요청 */
export function NewRequest({
  team,
  trade,
  me,
  myEmail,
  side = 'team',
  teamId,
  teamName,
  onCreate,
  onClose,
}: {
  team: Member[];
  trade: Member[];
  me?: Member;
  myEmail: string;
  side?: 'team' | 'trade'; // trade = 무역사무가 직접 넣는 업무 (처리자 기본 = 나, 요청자는 비워도 됨)
  teamId?: string; // 요청하는 조 (조 화면에서)
  teamName?: string; // '1조', '팀장님 (홍길동)' …
  onCreate: (r: TradeRequest) => void;
  onClose: () => void;
}) {
  const [id] = useState(uid);
  const isTrade = side === 'trade';
  const [d, setD] = useState<Draft>({
    title: '',
    requesterId: !isTrade && me && team.some((m) => m.id === me.id) ? me.id : undefined,
    assigneeId: isTrade && me && trade.some((m) => m.id === me.id) ? me.id : undefined,
    files: [],
  });
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const [tried, setTried] = useState(false); // 보내기를 한 번 누르면 빈 필수 칸을 빨갛게
  const missing = missingOf(d, side);
  const submit = () => {
    setTried(true);
    if (missing.length || !d.priority) return;
    const now = new Date().toISOString();
    const by = me?.name ?? myEmail ?? '';
    onCreate({
      ...d,
      priority: d.priority,
      id,
      title: d.title.trim(),
      body: d.body?.trim() || undefined,
      storeCode: d.storeCode?.trim() || undefined,
      requestedAt: today(),
      requesterEmail: team.find((m) => m.id === d.requesterId)?.email ?? (isTrade ? undefined : myEmail || undefined),
      team: isTrade ? team.find((m) => m.id === d.requesterId)?.team : teamId,
      teamName: isTrade ? undefined : teamName,
      requesterName: team.find((m) => m.id === d.requesterId)?.name,
      status: 'requested',
      createdAt: now,
      log: [{ at: now, by, text: isTrade ? '무역사무에서 업무 추가' : '요청함' }],
    });
    onClose();
  };
  return (
    <Modal title={isTrade ? '업무 추가' : '무역사무 요청하기'} onClose={onClose} wide headExtra={<HeadFields d={d} set={set} showMissing={tried} />}>
      <Fields d={d} set={set} reqId={id} team={team} trade={trade} side={side} showMissing={tried} />
      <div className="rq-actions">
        {tried && missing.length > 0 && <span className="rq-missing-msg">필수 칸을 채워 주세요: {missing.join(', ')}</span>}
        <button onClick={onClose}>닫기</button>
        <button className="primary" onClick={submit}>
          {isTrade ? '추가' : '요청 보내기'}
        </button>
      </div>
    </Modal>
  );
}

/** 요청 상세: 내용 보기/수정, 상태·처리자, 취소, 기록 */
export function RequestDetail({
  r,
  team,
  trade,
  side,
  canEditContent,
  onSave,
  onClose,
}: {
  r: TradeRequest;
  team: Member[];
  trade: Member[];
  side: 'team' | 'trade';
  canEditContent: boolean; // 제목·내용 고치기 / 취소 (요청자·관리자·무역사무)
  onSave: (patch: Partial<TradeRequest>) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState<Draft>(r);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const requester = team.find((m) => m.id === r.requesterId);
  const assignee = trade.find((m) => m.id === r.assigneeId);
  const saveEdit = () => {
    if (!d.title.trim()) return;
    const patch: Partial<TradeRequest> = {};
    for (const k of ['title', 'body', 'storeCode', 'orderDate', 'dueDate', 'priority', 'workType', 'requesterId', 'assigneeId', 'files'] as const) {
      const v = typeof d[k] === 'string' ? (d[k] as string).trim() || undefined : d[k];
      if (JSON.stringify(v) !== JSON.stringify(r[k])) (patch as Record<string, unknown>)[k] = v;
    }
    if (Object.keys(patch).length) onSave(patch);
    setEditing(false);
  };
  return (
    <Modal title={r.title} onClose={onClose} wide>
      <div className="rq-head">
        <StatusTag s={r.status} />
        <PriorityTag p={r.priority} />
        {r.workType && <span className="tag gray">{r.workType}</span>}
        <span className="muted small">
          {requester ? memberLabel(requester) : r.requesterEmail ?? '무역사무 자체 업무'} · {dot(r.requestedAt)} {r.requesterId || r.requesterEmail ? '의뢰' : '등록'}
        </span>
      </div>

      {editing ? (
        <>
          <HeadFields d={d} set={set} />
          <Fields d={d} set={set} reqId={r.id} team={team} trade={trade} side={side} />
          <div className="rq-actions">
            <button
              onClick={() => {
                setD(r);
                setEditing(false);
              }}
            >
              취소
            </button>
            <button className="primary" onClick={saveEdit}>
              저장 (기록 남김)
            </button>
          </div>
        </>
      ) : (
        <>
          {r.body ? <div className="rq-body">{r.body}</div> : <p className="muted small">자세한 내용 없음</p>}
          {(r.files ?? []).length > 0 && (
            <div className="rq-files view">
              {r.files!.map((f, i) => (
                <a key={i} className="rq-thumb" href={f.url} target="_blank" rel="noreferrer" title={f.name}>
                  {/\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name) || f.url.startsWith('data:image') ? <img src={f.url} alt={f.name} /> : <span>📄 {f.name}</span>}
                </a>
              ))}
            </div>
          )}
          <dl className="rq-info">
            <div>
              <dt>매장번호</dt>
              <dd>{r.storeCode || '-'}</dd>
            </div>
            <div>
              <dt>주문일자</dt>
              <dd>{dot(r.orderDate) || '-'}</dd>
            </div>
            <div>
              <dt>마감일</dt>
              <dd>{dot(r.dueDate) || '-'}</dd>
            </div>
            <div>
              <dt>처리 예상일</dt>
              <dd>
                {side === 'trade' ? <DateCell value={r.eta} onSave={(v) => onSave({ eta: v })} /> : dot(r.eta) || '-'}
              </dd>
            </div>
            <div>
              <dt>처리자</dt>
              <dd>
                <select value={r.assigneeId ?? ''} onChange={(e) => onSave({ assigneeId: e.target.value || undefined })}>
                  <option value="">미정</option>
                  {trade.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </dd>
            </div>
            <div>
              <dt>상태</dt>
              <dd>
                {side === 'trade' ? (
                  <select value={r.status} onChange={(e) => onSave({ status: e.target.value as RequestStatus })}>
                    {(['requested', 'progress', 'done'] as const).map((s) => (
                      <option key={s} value={s}>
                        {REQUEST_STATUS[s]}
                      </option>
                    ))}
                    {r.status === 'cancelled' && <option value="cancelled">취소</option>}
                  </select>
                ) : (
                  <>
                    <StatusTag s={r.status} />
                    {assignee && <span className="muted small"> · {assignee.name}</span>}
                  </>
                )}
              </dd>
            </div>
          </dl>
          <div className="rq-actions left">
            {canEditContent && r.status !== 'cancelled' && <button onClick={() => setEditing(true)}>✎ 수정</button>}
            {canEditContent && r.status !== 'cancelled' && r.status !== 'done' && (
              <button className="danger" onClick={() => confirm('이 요청을 취소할까요? (기록은 남아요)') && onSave({ status: 'cancelled' })}>
                요청 취소
              </button>
            )}
            {canEditContent && r.status === 'cancelled' && <button onClick={() => onSave({ status: 'requested' })}>취소 되돌리기</button>}
          </div>
        </>
      )}

      <details className="rq-log" open={(r.log ?? []).length <= 6}>
        <summary>기록 {(r.log ?? []).length}개</summary>
        <ul>
          {[...(r.log ?? [])].reverse().map((l, i) => (
            <li key={i}>
              <span className="muted small">
                {new Date(l.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {l.by}
              </span>
              <span>{l.text}</span>
              {l.prev !== undefined && (
                <details className="rq-prev">
                  <summary className="muted small">이전 내용 보기</summary>
                  <pre>{l.prev || '(비어 있었음)'}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      </details>
    </Modal>
  );
}

/**
 * 작업유형 고르기: 누르면 목록이 펼쳐지고(토글), 글자를 치면 맞는 것만 남음 (↑↓ Enter 로 고르기)
 * allLabel 이 있으면 맨 위에 '전체' 같은 빈 값 항목
 */
export function WorkTypePicker({
  value,
  onChange,
  allLabel,
  placeholder = '작업유형',
  compact,
}: {
  value?: string;
  onChange: (v: string | undefined) => void;
  allLabel?: string;
  placeholder?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [hi, setHi] = useState(0);
  const q = text.trim().toLowerCase().replace(/\s+/g, '');
  const list = WORK_TYPES.filter((w) => !q || w.toLowerCase().replace(/\s+/g, '').includes(q));
  const items: { v?: string; label: string }[] = [...(allLabel && !q ? [{ v: undefined, label: allLabel }] : []), ...list.map((w) => ({ v: w, label: w }))];
  const pick = (v?: string) => {
    onChange(v);
    setOpen(false);
    setText('');
  };
  return (
    <div
      className={`wt-picker ${compact ? 'compact' : ''} ${open ? 'open' : ''}`}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
          setText('');
        }
      }}
    >
      <input
        className="wt-input"
        value={open ? text : value ?? ''}
        placeholder={open ? value || '쳐서 찾기…' : value ? '' : allLabel ?? placeholder}
        onFocus={() => {
          setOpen(true);
          setHi(0);
        }}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, items.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (items[hi]) pick(items[hi].v);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setOpen(false);
            setText('');
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <button type="button" className="wt-caret" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((v) => !v)}>
        {open ? '▴' : '▾'}
      </button>
      {open && (
        <ul className="wt-list" tabIndex={-1}>
          {items.length === 0 && <li className="muted small wt-none">맞는 작업유형이 없어요</li>}
          {items.map((it, i) => (
            <li key={it.label}>
              <button
                type="button"
                className={`${i === hi ? 'hi' : ''} ${it.v === value ? 'on' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(it.v)}
              >
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 무역사무 담당자별 요약 카드 (주간 할일 카드와 같은 모양): 캐릭터 · 남은 업무 링 · 급한 표시 */
export function TradeSummaryCards({
  requests,
  trade,
  selected,
  onSelect,
}: {
  requests: TradeRequest[];
  trade: Member[];
  selected?: string;
  onSelect: (id: string) => void;
}) {
  const load = workload(requests, trade);
  return (
    <div className="team compact trade-sum">
      {load.rows.map((w) => {
        const m = w.member!;
        const total = w.open + w.doneThisMonth;
        return (
          <button
            key={m.id}
            className={`member-card ${selected === m.id ? 'selected' : ''}`}
            style={{ '--c': m.color } as CSSProperties}
            onClick={() => onSelect(m.id)}
            title="눌러서 이 사람의 업무 보기"
          >
            <div className="mc-top">
              <img className="mc-mini-char" src={characterSrc(tradeChar(m, trade))} alt="" />
              <div className="mc-name">
                <b>{m.name}</b>
                <span className="muted small">
                  요청됨 {w.requested} · 진행중 {w.progress} · 이번 달 완료 {w.doneThisMonth}
                </span>
              </div>
              <Ring value={w.doneThisMonth} total={total} size={56} stroke={6} color={m.color} label={w.open} sub="남음" />
            </div>
            <div className="mc-flags">
              <span className={`flag ${w.hot ? 'hot' : ''}`}>초긴급 {w.hot}</span>
              <span className={`flag ${w.overdue ? 'warn' : ''}`}>마감 지남 {w.overdue}</span>
              <span className={`flag ${w.dueToday ? 'hot' : ''}`}>오늘 마감 {w.dueToday}</span>
            </div>
          </button>
        );
      })}
      <button className={`member-card unassigned ${selected === '-' ? 'selected' : ''}`} onClick={() => onSelect('-')} title="처리자가 아직 안 정해진 요청">
        <div className="mc-top">
          <span className="tw-q big">?</span>
          <div className="mc-name">
            <b>처리자 미정</b>
            <span className="muted small">무역사무가 정하기 전</span>
          </div>
          <span className="un-num">
            {load.unassigned}
            <small>건</small>
          </span>
        </div>
      </button>
    </div>
  );
}
