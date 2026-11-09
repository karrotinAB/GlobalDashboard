import { useEffect, useRef, useState } from 'react';
import { useLookups, useStore } from '../data/store';
import { parseImport } from '../lib/mem';

/** mem 북마크가 여는 화면: 받은 근태를 저장하고 홈으로 돌아감 */
export default function Import({ go }: { go: (page: string) => void }) {
  const { saveMany } = useStore();
  const { members } = useLookups();
  const [msg, setMsg] = useState('mem 근태를 반영하는 중…');
  const done = useRef(false);

  useEffect(() => {
    if (done.current || !members.length) return;
    done.current = true;
    const raw = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('d');
    const result = parseImport(raw, members);
    if (!result) {
      setMsg('받은 데이터를 읽지 못했어요. mem에서 북마크를 다시 눌러 주세요.');
      return;
    }
    // 주소에 남은 데이터는 바로 지움
    window.history.replaceState(null, '', window.location.pathname + '#/import');
    saveMany('attendance', result.records).then(() => {
      const names = result.records.map((r) => members.find((m) => m.id === r.memberId)?.name).join(', ');
      setMsg(result.records.length ? `${names} 근태를 반영했어요 ✓` : '우리 조 사람을 찾지 못했어요. 설정에서 mem 이름을 확인해 주세요.');
      if (result.records.length) setTimeout(() => go('home'), 1200);
    });
  }, [members, saveMany, go]);

  return (
    <div className="page">
      <div className="calm import-box">
        <span>🕘</span>
        <p>{msg}</p>
        <button className="link" onClick={() => go('home')}>
          홈으로 →
        </button>
      </div>
    </div>
  );
}
