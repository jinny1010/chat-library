#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 7860;
// 접속 키 (설정 시 모든 요청에 요구). 공개 서버에 올릴 때만 설정하면 됨.
const LIBRARY_KEY = process.env.LIBRARY_KEY || '';
const DATA_ROOTS = (process.env.CHAT_LIBRARY_PATH || '').split(':').filter(Boolean);
const HOME = process.env.HOME || '/data/data/com.termux/files/home';
// 전용 데이터 폴더: 앱 폴더 안의 data/ 하나만 사용
const DATA_DIR = path.join(__dirname, 'data');
const TAGS_FILE = path.join(DATA_DIR, 'tags.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function loadJson(f) { try { if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f,'utf-8')); } catch(e){} return {}; }
function saveJson(f,d) { try { fs.writeFileSync(f,JSON.stringify(d,null,2),'utf-8'); } catch(e){} }

// ── 경로 결정 ──
// 자동 스토리지 탐색 안 함. 전용 폴더 하나만 본다.
//   - 기본: 앱 폴더 안의 data/
//   - CHAT_LIBRARY_PATH 환경변수를 주면 그 경로(들)로 덮어씀
function findDataRoot() {
    if (DATA_ROOTS.length > 0) {
        console.log('  환경변수 경로 사용:');
        for (const r of DATA_ROOTS) console.log(`    📂 ${r}`);
        return DATA_ROOTS;
    }

    // 전용 폴더가 없으면 chats/ images/ 골격을 만들어 둔다
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(path.join(DATA_DIR, 'chats'), { recursive: true });
        fs.mkdirSync(path.join(DATA_DIR, 'images'), { recursive: true });
        console.log(`  📁 전용 폴더 생성: ${DATA_DIR}`);
    }
    console.log(`  📂 전용 폴더 사용: ${DATA_DIR}`);
    return [DATA_DIR];
}

// ── 유틸 ──
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch(e) { return false; } }
function sub(root, name) { const p = path.join(root, name); return fs.existsSync(p) ? p : null; }
function safeReaddir(dir) { try { return fs.readdirSync(dir); } catch(e) { return []; } }

// ── 스캔 ──
function scanAllData(roots) {
    const characters = {};
    const allImages = [];
    for (const root of roots) {
        // chats 또는 chat 폴더 모두 지원
        for (const chatDirName of ['chats', 'chat']) {
            const chatsDir = sub(root, chatDirName);
            if (chatsDir) scanChatsDir(chatsDir, characters);
        }

        // 이미지 소스들 — 여러 경로에서 탐색
        for (const imgSub of ['images', 'user/images']) {
            const imagesDir = sub(root, imgSub);
            if (imagesDir) scanImagesDirByChar(imagesDir, allImages, characters);
        }

        // 아바타 소스들
        for (const d of ['characters', 'thumbnails']) {
            const dir = sub(root, d);
            if (dir) scanAvatarDir(dir, characters);
        }

        const uImgDir = sub(root, 'user/images');
        if (uImgDir) scanImagesDir(uImgDir, allImages, characters);

        // chats/ 없이 직접 캐릭터 폴더가 있는 경우
        const hasChatsDir = ['chats', 'chat'].some(n => sub(root, n));
        if (!hasChatsDir) {
            for (const name of safeReaddir(root)) {
                const fp = path.join(root, name);
                if (!isDir(fp) || ['images','thumbnails','characters','User Avatars','user'].includes(name)) continue;
                if (safeReaddir(fp).some(f => f.endsWith('.jsonl'))) {
                    scanChatsDir(root, characters);
                    break;
                }
            }
        }
    }

    // 2차 아바타: images/캐릭터명/ 첫 이미지
    for (const root of roots) {
        for (const imgSub of ['images', 'user/images']) {
            const imagesDir = sub(root, imgSub);
            if (!imagesDir) continue;
            for (const name of safeReaddir(imagesDir)) {
                const fp = path.join(imagesDir, name);
                if (!isDir(fp)) continue;
                if (characters[name] && !characters[name].avatar) {
                    const imgs = safeReaddir(fp).filter(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f));
                    if (imgs.length > 0) characters[name].avatar = path.join(fp, imgs[0]);
                }
            }
        }
    }

    return { characters, allImages };
}

function scanChatsDir(chatsDir, characters) {
    for (const name of safeReaddir(chatsDir)) {
        const cp = path.join(chatsDir, name);
        if (!isDir(cp)) continue;
        if (!characters[name]) characters[name] = { chats: [], avatar: null, images: [] };
        for (const file of safeReaddir(cp).filter(f => f.endsWith('.jsonl'))) {
            try {
                const fp = path.join(cp, file);
                const stat = fs.statSync(fp);
                characters[name].chats.push({ name: file.replace('.jsonl', ''), file, path: fp, size: stat.size, modified: stat.mtime.toISOString() });
            } catch(e) {}
        }
    }
}

function norm(s) {
    return s.toLowerCase().replace(/[''"""`'´]/g, '').replace(/\s+/g, '').replace(/[_\-\.]/g, '').replace(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ]/g, '');
}

function scanAvatarDir(dir, characters) {
    for (const name of safeReaddir(dir)) {
        if (!/\.(png|jpg|jpeg|webp|gif)$/i.test(name)) continue;
        const fp = path.join(dir, name);
        if (isDir(fp)) continue;
        const base = name.replace(/\.(png|jpg|jpeg|webp|gif)$/i, '');
        const bn = norm(base);
        for (const cn of Object.keys(characters)) {
            const cnn = norm(cn);
            if (bn === cnn || (cnn.length >= 2 && bn.includes(cnn)) || (bn.length >= 2 && cnn.includes(bn))) {
                if (!characters[cn].avatar) characters[cn].avatar = fp;
            }
        }
    }
}

function scanImagesDirByChar(imagesDir, allImages, characters) {
    for (const name of safeReaddir(imagesDir)) {
        const fp = path.join(imagesDir, name);
        if (isDir(fp)) {
            // norm()으로 정규화해서 기존 캐릭터와 매칭
            const nameNorm = norm(name);
            let matchedChar = name;
            for (const cn of Object.keys(characters)) {
                if (norm(cn) === nameNorm) { matchedChar = cn; break; }
            }
            if (!characters[matchedChar]) characters[matchedChar] = { chats: [], avatar: null, images: [] };
            for (const f of safeReaddir(fp).filter(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f))) {
                const ip = path.join(fp, f);
                allImages.push({ name: f, path: ip, char: matchedChar, dir: matchedChar });
                if (!characters[matchedChar].images) characters[matchedChar].images = [];
                characters[matchedChar].images.push({ name: f, path: ip });
            }
        } else if (/\.(png|jpg|jpeg|webp|gif)$/i.test(name)) {
            allImages.push({ name, path: fp, char: '', dir: '' });
        }
    }
}

function scanImagesDir(imgDir, allImages, characters) {
    const walk = (dir, prefix) => {
        for (const name of safeReaddir(dir)) {
            const fp = path.join(dir, name);
            if (isDir(fp)) { walk(fp, prefix ? `${prefix}/${name}` : name); }
            else if (/\.(png|jpg|jpeg|webp|gif)$/i.test(name)) {
                allImages.push({ name, path: fp, dir: prefix || '' });
                const base = name.replace(/\.(png|jpg|jpeg|webp|gif)$/i, '');
                const bn = norm(base);
                for (const cn of Object.keys(characters)) {
                    const cnn = norm(cn);
                    if (bn === cnn || (bn.includes(cnn) && cnn.length >= 2) || (cnn.includes(bn) && bn.length >= 2)) {
                        if (!characters[cn].avatar) characters[cn].avatar = fp;
                    }
                }
            }
        }
    };
    walk(imgDir, '');
}

// ── 채팅 파싱 & 정규식 ──
function parseChatFile(fp) {
    return fs.readFileSync(fp, 'utf-8').trim().split('\n').map(l => { try { return JSON.parse(l.trim()); } catch(e) { return null; } }).filter(Boolean);
}

const CLEANUP = [
    { f: /(?:```?\w*[\r\n]?)?<(thought|cot|thinking|CoT|think|starter)[\s\S]*?<\/(thought|cot|thinking|CoT|think|starter)>(?:[\r\n]?```?)?/gi, r: '' },
    { f: /\[OOC:[\s\S]*?\]/gi, r: '' },
    { f: /<OOC>[\s\S]*?<\/OOC>/gi, r: '' },
    { f: /<extra_prompt>[\s\S]*?<\/extra_prompt>/gi, r: '' },
];
function clean(t) { if (!t) return ''; let c = t; for (const r of CLEANUP) c = c.replace(r.f, r.r); return c.replace(/\n{3,}/g, '\n\n').trim(); }

// ── HTTP ──
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
function serve(fp, res) { try { const d = fs.readFileSync(fp); res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' }); res.end(d); } catch(e) { res.writeHead(404); res.end('Not Found'); } }
function json(res, d) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(d)); }
function body(req) { return new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); }); }

// ── 메인 ──
console.log('\n  📚 Chat Library\n  ─────────────────\n  경로 탐색 중...\n');
const dataRoots = findDataRoot();
console.log(`\n  총 ${dataRoots.length}개 경로 사용`);

// 시작 시 디버깅: 이미지 폴더 확인
for (const root of dataRoots) {
    console.log(`\n  📂 ${root}`);
    for (const sub of ['chats', 'chat', 'images', 'user/images', 'characters', 'thumbnails']) {
        const p = path.join(root, sub);
        if (fs.existsSync(p)) {
            const items = safeReaddir(p);
            console.log(`    ✓ ${sub}/ (${items.length}개: ${items.slice(0, 5).join(', ')}${items.length > 5 ? '...' : ''})`);
        }
    }
}
console.log('');

http.createServer(async (req, res) => {
    const p = url.parse(req.url, true), pn = p.pathname;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    // ── 접속 키 게이트 (LIBRARY_KEY 설정 시에만) ──
    if (LIBRARY_KEY) {
        const cookies = req.headers.cookie || '';
        const hasCookie = cookies.split(';').some(c => c.trim() === `libkey=${LIBRARY_KEY}`);
        if (!hasCookie) {
            if (p.query.key === LIBRARY_KEY) {
                // 최초 진입: ?key=XXX → 쿠키 심고 통과
                res.setHeader('Set-Cookie', `libkey=${LIBRARY_KEY}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);
            } else {
                res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end('<div style="font-family:sans-serif;padding:2em">🔒 접속 키가 필요합니다.<br>주소 뒤에 <code>?key=접속키</code>를 붙여 접속하세요.</div>');
                return;
            }
        }
    }

    if (pn === '/api/scan') {
        const { characters, allImages } = scanAllData(dataRoots);
        const tags = loadJson(TAGS_FILE);
        const cl = {};
        for (const [n, d] of Object.entries(characters)) {
            const chatsWithTags = d.chats.map(c => {
                const chatTagKey = `${n}::${c.file}`;
                return { name: c.name, file: c.file, size: c.size, modified: c.modified, tags: tags[chatTagKey] || [] };
            });
            const allCharTags = new Set();
            for (const c of chatsWithTags) for (const t of c.tags) allCharTags.add(t);
            cl[n] = {
                chatCount: d.chats.length,
                imageCount: (d.images || []).length,
                avatar: d.avatar ? `/api/image?path=${encodeURIComponent(d.avatar)}` : null,
                tags: [...allCharTags],
                chats: chatsWithTags,
            };
        }
        json(res, { characters: cl, imageCount: allImages.length, roots: dataRoots });
        return;
    }

    if (pn === '/api/chat') {
        const cn = p.query.char, fn = p.query.file;
        if (!cn || !fn) { json(res, { error: 'need char+file' }); return; }
        const { characters } = scanAllData(dataRoots);
        const cd = characters[cn]; if (!cd) { json(res, { error: 'not found' }); return; }
        const chat = cd.chats.find(c => c.file === fn); if (!chat) { json(res, { error: 'no file' }); return; }
        const msgs = parseChatFile(chat.path).map(m => {
            const extra = {};
            if (m.extra) {
                if (m.extra.image) extra.image = m.extra.image;
                if (m.extra.inline_image) extra.inline_image = m.extra.inline_image;
                if (m.extra.title) extra.title = m.extra.title;
                // media 배열 전달 (SillyTavern 이미지 소스)
                if (m.extra.media && Array.isArray(m.extra.media)) extra.media = m.extra.media;
            }
            return {
                name: m.name || (m.is_user ? 'User' : cn), is_user: !!m.is_user,
                mes: clean(m.mes || ''), send_date: m.send_date || m.create_date || '',
                extra: Object.keys(extra).length > 0 ? extra : null,
                swipe_id: m.swipe_id, swipes: m.swipes ? m.swipes.length : 0,
            };
        });

        // user/images/캐릭터명/ 이미지 수집
        // 따옴표 종류가 달라도 매칭되도록 norm() 정규화 사용
        const charImages = {};
        const cnNorm = norm(cn);
        for (const root of dataRoots) {
            for (const imgSub of ['images', 'user/images']) {
                const baseDir = path.join(root, imgSub);
                if (!fs.existsSync(baseDir) || !isDir(baseDir)) continue;
                for (const dirName of safeReaddir(baseDir)) {
                    const dirPath = path.join(baseDir, dirName);
                    if (!isDir(dirPath)) continue;
                    // norm()으로 정규화해서 비교 (따옴표, 공백, 특수문자 무시)
                    if (norm(dirName) === cnNorm) {
                        const imgFiles = safeReaddir(dirPath).filter(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f));
                        console.log(`  📷 이미지 폴더 발견: ${dirPath} (${imgFiles.length}개)`);
                        for (const f of imgFiles) {
                            if (!charImages[f]) charImages[f] = `/api/image?path=${encodeURIComponent(path.join(dirPath, f))}`;
                        }
                    }
                }
            }
        }

        console.log(`  📷 ${cn}: charImages 총 ${Object.keys(charImages).length}개`);
        if (Object.keys(charImages).length === 0) {
            console.log(`  ⚠ 이미지 못 찾음! norm('${cn}') = '${cnNorm}'`);
        }
        json(res, { char: cn, file: chat.file, name: chat.name, messages: msgs, charImages, avatar: cd.avatar ? `/api/image?path=${encodeURIComponent(cd.avatar)}` : null });
        return;
    }

    if (pn === '/api/images') {
        const { allImages } = scanAllData(dataRoots);
        const cf = p.query.char;
        let fl = allImages;
        if (cf) fl = allImages.filter(i => (i.dir || '').toLowerCase().includes(cf.toLowerCase()) || i.name.toLowerCase().includes(cf.toLowerCase()));
        const folders = {};
        for (const i of fl) { const d = i.dir || '기타'; if (!folders[d]) folders[d] = []; folders[d].push({ name: i.name, dir: i.dir, url: `/api/image?path=${encodeURIComponent(i.path)}` }); }
        json(res, { images: fl.map(i => ({ name: i.name, dir: i.dir, url: `/api/image?path=${encodeURIComponent(i.path)}` })), folders });
        return;
    }

    if (pn === '/api/image') {
        const ip = p.query.path; if (!ip) { res.writeHead(400); res.end(); return; }
        const rp = path.resolve(ip);
        if (!dataRoots.some(r => rp.startsWith(path.resolve(r))) && !rp.startsWith(HOME)) { res.writeHead(403); res.end(); return; }
        serve(rp, res); return;
    }

    // SillyTavern 경로 해석: /user/images/CharName/file.png
    if (pn === '/api/st-image') {
        const stPath = p.query.path; // e.g. "/user/images/Jekyll And Hyde/file.png"
        if (!stPath) { res.writeHead(400); res.end(); return; }
        
        // 경로 파싱: /user/images/CharName/filename.png
        const cleaned = stPath.replace(/^\//, '');  // "user/images/CharName/filename.png"
        const parts = cleaned.split('/');
        const fileName = parts.pop();  // "filename.png"
        
        // 1단계: 직접 경로 시도 (정확히 일치하는 경우)
        const directVariants = [
            cleaned,
            cleaned.replace(/[\u2018\u2019\u201C\u201D]/g, "'"),
            cleaned.replace(/'/g, "\u2018"),
        ];
        for (const variant of directVariants) {
            for (const root of dataRoots) {
                for (const prefix of ['', 'user/']) {
                    const fp = path.join(root, prefix, variant.replace(/^user\//, ''));
                    if (fs.existsSync(fp) && !isDir(fp)) { serve(fp, res); return; }
                }
            }
        }
        
        // 2단계: norm() 기반 fuzzy 매칭 (따옴표 종류가 달라도 찾기)
        if (fileName) {
            const fnLower = fileName.toLowerCase();
            for (const root of dataRoots) {
                for (const imgSub of ['images', 'user/images']) {
                    const baseDir = path.join(root, imgSub);
                    if (!fs.existsSync(baseDir)) continue;
                    for (const dirName of safeReaddir(baseDir)) {
                        const dirPath = path.join(baseDir, dirName);
                        if (!isDir(dirPath)) continue;
                        // 해당 폴더 안에서 파일명으로 검색
                        for (const f of safeReaddir(dirPath)) {
                            if (f.toLowerCase() === fnLower) {
                                serve(path.join(dirPath, f), res);
                                return;
                            }
                        }
                    }
                }
            }
        }
        
        console.log(`  ⚠ st-image 404: ${stPath}`);
        res.writeHead(404); res.end('Not Found'); return;
    }

    if (pn === '/api/tags') {
        if (req.method === 'GET') { json(res, loadJson(TAGS_FILE)); return; }
        if (req.method === 'POST') { try { saveJson(TAGS_FILE, JSON.parse(await body(req))); json(res, { ok: true }); } catch(e) { res.writeHead(400); json(res, { error: 'bad' }); } return; }
    }
    if (pn === '/api/settings') {
        if (req.method === 'GET') { json(res, loadJson(SETTINGS_FILE)); return; }
        if (req.method === 'POST') { try { const d = JSON.parse(await body(req)), c = loadJson(SETTINGS_FILE); Object.assign(c, d); saveJson(SETTINGS_FILE, c); json(res, { ok: true }); } catch(e) { res.writeHead(400); json(res, { error: 'bad' }); } return; }
    }
    if (pn === '/api/roots') { json(res, { roots: dataRoots }); return; }

    let fp = pn === '/' ? '/index.html' : pn;
    fp = path.join(__dirname, 'public', fp);
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) serve(fp, res);
    else serve(path.join(__dirname, 'public', 'index.html'), res);
}).listen(PORT, '0.0.0.0', () => {
    console.log(`  🌐 http://localhost:${PORT}`);
    for (const r of dataRoots) console.log(`  📂 ${r}`);
    console.log('\n  💡 경로가 다르면: CHAT_LIBRARY_PATH=/sdcard/경로 node library.js\n');
});
