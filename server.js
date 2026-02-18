#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 7860;
// 환경변수나 인자가 없으면 아래 경로들을 기본으로 탐색
const DATA_ROOTS = (process.env.CHAT_LIBRARY_PATH || '').split(':').filter(Boolean);
const HOME = process.env.HOME || '/data/data/com.termux/files/home';

// 기본 탐색 경로 (SD카드 포함)
const DEFAULT_SEARCH_PATHS = [
    '/storage/0000-0000/Backup', // 👈 본인의 SD카드 경로로 수정 필요
    path.join(HOME, 'storage/shared/ST-backup'),
    path.join(HOME, 'ST-backup'),
    '/sdcard/ST-backup',
    path.join(HOME, 'SillyTavern/data/default-user'),
];

const TAGS_FILE = path.join(HOME, '.chat-library-file-tags.json'); // 파일명 변경 (구조가 바뀌어서)
const SETTINGS_FILE = path.join(HOME, '.chat-library-settings.json');

function loadJson(f) { try { if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f,'utf-8')); } catch(e){} return {}; }
function saveJson(f,d) { try { fs.writeFileSync(f,JSON.stringify(d,null,2),'utf-8'); } catch(e){} }

// ... (findDataRoot, scanAllData 등의 함수는 기존과 동일하므로 생략하거나 기존 코드 유지) ...
// ※ scanChatsDir 함수에서 파일명 정보를 정확히 넘겨줘야 함 (이미 기존 코드에서 하고 있음)

// ── 데이터 스캔 로직 (기존 유지하되 태그 매핑 방식 변경을 위해 구조 확인) ──
function findDataRoot() {
    if (DATA_ROOTS.length > 0) return DATA_ROOTS;
    const found = [];
    // 1순위 강제 지정 경로 (SD카드)
    const sdBackup = '/storage/0000-0000/Backup'; // 👈 여기도 확인
    if(fs.existsSync(sdBackup)) found.push(sdBackup);

    // 나머지 경로 탐색
    for (const p of DEFAULT_SEARCH_PATHS) {
        if (fs.existsSync(p) && !found.includes(p)) found.push(p);
    }
    return found;
}

function scanAllData(roots) {
    const characters = {};
    const allImages = []; // 이미지 경로 매핑용

    // 1. 재귀적으로 디렉토리 탐색 함수
    const walk = (dir) => {
        try {
            const list = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of list) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    // chats 폴더인지 확인
                    if (entry.name === 'chats') {
                        scanChatsFolder(fullPath, characters);
                    } else if (entry.name === 'images') {
                        // 이미지 폴더 스캔 (파일명 -> 전체경로 매핑을 위해)
                        scanImagesRecursive(fullPath, allImages);
                    } else {
                        walk(fullPath);
                    }
                }
            }
        } catch(e) {}
    };

    for (const root of roots) walk(root);
    return { characters, allImages };
}

function scanChatsFolder(chatsDir, characters) {
    try {
        const charDirs = fs.readdirSync(chatsDir, { withFileTypes: true });
        for (const entry of charDirs) {
            if (!entry.isDirectory()) continue;
            const charName = entry.name;
            if (!characters[charName]) characters[charName] = { chats: [], avatar: null };
            
            const charPath = path.join(chatsDir, charName);
            const files = fs.readdirSync(charPath).filter(f => f.endsWith('.jsonl'));
            
            for (const file of files) {
                const filePath = path.join(charPath, file);
                const stat = fs.statSync(filePath);
                characters[charName].chats.push({
                    name: file.replace('.jsonl', ''),
                    file: file, // 파일명 (확장자 포함)
                    path: filePath,
                    size: stat.size,
                    modified: stat.mtime.toISOString(),
                });
            }
        }
    } catch(e) {}
}

function scanImagesRecursive(dir, allImages) {
    try {
        const files = fs.readdirSync(dir, { withFileTypes: true });
        for (const f of files) {
            const fp = path.join(dir, f.name);
            if (f.isDirectory()) scanImagesRecursive(fp, allImages);
            else if (/\.(png|jpg|webp|gif)$/i.test(f.name)) {
                allImages.push({ name: f.name, path: fp });
            }
        }
    } catch(e) {}
}

// ── 채팅 파싱 (이미지 정보 extra 포함) ──
function parseChatFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return content.trim().split('\n').map(line => {
            try { return JSON.parse(line.trim()); } catch (e) { return null; }
        }).filter(Boolean);
    } catch(e) { return []; }
}

const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;
    
    // CORS & Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.end(); return; }

    // API: 스캔
    if (pathname === '/api/scan') {
        const roots = findDataRoot();
        const { characters, allImages } = scanAllData(roots);
        const tags = loadJson(TAGS_FILE); // { CharName: { FileName: [tags] } }

        // 응답 데이터 구성
        const charList = {};
        for (const [name, data] of Object.entries(characters)) {
            charList[name] = {
                chats: data.chats.map(c => ({
                    ...c,
                    // 해당 캐릭터의 해당 파일에 대한 태그 가져오기
                    tags: (tags[name] && tags[name][c.file]) ? tags[name][c.file] : [] 
                })),
                imageCount: 0 
            };
        }
        
        // 이미지 맵 (파일명 -> 경로)
        const imageMap = {};
        for(const img of allImages) imageMap[img.name] = img.path;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ characters: charList, imageMap }));
        return;
    }

    // API: 채팅 내용 로드
    if (pathname === '/api/chat') {
        const charName = parsed.query.char;
        const fileName = parsed.query.file;
        const roots = findDataRoot();
        const { characters } = scanAllData(roots);
        
        if (!characters[charName]) return res.end('{}');
        const chat = characters[charName].chats.find(c => c.file === fileName);
        if (!chat) return res.end('{}');

        const messages = parseChatFile(chat.path);
        // 클라이언트에 그대로 전달 (extra 포함)
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messages }));
        return;
    }

    // API: 태그 저장
    if (pathname === '/api/tags') {
        if (req.method === 'POST') {
            let body = '';
            req.on('data', c => body += c);
            req.on('end', () => {
                const data = JSON.parse(body); // { char, file, tags }
                const allTags = loadJson(TAGS_FILE);
                
                if (!allTags[data.char]) allTags[data.char] = {};
                allTags[data.char][data.file] = data.tags;
                
                saveJson(TAGS_FILE, allTags);
                res.end(JSON.stringify({ ok: true }));
            });
        }
        return;
    }

    // API: 이미지 서빙
    if (pathname === '/api/image') {
        const imgPath = parsed.query.path;
        if (fs.existsSync(imgPath)) {
            fs.createReadStream(imgPath).pipe(res);
        } else {
            res.writeHead(404); res.end();
        }
        return;
    }

    // 정적 파일 (index.html 등)
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(__dirname, 'public', filePath);
    if (fs.existsSync(filePath)) {
        fs.createReadStream(filePath).pipe(res);
    } else {
        // Fallback to index if checking subpaths or SPA
        const idx = path.join(__dirname, 'public', 'index.html');
        if(fs.existsSync(idx)) fs.createReadStream(idx).pipe(res);
        else res.end('Not Found');
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`서버 실행됨: http://localhost:${PORT}`);
    console.log(`탐색 경로 확인 중...`);
    const roots = findDataRoot();
    roots.forEach(r => console.log(`  📂 ${r}`));
});
