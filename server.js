#!/usr/bin/env node
// ============================================================
//  Chat Library Server — SillyTavern 백업 뷰어
//  Termux / PC 어디서든 실행 가능
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// ── 설정 ──────────────────────────────────────────────────
const PORT = process.env.PORT || 7860;

// 데이터 경로: 환경변수 또는 기본값
// Termux: ~/storage/shared/ST-backup  또는 ~/SillyTavern/data/default-user
// SD카드: /storage/emulated/0/ST-backup  또는 /sdcard/ST-backup
const DATA_ROOTS = (process.env.CHAT_LIBRARY_PATH || '').split(':').filter(Boolean);

// 기본 탐색 경로들
const HOME = process.env.HOME || '/data/data/com.termux/files/home';
const DEFAULT_SEARCH_PATHS = [
    // SD카드 백업 (0000-0000 등 SD카드 ID는 자동 탐색)
    path.join(HOME, 'storage'),  // ~/storage 아래 SD카드 ID 폴더들을 자동 탐색
    // 일반 경로들
    path.join(HOME, 'ST-backup'),
    path.join(HOME, 'st-backup'),
    path.join(HOME, 'SillyTavern/data/default-user'),
    path.join(HOME, 'sillytavern/data/default-user'),
    '/storage/emulated/0/ST-backup',
    '/storage/emulated/0/Download/ST-backup',
    '/sdcard/ST-backup',
    path.join(HOME, 'storage/shared/ST-backup'),
];

function findDataRoot() {
    if (DATA_ROOTS.length > 0) return DATA_ROOTS;

    const found = [];

    // 1. ~/storage 아래에서 SD카드 Backup 폴더 자동 탐색
    //    구조: ~/storage/XXXX-XXXX/Backup/chats/ 및 ~/storage/XXXX-XXXX/Backup/images/
    const storageBase = path.join(HOME, 'storage');
    if (fs.existsSync(storageBase)) {
        try {
            const entries = fs.readdirSync(storageBase, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
                // SD카드 ID 패턴 (예: 0000-0000) 또는 아무 폴더나
                const backupDir = path.join(storageBase, entry.name, 'Backup');
                if (fs.existsSync(backupDir)) {
                    console.log(`  ✓ SD카드 백업 발견: ${backupDir}`);
                    found.push(backupDir);
                }
                // backup (소문자)도 확인
                const backupDir2 = path.join(storageBase, entry.name, 'backup');
                if (fs.existsSync(backupDir2) && backupDir2 !== backupDir) {
                    console.log(`  ✓ SD카드 백업 발견: ${backupDir2}`);
                    found.push(backupDir2);
                }
            }
        } catch (e) {}
    }

    // 2. 나머지 기본 경로들
    for (const p of DEFAULT_SEARCH_PATHS) {
        if (p.includes('/storage') && p === storageBase) continue; // 이미 처리함
        if (fs.existsSync(p)) {
            // Backup 하위 폴더가 있는지도 확인
            const backupSub = path.join(p, 'Backup');
            if (fs.existsSync(backupSub)) {
                if (!found.includes(backupSub)) {
                    console.log(`  ✓ 발견: ${backupSub}`);
                    found.push(backupSub);
                }
            } else if (!found.includes(p)) {
                console.log(`  ✓ 발견: ${p}`);
                found.push(p);
            }
        }
    }

    if (found.length === 0) {
        // 기본 폴더 생성
        const defaultPath = path.join(HOME, 'ST-backup');
        fs.mkdirSync(path.join(defaultPath, 'chats'), { recursive: true });
        fs.mkdirSync(path.join(defaultPath, 'images'), { recursive: true });
        console.log(`  📁 기본 폴더 생성됨: ${defaultPath}`);
        console.log(`     chats/ 에 캐릭터 폴더를, images/ 에 이미지를 넣어주세요`);
        found.push(defaultPath);
    }
    return found;
}

// ── 채팅 파일 스캔 ────────────────────────────────────────
function scanAllData(roots) {
    const characters = {}; // { charName: { chats: [...], avatar: null, images: [] } }
    const allImages = [];  // [ { name, path, char } ]

    for (const root of roots) {
        // SillyTavern 구조: chats/캐릭터명/파일.jsonl
        const chatsDir = findSubdir(root, 'chats');
        if (chatsDir) {
            scanChatsDir(chatsDir, characters);
        }

        // 이미지: Backup/images/캐릭터명/ 구조
        const imagesDir = findSubdir(root, 'images');
        if (imagesDir) {
            scanImagesDirByChar(imagesDir, allImages, characters);
        }

        // 기타 이미지 경로들
        const extraImgDirs = [
            findSubdir(root, 'user/images'),
            findSubdir(root, 'thumbnails'),
            findSubdir(root, 'characters'),
        ].filter(Boolean);

        for (const imgDir of extraImgDirs) {
            scanImagesDir(imgDir, allImages, characters);
        }

        // 루트 자체에 캐릭터 폴더가 있을 수도 있음 (chats/ 없이)
        if (!chatsDir) {
            try {
                const entries = fs.readdirSync(root, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory() && entry.name !== 'images' && entry.name !== 'thumbnails') {
                        const charDir = path.join(root, entry.name);
                        const jsonls = fs.readdirSync(charDir).filter(f => f.endsWith('.jsonl'));
                        if (jsonls.length > 0) {
                            scanChatsDir(root, characters);
                            break;
                        }
                    }
                }
            } catch (e) {}
        }
    }

    return { characters, allImages };
}

// images/캐릭터명/ 구조로 된 이미지 스캔
function scanImagesDirByChar(imagesDir, allImages, characters) {
    try {
        const entries = fs.readdirSync(imagesDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(imagesDir, entry.name);

            if (entry.isDirectory()) {
                // 캐릭터 이름 폴더
                const charName = entry.name;
                if (!characters[charName]) {
                    characters[charName] = { chats: [], avatar: null, images: [] };
                }

                try {
                    const imgFiles = fs.readdirSync(fullPath).filter(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f));
                    for (const imgFile of imgFiles) {
                        const imgPath = path.join(fullPath, imgFile);
                        allImages.push({ name: imgFile, path: imgPath, char: charName, dir: charName });
                        if (!characters[charName].images) characters[charName].images = [];
                        characters[charName].images.push({ name: imgFile, path: imgPath });
                    }
                } catch (e) {}
            } else if (/\.(png|jpg|jpeg|webp|gif)$/i.test(entry.name)) {
                // 루트 이미지
                allImages.push({ name: entry.name, path: fullPath, char: '', dir: '' });
            }
        }
    } catch (e) {}
}

function findSubdir(root, name) {
    const p = path.join(root, name);
    return fs.existsSync(p) ? p : null;
}

function scanChatsDir(chatsDir, characters) {
    try {
        const charDirs = fs.readdirSync(chatsDir, { withFileTypes: true });
        for (const dir of charDirs) {
            if (!dir.isDirectory()) continue;
            const charName = dir.name;
            const charPath = path.join(chatsDir, charName);

            if (!characters[charName]) {
                characters[charName] = { chats: [], avatar: null };
            }

            try {
                const files = fs.readdirSync(charPath).filter(f => f.endsWith('.jsonl'));
                for (const file of files) {
                    const filePath = path.join(charPath, file);
                    const stat = fs.statSync(filePath);
                    characters[charName].chats.push({
                        name: file.replace('.jsonl', ''),
                        file: file,
                        path: filePath,
                        size: stat.size,
                        modified: stat.mtime.toISOString(),
                    });
                }
            } catch (e) {}
        }
    } catch (e) {}
}

function scanImagesDir(imgDir, allImages, characters) {
    try {
        const walkDir = (dir, prefix) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walkDir(fullPath, prefix ? `${prefix}/${entry.name}` : entry.name);
                } else if (/\.(png|jpg|jpeg|webp|gif)$/i.test(entry.name)) {
                    allImages.push({
                        name: entry.name,
                        path: fullPath,
                        dir: prefix || '',
                    });

                    // 캐릭터 아바타 매칭
                    for (const charName of Object.keys(characters)) {
                        if (entry.name.toLowerCase() === charName.toLowerCase() + '.png' ||
                            entry.name.toLowerCase() === charName.toLowerCase().replace(/\s/g, '_') + '.png') {
                            if (!characters[charName].avatar) {
                                characters[charName].avatar = fullPath;
                            }
                        }
                    }
                }
            }
        };
        walkDir(imgDir, '');
    } catch (e) {}
}

// ── 채팅 파일 파싱 ────────────────────────────────────────
function parseChatFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const messages = [];

    for (const line of lines) {
        try {
            const msg = JSON.parse(line.trim());
            messages.push(msg);
        } catch (e) {}
    }
    return messages;
}

// ── 정규식 필터 (settings.json 에서 가져온 ENABLED 규칙들) ──
const CLEANUP_REGEXES = [
    // [1] 띵킹 — thinking/cot 태그 제거
    { find: /(?:```?\w*[\r\n]?)?<(thought|cot|thinking|CoT|think|starter)([\s\S]*?)<\/(cot|thinking|CoT|think|starter)>(?:[\r\n]?```?)?/g, replace: '' },
    // [5] /del image prompt — <pic>...</pic> 제거
    { find: /<pic>[\s\S]*?<\/pic>/g, replace: '' },
    // [6] imageInfo — <imageInfo>...</imageInfo> 제거
    { find: /<[Ii][Mm][Aa][Gg][Ee][Ii][Nn][Ff][Oo]>([\s\S]*?)<\/[Ii][Mm][Aa][Gg][Ee][Ii][Nn][Ff][Oo]>/g, replace: '' },
    // [12] 이미지프롬 — <pic prompt="...">
    { find: /<pic\s+prompt="[^"]*"\s*>/g, replace: '' },
    // [13] 픽 제거 — </pic>
    { find: /<\/pic>/g, replace: '' },
    // [14] ➛ 제거
    { find: /➛/g, replace: '' },
    // [4] 가리기 — 🥨 Sex Position...
    { find: /🥨 Sex Position[\s\S]*?(?=```)/g, replace: '' },
];

function cleanMessage(text) {
    if (!text) return '';
    let cleaned = text;
    for (const rule of CLEANUP_REGEXES) {
        cleaned = cleaned.replace(rule.find, rule.replace);
    }
    // 빈 줄 정리
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
    return cleaned;
}

// ── HTTP 서버 ─────────────────────────────────────────────
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

function serveStatic(filePath, res) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';

    try {
        const data = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
    } catch (e) {
        res.writeHead(404);
        res.end('Not Found');
    }
}

function jsonResponse(res, data) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

// ── 메인 ──────────────────────────────────────────────────
console.log('');
console.log('  📚 Chat Library — 채팅 도서관');
console.log('  ─────────────────────────────');
console.log('  데이터 경로 탐색 중...');

const dataRoots = findDataRoot();
console.log('');

const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');

    // ── API 라우트 ──
    if (pathname === '/api/scan') {
        // 전체 스캔
        const { characters, allImages } = scanAllData(dataRoots);

        // 캐릭터 목록 (채팅 내용 제외, 메타데이터만)
        const charList = {};
        for (const [name, data] of Object.entries(characters)) {
            charList[name] = {
                chatCount: data.chats.length,
                imageCount: (data.images || []).length,
                avatar: data.avatar ? `/api/image?path=${encodeURIComponent(data.avatar)}` : null,
                chats: data.chats.map(c => ({
                    name: c.name,
                    file: c.file,
                    size: c.size,
                    modified: c.modified,
                })),
            };
        }

        jsonResponse(res, {
            characters: charList,
            imageCount: allImages.length,
            roots: dataRoots,
        });
        return;
    }

    if (pathname === '/api/chat') {
        // 특정 채팅 파일 읽기
        const charName = parsed.query.char;
        const fileName = parsed.query.file;
        if (!charName || !fileName) {
            jsonResponse(res, { error: 'char and file required' });
            return;
        }

        const { characters } = scanAllData(dataRoots);
        const charData = characters[charName];
        if (!charData) {
            jsonResponse(res, { error: 'Character not found' });
            return;
        }

        const chat = charData.chats.find(c => c.file === fileName);
        if (!chat) {
            jsonResponse(res, { error: 'Chat file not found' });
            return;
        }

        const messages = parseChatFile(chat.path);
        const cleaned = messages.map(m => ({
            name: m.name || (m.is_user ? 'User' : charName),
            is_user: !!m.is_user,
            mes: cleanMessage(m.mes || ''),
            send_date: m.send_date || m.create_date || '',
            extra: m.extra ? {
                image: m.extra.image || null,
                title: m.extra.title || null,
            } : null,
            swipe_id: m.swipe_id,
            swipes: m.swipes ? m.swipes.length : 0,
        }));

        jsonResponse(res, {
            char: charName,
            file: chat.file,
            name: chat.name,
            messages: cleaned,
            avatar: charData.avatar ? `/api/image?path=${encodeURIComponent(charData.avatar)}` : null,
        });
        return;
    }

    if (pathname === '/api/images') {
        // 이미지 갤러리
        const { allImages } = scanAllData(dataRoots);
        const charFilter = parsed.query.char;

        let filtered = allImages;
        if (charFilter) {
            filtered = allImages.filter(img =>
                img.dir.toLowerCase().includes(charFilter.toLowerCase()) ||
                img.name.toLowerCase().includes(charFilter.toLowerCase())
            );
        }

        jsonResponse(res, {
            images: filtered.map(img => ({
                name: img.name,
                dir: img.dir,
                url: `/api/image?path=${encodeURIComponent(img.path)}`,
            })),
        });
        return;
    }

    if (pathname === '/api/image') {
        // 이미지 서빙 (경로 검증)
        const imgPath = parsed.query.path;
        if (!imgPath) { res.writeHead(400); res.end('No path'); return; }

        // 보안: dataRoots 아래에 있는지 확인
        const resolved = path.resolve(imgPath);
        const allowed = dataRoots.some(root => resolved.startsWith(path.resolve(root)));
        if (!allowed) {
            // 캐릭터 이미지 등 다른 경로도 허용
            const homeAllowed = resolved.startsWith(HOME);
            if (!homeAllowed) {
                res.writeHead(403); res.end('Forbidden'); return;
            }
        }

        serveStatic(resolved, res);
        return;
    }

    if (pathname === '/api/roots') {
        jsonResponse(res, { roots: dataRoots });
        return;
    }

    // ── 정적 파일 서빙 ──
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(__dirname, 'public', filePath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        serveStatic(filePath, res);
    } else {
        // SPA fallback
        serveStatic(path.join(__dirname, 'public', 'index.html'), res);
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`  🌐 서버 시작: http://localhost:${PORT}`);
    console.log(`  📱 Termux에서: http://localhost:${PORT}`);
    console.log('');
    console.log('  사용법:');
    console.log(`  1. 백업 파일을 다음 경로에 넣으세요:`);
    for (const root of dataRoots) {
        console.log(`     📂 ${root}`);
    }
    console.log('');
    console.log('  폴더 구조:');
    console.log('    ~/storage/XXXX-XXXX/Backup/');
    console.log('    ├── chats/');
    console.log('    │   ├── Adonis \'Baron\' Broussard/');
    console.log('    │   │   ├── 2024-12-01@10h30m.jsonl');
    console.log('    │   │   └── ...');
    console.log('    │   ├── Caius Reed/');
    console.log('    │   └── ...');
    console.log('    └── images/');
    console.log('        ├── Adonis \'Baron\' Broussard/');
    console.log('        │   └── (생성된 이미지들)');
    console.log('        └── ...');
    console.log('');
    console.log('  또는 환경변수로 경로 지정:');
    console.log('    CHAT_LIBRARY_PATH=/sdcard/backup node server.js');
    console.log('');
});
