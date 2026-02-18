# 📚 채팅 도서관 (Chat Library)

SillyTavern 채팅 백업 파일을 도서관처럼 정리해서 보여주는 뷰어.  
터먹스(Termux)에서 실행 가능, SD카드 백업도 OK.

## 설치 & 실행

```bash
# 1. 폴더 만들기 (아무 데나)
mkdir ~/chat-library
cd ~/chat-library

# 2. 파일 넣기 (server.js, public/index.html, package.json)

# 3. 실행
node server.js
```

**외부 npm 패키지 필요 없음!** 순수 Node.js만 씀.

## 백업 파일 넣는 법

### 방법 1: 기본 폴더 사용
```
~/ST-backup/
├── chats/
│   ├── Adonis 'Baron' Broussard/
│   │   ├── 2024-12-01@10h30m.jsonl
│   │   └── 2025-01-15@14h20m.jsonl
│   ├── Caius Reed/
│   │   └── ...
│   └── Horangi/
│       └── ...
└── images/
    └── (NAI 등으로 생성한 이미지들)
```

터먹스 파일 매니저에서 chats 폴더를 통째로 여기로 복사하면 됨!

### 방법 2: 경로 직접 지정
```bash
CHAT_LIBRARY_PATH=/sdcard/ST-backup node server.js
```

### 방법 3: SD카드에서 바로 읽기
```bash
CHAT_LIBRARY_PATH=/storage/emulated/0/ST-backup node server.js
```

## 자동 탐색 경로

아무 설정 안 하면 다음 경로들을 자동으로 찾음:
- `~/ST-backup`
- `~/SillyTavern/data/default-user`
- `/storage/emulated/0/ST-backup`
- `/sdcard/ST-backup`

## 정규식 필터

settings.json에서 가져온 정규식이 자동 적용됨:
- `<imageInfo>` 태그 숨김
- `<pic>` 태그 숨김  
- thinking/cot 태그 숨김
- OOC 숨김
- ➛ 기호 제거
- 기타...

## 이미지 표시

SillyTavern이 채팅에 넣는 이미지는 `extra.image` 필드에 있음:
- **base64**: `data:image/png;base64,...` → 바로 표시
- **파일 경로**: 서버가 images 폴더에서 찾아서 표시

## 포트 변경
```bash
PORT=3000 node server.js
```
