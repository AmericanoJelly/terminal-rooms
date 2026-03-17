# Terminal Rooms

로그인 없이 방을 만들고 링크로 초대하는 터미널 스타일 임시 채팅 앱입니다.

## 실행 방법

```bash
npm install
npm start
```

기본 실행 주소:

```bash
http://localhost:3000
```

## 포함 기능

- 누구나 방 생성
- 링크 공유
- 닉네임 입장
- 최대 10명 활성 참여자
- 실시간 채팅
- 내가 속한 방 목록 표시
- 24시간 후 자동 만료
- 마지막 참여자가 나가면 즉시 방 삭제
- 터미널 스타일 UI
- Render Docker 배포용 파일 포함

## 현재 구현 제약

- 서버 메모리 저장 방식이라 서버 재시작 시 데이터가 사라집니다.
- 운영 배포용으로는 PostgreSQL/Prisma와 별도 실시간 서버 도입이 필요합니다.
- 브라우저 기반 clientId이므로 다른 기기와 목록이 동기화되지 않습니다.
<img width="1163" height="707" alt="image" src="https://github.com/user-attachments/assets/e5bc7ef9-6266-4b28-b928-443536c50c75" />
