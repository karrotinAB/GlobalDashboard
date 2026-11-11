import { useEffect, useMemo } from 'react';
import { useLookups, useStore } from '../data/store';
import { memNames, parseImport, sharedRecords } from '../lib/mem';
import { useAccess } from './AuthGate';
import { DEFAULT_TEAM } from '../lib/team';

/**
 * 크롬 확장 프로그램 "2조 근태 보내기" 와 대화하는 부분.
 * 확장 프로그램(extension/dashboard.js)이 mem 에서 읽은 근태를 window.postMessage 로 넘겨주면
 * 로그인된 이 페이지가 검증해서 저장하고, 받았다고 답함.
 */
export default function ExtensionBridge() {
  const { saveMany, save, data } = useStore();
  const { members: team } = useLookups();
  const { role, viewTeam } = useAccess();
  const trade = useMemo(() => [...data.tradeMembers].sort((a, b) => a.order - b.order), [data.tradeMembers]);
  // 이 공간(조·개인 대시보드) 사람: 무역사무 계정은 조 담당자를 쓰지 않음 (여러 조 이름이 섞여 있음)
  const own = useMemo(() => (role === 'trade' ? [] : team), [team, role]);
  const withTrade = role === 'trade' || viewTeam === DEFAULT_TEAM; // 무역사무 근태는 2조 쪽 저장소에도 (예전 방식 유지)
  const local = useMemo(() => [...own, ...(withTrade ? trade : [])], [own, trade, withTrade]);

  // 1) 공용 mem 이름 목록에 이 공간 사람들을 올림 (바뀌었을 때만)
  useEffect(() => {
    const put = (id: string, list: typeof team) => {
      const names = [...new Set(memNames(list))].sort();
      const cur = data.memDirectory.find((d) => d.id === id);
      if (!names.length && !cur) return;
      if (cur && JSON.stringify(cur.names) === JSON.stringify(names)) return;
      save('memDirectory', { id, names, updatedAt: new Date().toISOString() });
    };
    if (role !== 'trade' && own.length) put(viewTeam, own);
    if (trade.length) put('trade', trade);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own, trade, viewTeam, role, data.memDirectory.length]);

  // 모든 공간의 이름 (확장 프로그램은 이 사람들 줄만 읽음)
  const allNames = useMemo(() => {
    const names = new Set<string>(memNames(local));
    for (const d of data.memDirectory) for (const n of d.names ?? []) names.add(n);
    return [...names];
  }, [local, data.memDirectory]);

  useEffect(() => {
    if (!allNames.length) return;
    const origin = window.location.origin;
    const ready = () => window.postMessage({ type: 'gd-page-ready', names: allNames }, origin);

    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== origin || !e.data || typeof e.data !== 'object') return;
      if (e.data.type === 'gd-ext-hello') ready();
      if (e.data.type === 'gd-ext-import') {
        const p = e.data.payload as { key?: unknown; date?: unknown; rows?: unknown };
        const raw = JSON.stringify({ date: p?.date, rows: p?.rows });
        const mine = parseImport(raw, local); // 이 공간 기록 (예전 방식)
        const shared = sharedRecords(raw, allNames); // 공용 근태함: 모든 조·팀장님·이사님·무역사무
        if (!mine && !shared.length) return;
        Promise.all([mine?.records.length ? saveMany('attendance', mine.records) : null, shared.length ? saveMany('memAttendance', shared) : null]).then(() =>
          window.postMessage({ type: 'gd-ext-ack', key: p.key }, origin),
        );
      }
    };
    window.addEventListener('message', onMessage);
    ready();
    return () => window.removeEventListener('message', onMessage);
  }, [allNames, local, saveMany]);

  return null;
}
