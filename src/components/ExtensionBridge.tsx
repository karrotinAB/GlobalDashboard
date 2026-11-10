import { useEffect, useMemo } from 'react';
import { useLookups, useStore } from '../data/store';
import { memNames, parseImport } from '../lib/mem';

/**
 * 크롬 확장 프로그램 "2조 근태 보내기" 와 대화하는 부분.
 * 확장 프로그램(extension/dashboard.js)이 mem 에서 읽은 근태를 window.postMessage 로 넘겨주면
 * 로그인된 이 페이지가 검증해서 저장하고, 받았다고 답함.
 */
export default function ExtensionBridge() {
  const { saveMany, data } = useStore();
  const { members: team } = useLookups();
  // 2조 + 무역사무 담당자 (같은 mem 화면에서 같이 읽음)
  const members = useMemo(() => [...team, ...[...data.tradeMembers].sort((a, b) => a.order - b.order)], [team, data.tradeMembers]);

  useEffect(() => {
    if (!members.length) return;
    const origin = window.location.origin;
    const ready = () => window.postMessage({ type: 'gd-page-ready', names: memNames(members) }, origin);

    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== origin || !e.data || typeof e.data !== 'object') return;
      if (e.data.type === 'gd-ext-hello') ready();
      if (e.data.type === 'gd-ext-import') {
        const p = e.data.payload as { key?: unknown; date?: unknown; rows?: unknown };
        const result = parseImport(JSON.stringify({ date: p?.date, rows: p?.rows }), members);
        if (!result) return;
        saveMany('attendance', result.records).then(() => window.postMessage({ type: 'gd-ext-ack', key: p.key }, origin));
      }
    };
    window.addEventListener('message', onMessage);
    ready();
    return () => window.removeEventListener('message', onMessage);
  }, [members, saveMany]);

  return null;
}
