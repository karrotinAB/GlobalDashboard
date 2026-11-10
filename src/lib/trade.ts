// 무역사무 요청 공용 도우미: 정렬, 남은 업무 계산, 변경 기록, 사진 올리기
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';
import { useMemo } from 'react';
import { DATA_MODE, useStore } from '../data/store';
import { useAccess } from '../components/AuthGate';
import { PRIORITIES, REQUEST_STATUS, type Member, type RequestFile, type TradeRequest } from '../types';
import { today, uid } from './date';

export const isOpen = (r: TradeRequest) => r.status === 'requested' || r.status === 'progress';

/** 우선순위 순서 (작을수록 급함) */
export const priorityRank = (r: TradeRequest) => {
  const i = PRIORITIES.indexOf(r.priority);
  return i < 0 ? PRIORITIES.length : i;
};

/** 목록 정렬: 진행중 업무는 급한 순 → 마감일 → 의뢰일, 끝난 업무는 끝난 날 최신순 */
export function sortRequests(list: TradeRequest[]) {
  return [...list].sort((a, b) => {
    if (isOpen(a) !== isOpen(b)) return isOpen(a) ? -1 : 1;
    if (!isOpen(a)) return (b.doneAt ?? b.createdAt).localeCompare(a.doneAt ?? a.createdAt);
    return (
      priorityRank(a) - priorityRank(b) ||
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
      a.requestedAt.localeCompare(b.requestedAt) ||
      a.createdAt.localeCompare(b.createdAt)
    );
  });
}

export const PRIORITY_CLASS: Record<string, string> = {
  초긴급: 'p-hot',
  '마감일 오전': 'p-am',
  '마감일 퇴근 전': 'p-pm',
  이번주: 'p-week',
  기한없음: 'p-none',
};

/** 무역사무 담당자별 남은 업무 */
export function workload(requests: TradeRequest[], people: Member[], todayIso = today()) {
  const month = todayIso.slice(0, 7);
  const rows = people.map((m) => {
    const mine = requests.filter((r) => r.assigneeId === m.id);
    const open = mine.filter(isOpen);
    return {
      member: m as Member | undefined,
      id: m.id,
      requested: open.filter((r) => r.status === 'requested').length,
      progress: open.filter((r) => r.status === 'progress').length,
      open: open.length,
      hot: open.filter((r) => r.priority === '초긴급').length,
      overdue: open.filter((r) => r.dueDate && r.dueDate < todayIso).length,
      dueToday: open.filter((r) => r.dueDate === todayIso).length,
      doneThisMonth: mine.filter((r) => r.status === 'done' && (r.doneAt ?? '').startsWith(month)).length,
    };
  });
  const un = requests.filter((r) => isOpen(r) && !r.assigneeId);
  return { rows, unassigned: un.length };
}

/** 사람 이름 (요청자: 2조 / 처리자: 무역사무) */
export const nameOf = (list: Member[], id?: string) => list.find((m) => m.id === id)?.name;

const FIELD_LABEL: Partial<Record<keyof TradeRequest, string>> = {
  title: '제목',
  body: '내용',
  storeCode: '매장번호',
  orderDate: '주문일자',
  dueDate: '마감일',
  priority: '우선순위',
  workType: '작업유형',
  eta: '처리 예상일',
  status: '상태',
  assigneeId: '처리자',
  requesterId: '요청자',
  requestedAt: '의뢰일',
};

/**
 * 바뀐 칸을 기록(log)에 남기고 새 요청을 돌려줌.
 * names: 처리자/요청자 id → 이름 (기록에 이름으로 남기려고)
 */
export function applyChange(
  r: TradeRequest,
  patch: Partial<TradeRequest>,
  by: string,
  names: { assignee: (id?: string) => string | undefined; requester: (id?: string) => string | undefined },
): TradeRequest {
  const next: TradeRequest = { ...r, ...patch };
  const log = [...(r.log ?? [])];
  const at = new Date().toISOString();
  const show = (k: keyof TradeRequest, v: unknown) =>
    k === 'status'
      ? REQUEST_STATUS[v as TradeRequest['status']]
      : k === 'assigneeId'
        ? names.assignee(v as string) ?? '미정'
        : k === 'requesterId'
          ? names.requester(v as string) ?? '-'
          : v === undefined || v === ''
            ? '(없음)'
            : String(v);
  for (const k of Object.keys(patch) as (keyof TradeRequest)[]) {
    const label = FIELD_LABEL[k];
    if (!label || r[k] === next[k]) continue;
    if (k === 'body') log.push({ at, by, text: '내용 수정', prev: r.body ?? '' });
    else if (k === 'status' && next.status === 'cancelled') log.push({ at, by, text: '요청 취소' });
    else log.push({ at, by, text: `${label}: ${show(k, r[k])} → ${show(k, next[k])}` });
  }
  if (patch.files && (patch.files.length !== (r.files ?? []).length)) {
    log.push({ at, by, text: patch.files.length > (r.files ?? []).length ? '사진 추가' : '사진 삭제' });
  }
  // 완료/취소한 날 기록, 다시 열면 지움
  if (patch.status) next.doneAt = isOpen(next) ? undefined : r.doneAt && !isOpen(r) ? r.doneAt : today();
  next.log = log.slice(-200);
  return next;
}

/** 사진 올리기: 팀 공유 모드면 Storage, 로컬 테스트면 브라우저 안에 (작은 파일만) */
export async function uploadRequestFile(reqId: string, file: File): Promise<RequestFile> {
  if (DATA_MODE === 'local') {
    if (file.size > 1.5 * 1024 * 1024) throw new Error('로컬 모드에서는 1.5MB 이하만 넣을 수 있어요');
    const url = await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(file);
    });
    return { name: file.name, url };
  }
  const name = file.name || `사진-${uid()}.png`;
  const path = `requests/${reqId}/${Date.now()}-${name.replace(/[^\w.\-가-힣]/g, '_')}`;
  const r = storageRef(storage, path);
  await uploadBytes(r, file);
  return { name, url: await getDownloadURL(r), path };
}

export async function deleteRequestFile(f: RequestFile) {
  if (f.path) await deleteObject(storageRef(storage, f.path)).catch(() => {});
}

/** 로그인한 사람: 2조 담당자 카드 (이메일로 찾음) */
export const memberOfEmail = (list: Member[], email: string) => (email ? list.find((m) => m.email?.toLowerCase() === email) : undefined);

/** 요청 저장 도우미: 누가 바꿨는지 기록까지 남김 */
export function useTrade() {
  const { data, save } = useStore();
  const access = useAccess();
  const team = useMemo(() => [...data.members].sort((a, b) => a.order - b.order), [data.members]);
  const trade = useMemo(() => [...data.tradeMembers].sort((a, b) => a.order - b.order), [data.tradeMembers]);
  const me = memberOfEmail(team, access.email) ?? memberOfEmail(trade, access.email);
  const by = me?.name ?? (access.email ? access.email.split('@')[0] : '나');
  const names = { assignee: (id?: string) => nameOf(trade, id), requester: (id?: string) => nameOf(team, id) };
  const update = (r: TradeRequest, patch: Partial<TradeRequest>) => save('requests', applyChange(r, patch, by, names));
  return { data, save, access, team, trade, me, by, update };
}
