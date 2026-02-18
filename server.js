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

const DATA_ROOTS = (process.env.CHAT_LIBRARY_PATH || '').split(':').filter(Boolean);

const HOME = process.env.HOME || '/data/data/com.termux/files/home';
const DEFAULT_SEARCH_PATHS = [
    path.join(HOME, 'storage'),
    path.join(HOME, 'ST-backup'),
    path.join(HOME, 'st-backup'),
    path.join(HOME, 'SillyTavern/data/default-user'),
    path.join(HOME, 'sillytavern/data/default-user'),
    '/storage/emulated/0/ST-backup',
    '/storage/emulated/0/Download/ST-backup',
    '/sdcard/ST-backup',
    path.join(HOME, 'storage/shared/ST-backup'),
];

// ── 태그/설정 저장 ──
const TAGS_FILE = path.join(HOME, '.chat-library-tags.json');
const SETTINGS_FILE = path.join(HOME, '.chat-library-settings.json');

function loadJson(file) {
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (e) {}
    return {};
}
function saveJson(file, data) {
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8'); } catch (e) { console.error('저장 실패:', e.message); }
}

function findDataRoot() {
    if (DATA_ROOTS.length > 0) return DATA_ROOTS;
    const found = [];
    const storageBase = path.join(HOME, 'storage');
    if (fs.existsSync(storageBase)) {
        try {
            const entries = fs.readdirSync(storageBase, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
                for (const bname of ['Backup', 'backup']) {
                    const bd = path.join(storageBase, entry.name, bname);
                    if (fs.existsSync(bd) && !found.includes(bd)) {
                        console.log(`  ✓ SD카드 백업 발견: ${bd}`);
                        found.push(bd);
                    }
                }
            }
        } catch (e) {}
    }
    for (const p of DEFAULT_SEARCH_PATHS) {
        if (p === storageBase) continue;
        if (fs.existsSync(p)) {
            const bs = path.join(p, 'Backup');
            if (fs.existsSync(bs)) { if (!found.includes(bs)) { console.log(`  ✓ 발견: ${bs}`); found.push(bs); } }
            else if (!found.includes(p)) { console.log(`  ✓ 발견: ${p}`); found.push(p); }
        }
    }
    if (found.length === 0) {
        const dp = path.join(HOME, 'ST-backup');
        fs.mkdirSync(path.join(dp, 'chats'), { recursive: true });
        fs.mkdirSync(path.join(dp, 'images'), { recursive: true });
        console.log(`  📁 기본 폴더 생성됨: ${dp}`);
        found.push(dp);
    }
    return found;
}

// ── 스캔 ──
function scanAllData(roots) {
    const characters = {};
    const allImages = [];
    for (const root of roots) {
        const chatsDir = findSubdir(root, 'chats');
        if (chatsDir) scanChatsDir(chatsDir, characters);
        const imagesDir = findSubdir(root, 'images');
        if (imagesDir) scanImagesDirByChar(imagesDir, allImages, characters);
        for (const sub of ['user/images', 'thumbnails', 'characters']) {
            const d = findSubdir(root, sub);
            if (d) scanImagesDir(d, allImages, characters);
        }
        if (!chatsDir) {
            try {
                const entries = fs.readdirSync(root, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory() && !['images', 'thumbnails'].includes(entry.name)) {
                        const charDir = path.join(root, entry.name);
                        if (fs.readdirSync(charDir).some(f => f.endsWith('.jsonl'))) {
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

function scanImagesDirByChar(imagesDir, allImages, characters) {
    try {
        const entries = fs.readdirSync(imagesDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(imagesDir, entry.name);
            if (entry.isDirectory()) {
                const charName = entry.name;
                if (!characters[charName]) characters[charName] = { chats: [], avatar: null, images: [] };
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
            if (!characters[charName]) characters[charName] = { chats: [], avatar: null };
            try {
                const files = fs.readdirSync(charPath).filter(f => f.endsWith('.jsonl'));
                for (const file of files) {
                    const filePath = path.join(charPath, file);
                    const stat = fs.statSync(filePath);
                    characters[charName].chats.push({
                        name: file.replace('.jsonl', ''),
                        file, path: filePath,
                        size: stat.size,
                        modified: stat.mtime.toISOString(),
                    });
                }
            } catch (e) {}
        }
    } catch (e) {}
}

// ── 개선된 아바타 매칭 (한글/특수문자 지원) ──
function normalizeForMatch(str) {
    return str.toLowerCase()
        .replace(/[''"`]/g, '')
        .replace(/\s+/g, '')
        .replace(/[_\-\.]/g, '')
        .replace(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ]/g, '');
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
                    allImages.push({ name: entry.name, path: fullPath, dir: prefix || '' });
                    const fileBase = entry.name.replace(/\.(png|jpg|jpeg|webp|gif)$/i, '');
                    const fileNorm = normalizeForMatch(fileBase);
                    for (const charName of Object.keys(characters)) {
                        const charNorm = normalizeForMatch(charName);
                        if (fileNorm === charNorm ||
                            (fileNorm.includes(charNorm) && charNorm.length >= 2) ||
                            (charNorm.includes(fileNorm) && fileNorm.length >= 2)) {
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

// ── 채팅 파일 파싱 ──
function parseChatFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.trim().split('\n').map(line => {
        try { return JSON.parse(line.trim()); } catch (e) { return null; }
    }).filter(Boolean);
}

// ── 정규식 필터 ──
const CLEANUP_REGEXES = [
    { find: /(?:```?\w*[\r\n]?)?<(thought|cot|thinking|CoT|think|starter)([\s\S]*?)<\/(thought|cot|thinking|CoT|think|starter)>(?:[\r\n]?```?)?/g, replace: '' },
    { find: /<pic>[\s\S]*?<\/pic>/g, replace: '' },
    { find: /<[Ii][Mm][Aa][Gg][Ee][Ii][Nn][Ff][Oo]>([\s\S]*?)<\/[Ii][Mm][Aa][Gg][Ee][Ii][Nn][Ff][Oo]>/g, replace: '' },
    { find: /<pic\s+prompt="[^"]*"\s*>/g, replace: '' },
    { find: /<\/pic>/g, replace: '' },
    { find: /➛/g, replace: '' },
    { find: /🥨 Sex Position[\s\S]*?(?=```)/g, replace: '' },
    { find: /\[OOC:[\s\S]*?\]/g, replace: '' },
    { find: /<OOC>[\s\S]*?<\/OOC>/g, replace: '' },
    { find: /<extra_prompt>[\s\S]*?<\/extra_prompt>/g, replace: '' },
];

function cleanMessage(text) {
    if (!text) return '';
    let c = text;
    for (const r of CLEANUP_REGEXES) c = c.replace(r.find, r.replace);
    return c.replace(/\n{3,}/g, '\n\n').trim();
}

// ── HTTP ──
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function serveStatic(filePath, res) {
    const ext = path.extname(filePath).toLowerCase();
    try {
        const data = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(data);
    } catch (e) { res.writeHead(404); res.end('Not Found'); }
}
function jsonResponse(res, data) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}
function readBody(req) {
    return new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
}

// ── 메인 ──
console.log('\n  📚 Chat Library — 채팅 도서관\n  ─────────────────────────────\n  데이터 경로 탐색 중...');
const dataRoots = findDataRoot();
console.log('');

const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    if (pathname === '/api/scan') {
        const { characters, allImages } = scanAllData(dataRoots);
        const tags = loadJson(TAGS_FILE);
        const charList = {};
        for (const [name, data] of Object.entries(characters)) {
            charList[name] = {
                chatCount: data.chats.length,
                imageCount: (data.images || []).length,
                avatar: data.avatar ? `/api/image?path=${encodeURIComponent(data.avatar)}` : null,
                tags: tags[name] || [],
                chats: data.chats.map(c => ({ name: c.name, file: c.file, size: c.size, modified: c.modified })),
            };
        }
        jsonResponse(res, { characters: charList, imageCount: allImages.length, roots: dataRoots });
        return;
    }

    if (pathname === '/api/chat') {
        const charName = parsed.query.char;
        const fileName = parsed.query.file;
        if (!charName || !fileName) { jsonResponse(res, { error: 'char and file required' }); return; }
        const { characters } = scanAllData(dataRoots);
        const charData = characters[charName];
        if (!charData) { jsonResponse(res, { error: 'Character not found' }); return; }
        const chat = charData.chats.find(c => c.file === fileName);
        if (!chat) { jsonResponse(res, { error: 'Chat file not found' }); return; }
        const messages = parseChatFile(chat.path);
        const cleaned = messages.map(m => ({
            name: m.name || (m.is_user ? 'User' : charName),
            is_user: !!m.is_user,
            mes: cleanMessage(m.mes || ''),
            send_date: m.send_date || m.create_date || '',
            extra: m.extra ? { image: m.extra.image || null, title: m.extra.title || null } : null,
            swipe_id: m.swipe_id,
            swipes: m.swipes ? m.swipes.length : 0,
        }));
        jsonResponse(res, {
            char: charName, file: chat.file, name: chat.name, messages: cleaned,
            avatar: charData.avatar ? `/api/image?path=${encodeURIComponent(charData.avatar)}` : null,
        });
        return;
    }

    if (pathname === '/api/images') {
        const { allImages } = scanAllData(dataRoots);
        const charFilter = parsed.query.char;
        let filtered = allImages;
        if (charFilter) {
            filtered = allImages.filter(img =>
                img.dir.toLowerCase().includes(charFilter.toLowerCase()) ||
                img.name.toLowerCase().includes(charFilter.toLowerCase())
            );
        }
        const folders = {};
        for (const img of filtered) {
            const dir = img.dir || '기타';
            if (!folders[dir]) folders[dir] = [];
            folders[dir].push({ name: img.name, dir: img.dir, url: `/api/image?path=${encodeURIComponent(img.path)}` });
        }
        jsonResponse(res, {
            images: filtered.map(img => ({ name: img.name, dir: img.dir, url: `/api/image?path=${encodeURIComponent(img.path)}` })),
            folders,
        });
        return;
    }

    if (pathname === '/api/image') {
        const imgPath = parsed.query.path;
        if (!imgPath) { res.writeHead(400); res.end('No path'); return; }
        const resolved = path.resolve(imgPath);
        const allowed = dataRoots.some(root => resolved.startsWith(path.resolve(root))) || resolved.startsWith(HOME);
        if (!allowed) { res.writeHead(403); res.end('Forbidden'); return; }
        serveStatic(resolved, res);
        return;
    }

    if (pathname === '/api/tags') {
        if (req.method === 'GET') { jsonResponse(res, loadJson(TAGS_FILE)); return; }
        if (req.method === 'POST') {
            try { const d = JSON.parse(await readBody(req)); saveJson(TAGS_FILE, d); jsonResponse(res, { ok: true }); }
            catch (e) { res.writeHead(400); jsonResponse(res, { error: 'Invalid JSON' }); }
            return;
        }
    }

    if (pathname === '/api/settings') {
        if (req.method === 'GET') { jsonResponse(res, loadJson(SETTINGS_FILE)); return; }
        if (req.method === 'POST') {
            try {
                const d = JSON.parse(await readBody(req));
                const c = loadJson(SETTINGS_FILE);
                Object.assign(c, d);
                saveJson(SETTINGS_FILE, c);
                jsonResponse(res, { ok: true });
            } catch (e) { res.writeHead(400); jsonResponse(res, { error: 'Invalid JSON' }); }
            return;
        }
    }

    if (pathname === '/api/roots') { jsonResponse(res, { roots: dataRoots }); return; }

    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(__dirname, 'public', filePath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) serveStatic(filePath, res);
    else serveStatic(path.join(__dirname, 'public', 'index.html'), res);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`  🌐 서버 시작: http://localhost:${PORT}`);
    console.log(`  📱 Termux에서: http://localhost:${PORT}`);
    console.log('');
    for (const root of dataRoots) console.log(`  📂 ${root}`);
    console.log('');
});
