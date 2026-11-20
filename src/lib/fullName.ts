// 이메일 → 이름 (내 계정 이름 · 주소록 · 대시보드 사용자 이름 · 없으면 이메일 앞부분)
import { useAccess } from '../components/AuthGate';
import { usePeople } from '../components/AddressBook';

// 대시보드 계정이 없는 팀장님·이사님 대신 쓰는 자리 (전도금 담당자가 대신 기록)
export const LEAD_KEY = 'lead@petty';
export const DIRECTOR_KEY = 'director@petty';

export function useFullName(email: string) {
  const { accountName, email: me } = useAccess();
  const { roles, contacts } = usePeople();
  if (email === LEAD_KEY) return '팀장님';
  if (email === DIRECTOR_KEY) return '이사님';
  return (email === me ? accountName : undefined) || contacts[email]?.name || roles?.find((r) => r.email === email)?.name || (email.includes('@') ? email.split('@')[0] : '');
}
