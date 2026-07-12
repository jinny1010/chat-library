# 📼 채팅 도서관 (Chat Library)

SillyTavern 채팅 백업(.jsonl)과 이미지를 믹스테이프 서재처럼 꽂아두고 다시 읽는 뷰어.
순수 Node.js 하나로 돌아가고(외부 npm 패키지 없음), 폰 Termux에서도 그대로 실행됨.

## 파일 구성

```
6. 도서관/
├── library.js          ← 서버 본체 (이걸 실행)
├── public/
│   └── index.html      ← UI (서버가 자동으로 서빙)
├── package.json
├── server.js           ← 구버전 (자동 경로탐색 방식, 지금은 안 씀)
└── data/               ← 첫 실행 때 자동 생성되는 데이터 폴더
    ├── chats/          ← 채팅 백업 넣는 곳
    ├── images/         ← 이미지 넣는 곳
    ├── tags.json       ← 태그 저장 (자동 생성)
    └── settings.json   ← 도서관 이름 등 설정 (자동 생성)
```

## 설치

### Termux (폰)

```bash
# 1. Node.js 설치 (한 번만)
pkg install nodejs

# 2. 폴더 만들고 파일 넣기
mkdir ~/chat-library
cd ~/chat-library
# → library.js, package.json, public/index.html 을 이 구조 그대로 복사

# 3. 실행
node library.js
```

브라우저에서 `http://localhost:7860` 접속. 끝.

### PC (Windows/Mac)

Node.js만 깔려 있으면 동일:

```bash
cd "6. 도서관"
node library.js
```

## 백업 파일 넣는 법

첫 실행 때 앱 폴더 안에 `data/chats/`, `data/images/` 가 자동으로 생긴다.
**여기에만 넣으면 됨.** (구버전과 달리 SD카드 자동 탐색 안 함 — 경로가 꼬일 일이 없음)

```
data/
├── chats/
│   ├── 캐릭터 이름/
│   │   ├── 2026-01-01@10h30m.jsonl
│   │   └── 2026-02-15@14h20m.jsonl
│   └── 다른 캐릭터/
│       └── ...
└── images/
    ├── 캐릭터 이름/   ← 캐릭터별 이미지 (NAI 생성물 등)
    │   └── xxx.png
    └── 기타이미지.png
```

- `chats/캐릭터명/*.jsonl` — SillyTavern의 chats 폴더를 통째로 복사하면 됨
- `images/캐릭터명/` — 폴더명이 캐릭터명과 (따옴표·공백이 좀 달라도) 맞으면 자동 연결됨
- `characters/`, `thumbnails/` 폴더를 넣으면 캐릭터 아바타로 사용
- 아바타가 없으면 `images/캐릭터명/`의 첫 이미지를 아바타로 씀

### 다른 경로를 쓰고 싶으면

```bash
# 경로 하나
CHAT_LIBRARY_PATH=/sdcard/ST-backup node library.js

# 여러 개 (콜론으로 구분)
CHAT_LIBRARY_PATH=/sdcard/ST-backup:/sdcard/Download/backup node library.js
```

> Windows에서는 드라이브 문자(`C:`)의 콜론 때문에 `CHAT_LIBRARY_PATH`가 잘리므로,
> 그냥 기본 `data/` 폴더를 쓰는 걸 권장.

### 포트 변경

```bash
PORT=3000 node library.js
```

### 접속 키 (공개 서버에 올릴 때)

외부에서 접속 가능한 서버(클라우드, 터널 등)에 올린다면 접속 키를 걸어두는 걸 권장.

```bash
LIBRARY_KEY=원하는키 node library.js
```

- 켜두면 모든 요청에 키를 요구함. 최초 1회 `http://주소/?key=원하는키` 로 접속하면 쿠키에 저장돼서 이후엔 그냥 접속됨
- 설정 안 하면(기본값) 키 없이 동작 — 폰/PC 로컬 전용이면 없어도 됨

## 화면 구성

- **홈** — 믹스테이프 카세트에 도서관 통계(캐릭터/채팅/이미지 수)가 표시됨
- **서재(왼쪽 사이드바)** — 캐릭터 목록. 검색·태그 필터 지원
- **테이프 목록** — 캐릭터를 고르면 채팅이 SIDE 1, 2, 3... 테이프로 나열
- **채팅 뷰어** — 메신저 버블 스타일. 캐릭터=옐로우 버블, 유저=다크 버블
- **갤러리** — 상단 🖼 버튼. 폴더별로 이미지 모아보기, 클릭하면 라이트박스

## 기능

- **도서관 이름 바꾸기** — 상단 제목 클릭 → 입력 → Enter. 카세트 라벨에도 반영됨
- **채팅별 태그** — 채팅 항목에 마우스 올리면 `+태그` 버튼. 태그는 사이드바 필터로도 사용됨. `data/tags.json`에 저장
- **스크롤 위치 기억** — 채팅을 나갔다 다시 들어와도 읽던 위치 유지 (세션 내)
- **자동 클린업** — thinking/CoT, OOC, `<pic>`, `<imageInfo>`, infoblock, 코드블록 상태창 등을 표시에서 제거
- **이미지 표시** — 메시지의 `extra.media`/`extra.image`(base64·파일명 모두)를 자동 해석. 파일명이 안 맞으면 `images/캐릭터명/`에서 fuzzy 매칭
- **서버 없이도 사용 가능** — `public/index.html`을 브라우저로 직접 열고 파일/폴더를 드래그&드롭하면 오프라인 모드로 동작 (태그는 localStorage에 저장)

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| 캐릭터가 안 보임 | `data/chats/캐릭터명/` 안에 `.jsonl`이 있는지. 폴더 없이 파일만 두면 인식 안 됨 |
| 이미지가 안 뜸 | `data/images/캐릭터명/` 폴더명이 캐릭터명과 맞는지 (따옴표 종류가 달라도 되지만 철자는 같아야 함). 서버 콘솔에 `📷 이미지 폴더 발견` 로그가 뜨는지 확인 |
| 아바타가 안 뜸 | `characters/` 또는 `thumbnails/`에 캐릭터명과 같은 이름의 png가 있는지 |
| 폰에서 접속 안 됨 | 같은 기기라면 `localhost:7860`. Termux 백그라운드 종료 방지(acquire wakelock) 확인 |
| 포트 충돌 | `PORT=다른번호 node library.js` |
