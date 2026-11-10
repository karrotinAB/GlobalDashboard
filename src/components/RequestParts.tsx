// 무역사무 요청: 새 요청 창, 상세 창(수정·취소·기록), 작은 표시들
import { useState, type ClipboardEvent } from 'react';
import { PRIORITIES, REQUEST_STATUS, WORK_TYPES, type Member, type Priority, type RequestFile, type RequestStatus, type TradeRequest } from '../types';
import { Modal } from './ui';
import DateInput from './DateInput';
import { DateCell } from './OrderCells';
import { today, uid } from '../lib/date';
import { deleteRequestFile, PRIORITY_CLASS, uploadRequestFile } from '../lib/trade';

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

type Draft = Pick<TradeRequest, 'title' | 'body' | 'storeCode' | 'orderDate' | 'dueDate' | 'priority' | 'workType' | 'requesterId' | 'assigneeId' | 'files'>;

function Fields({
  d,
  set,
  reqId,
  team,
  trade,
  lockRequester,
}: {
  d: Draft;
  set: (p: Partial<Draft>) => void;
  reqId: string;
  team: Member[];
  trade: Member[];
  lockRequester?: boolean;
}) {
  return (
    <div className="rq-form">
      <label className="rq-f full">
        <span>업무 내용 (제목) *</span>
        <input value={d.title} autoFocus placeholder="예: 몽골 10월 주문 CI/PL 작성 부탁드려요" onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label className="rq-f full">
        <span>자세한 내용</span>
        <textarea rows={4} value={d.body ?? ''} placeholder="필요한 내용을 자유롭게 적어 주세요" onChange={(e) => set({ body: e.target.value })} />
      </label>
      <div className="rq-f full">
        <span>사진 · 파일</span>
        <FileBox reqId={reqId} files={d.files ?? []} onChange={(files) => set({ files })} />
      </div>
      <label className="rq-f">
        <span>매장번호</span>
        <input value={d.storeCode ?? ''} onChange={(e) => set({ storeCode: e.target.value })} />
      </label>
      <div className="rq-f">
        <span>주문일자</span>
        <DateInput value={d.orderDate} onChange={(v) => set({ orderDate: v })} />
      </div>
      <div className="rq-f">
        <span>마감일</span>
        <DateInput value={d.dueDate} onChange={(v) => set({ dueDate: v })} />
      </div>
      <label className="rq-f">
        <span>우선순위</span>
        <select value={d.priority} onChange={(e) => set({ priority: e.target.value as Priority })}>
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <div className="rq-f">
        <span>작업유형</span>
        <WorkTypePicker value={d.workType} onChange={(v) => set({ workType: v })} placeholder="눌러서 고르거나 쳐서 찾기" />
      </div>
      <label className="rq-f">
        <span>요청자</span>
        <select value={d.requesterId ?? ''} disabled={lockRequester} onChange={(e) => set({ requesterId: e.target.value || undefined })}>
          <option value="">(고르기)</option>
          {team.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
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
  );
}

/** 새 요청 */
export function NewRequest({
  team,
  trade,
  me,
  myEmail,
  onCreate,
  onClose,
}: {
  team: Member[];
  trade: Member[];
  me?: Member;
  myEmail: string;
  onCreate: (r: TradeRequest) => void;
  onClose: () => void;
}) {
  const [id] = useState(uid);
  const [d, setD] = useState<Draft>({ title: '', priority: '이번주', requesterId: me?.id, files: [] });
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const submit = () => {
    if (!d.title.trim()) return;
    const now = new Date().toISOString();
    const by = me?.name ?? myEmail ?? '';
    onCreate({
      ...d,
      id,
      title: d.title.trim(),
      body: d.body?.trim() || undefined,
      storeCode: d.storeCode?.trim() || undefined,
      requestedAt: today(),
      requesterEmail: team.find((m) => m.id === d.requesterId)?.email ?? (myEmail || undefined),
      status: 'requested',
      createdAt: now,
      log: [{ at: now, by, text: '요청함' }],
    });
    onClose();
  };
  return (
    <Modal title="무역사무 요청하기" onClose={onClose} wide>
      <Fields d={d} set={set} reqId={id} team={team} trade={trade} />
      <div className="rq-actions">
        <button onClick={onClose}>닫기</button>
        <button className="primary" disabled={!d.title.trim()} onClick={submit}>
          요청 보내기
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
          {requester?.name ?? r.requesterEmail ?? '요청자 미정'} · {dot(r.requestedAt)} 의뢰
        </span>
      </div>

      {editing ? (
        <>
          <Fields d={d} set={set} reqId={r.id} team={team} trade={trade} />
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
