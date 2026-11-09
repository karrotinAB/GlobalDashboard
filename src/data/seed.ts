import type { Collections } from '../types';

// 저장소가 공개라서 실제 업무 데이터(업체·할일·주문)는 넣지 않음.
// 처음 시작할 때 담당자만 만들어 두고, 실제 데이터는 설정 > 백업 가져오기(JSON)로 넣음.
export function seedData(): Collections {
  return {
    members: [
      { id: 'm-yj', name: '유정', color: '#9c4a6e', order: 0, character: 'c05' },
      { id: 'm-mj', name: '민지', color: '#3f6fb8', order: 1, character: 'c13' },
      { id: 'm-gy', name: '가영', color: '#c8742a', order: 2, character: 'c14' },
    ],
    companies: [],
    tasks: [],
    orders: [],
    attendance: [],
  };
}
