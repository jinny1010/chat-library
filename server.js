#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 7860;
const HOME = process.env.HOME || '/data/data/com.termux/files/home';
const DATA_ROOTS = (process.env.CHAT_LIBRARY_PATH || '').split(':').filter(Boolean);

// ════════════ 경로 탐색 ════════════
function findRoots() {
    if (DATA_ROOTS.length) return DATA_ROOTS;
    const found = [];
    const sb = path.join(HOME, 'storage');
    if (fs.existsSync(sb)) {
        try {
            for (const e of fs.readdirSync(sb, { withFileTypes: true })) {
                if (!e.isDirectory() && !e.isSymbolicLink()) continue;
                for (const n of ['Backup','backup']) {
                    const p = path.join(sb, e.name, n);
                    if (fs.existsSync(p) && !found.includes(p)) found.push(p);
                }
            }
        } catch(e){}
    }
    for (const p of [path.join(HOME,'ST-backup'), path.join(HOME,'SillyTavern/data/default-user'), '/storage/emulated/0/ST-backup']) {
        if (fs.existsSync(p) && !found.includes(p)) found.push(p);
    }
    if (!found.length) {
        const d = path.join(HOME,'ST-backup');
        fs.mkdirSync(path.join(d,'chats'),{recursive:true});
        fs.mkdirSync(path.join(d,'images'),{recursive:true});
        found.push(d);
    }
    return found;
}

// ════════════ 스캔 ════════════
function scan(roots) {
    const chars = {};
    const allImgs = [];
    for (const root of roots) {
        const cd = xdir(root,'chats');
        if (cd) scanChats(cd, chars);
        const id = xdir(root,'images');
        if (id) scanImgs(id, allImgs, chars);
    }
    return { chars, allImgs };
}
function xdir(r,n) { const p=path.join(r,n); return fs.existsSync(p)?p:null; }

function scanChats(dir, chars) {
    try { for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
        if (!e.isDirectory()) continue;
        const cn=e.name;
        if (!chars[cn]) chars[cn]={chats:[],images:[],avatar:null};
        try { for (const f of fs.readdirSync(path.join(dir,cn))) {
            if (!f.endsWith('.jsonl')) continue;
            const fp=path.join(dir,cn,f), st=fs.statSync(fp);
            chars[cn].chats.push({name:f.replace('.jsonl',''),file:f,path:fp,size:st.size,mod:st.mtime.toISOString()});
        }} catch(e){}
    }} catch(e){}
}

function scanImgs(dir, all, chars) {
    try { for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
        const fp=path.join(dir,e.name);
        if (e.isDirectory()) {
            const cn=e.name;
            if (!chars[cn]) chars[cn]={chats:[],images:[],avatar:null};
            try { for (const f of fs.readdirSync(fp)) {
                if (!/\.(png|jpe?g|webp|gif)$/i.test(f)) continue;
                const ip=path.join(fp,f);
                all.push({name:f,path:ip,char:cn});
                chars[cn].images.push({name:f,path:ip});
            }} catch(e){}
        } else if (/\.(png|jpe?g|webp|gif)$/i.test(e.name)) {
            all.push({name:e.name,path:fp,char:''});
        }
    }} catch(e){}
}

// ════════════ 정규식 필터 ════════════
const FILTERS = [
    /(?:```?\w*[\r\n]?)?<(thought|cot|thinking|CoT|think|starter)[\s\S]*?<\/\1>(?:[\r\n]?```?)?/gi,
    /<[Ii][Mm][Aa][Gg][Ee][Ii][Nn][Ff][Oo]>[\s\S]*?<\/[Ii][Mm][Aa][Gg][Ee][Ii][Nn][Ff][Oo]>/g,
    /<pic\b[^>]*>[\s\S]*?<\/pic>/gi,
    /<pic\b[^>]*>/gi,
    /<\/pic>/gi,
    /<\/?infoblock[^>]*>/gi,
    /<\/?small[^>]*>/gi,
    /<\/?big[^>]*>/gi,
    /➛/g,
    /🥨 Sex Position[\s\S]*?(?=```|$)/g,
    /^###\s+\*\*Updated Timeline\*\*[\s\S]*$/gm,
    /\(?[Oo][Oo][Cc]\s*:[\s\S]*$/gm,
    /^``\s*$/gm,
    /^```\w*\s*$/gm,
    /^---\s*$/gm,
];

function clean(text) {
    if (!text) return '';
    let t = text;
    for (const re of FILTERS) t = t.replace(new RegExp(re.source, re.flags), '');
    return t.replace(/\n{3,}/g,'\n\n').trim();
}

// ════════════ 채팅 파싱 ════════════
function parseChat(fp) {
    return fs.readFileSync(fp,'utf-8').trim().split('\n').map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean);
}

// ════════════ 이미지 찾기 ════════════
function findImg(charName, filename, roots) {
    for (const root of roots) {
        for (const sub of [`images/${charName}`, 'images', '']) {
            const p = path.join(root, sub, filename);
            if (fs.existsSync(p)) return `/api/img?p=${encodeURIComponent(p)}`;
        }
    }
    return null;
}

// ════════════ HTTP ════════════
const MIME={'.html':'text/html;charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'};

function sendFile(fp,res) {
    try { const d=fs.readFileSync(fp); res.writeHead(200,{'Content-Type':MIME[path.extname(fp).toLowerCase()]||'application/octet-stream','Cache-Control':'public,max-age=3600'}); res.end(d); }
    catch(e) { res.writeHead(404); res.end('Not Found'); }
}
function J(res,d) { res.writeHead(200,{'Content-Type':'application/json;charset=utf-8'}); res.end(JSON.stringify(d)); }

console.log('\n  📚 채팅 도서관\n  ──────────────');
const roots = findRoots();
roots.forEach(r=>console.log(`  📂 ${r}`));
console.log('');

http.createServer((req,res) => {
    const p=url.parse(req.url,true);
    res.setHeader('Access-Control-Allow-Origin','*');

    if (p.pathname==='/api/scan') {
        const {chars,allImgs}=scan(roots);
        const out={};
        for (const [n,d] of Object.entries(chars)) {
            out[n]={chatCount:d.chats.length, imgCount:d.images.length,
                avatar:d.avatar?`/api/img?p=${encodeURIComponent(d.avatar)}`:null,
                chats:d.chats.map(c=>({name:c.name,file:c.file,size:c.size,mod:c.mod}))};
        }
        return J(res,{chars:out,imgTotal:allImgs.length,roots});
    }

    if (p.pathname==='/api/chat') {
        const cn=p.query.char,fn=p.query.file;
        if (!cn||!fn) return J(res,{error:'need char & file'});
        const {chars}=scan(roots);
        if (!chars[cn]) return J(res,{error:'char not found'});
        const chat=chars[cn].chats.find(c=>c.file===fn);
        if (!chat) return J(res,{error:'file not found'});
        const msgs=parseChat(chat.path).map(m=>{
            let img=null;
            if (m.extra&&m.extra.image) {
                img = m.extra.image.startsWith('data:') ? m.extra.image : findImg(cn,m.extra.image,roots);
            }
            return {name:m.name||(m.is_user?'User':cn),is_user:!!m.is_user,mes:clean(m.mes||''),date:m.send_date||m.create_date||'',img,sw:m.swipes?m.swipes.length:0,si:m.swipe_id||0};
        });
        return J(res,{char:cn,name:chat.name,msgs,avatar:chars[cn].avatar?`/api/img?p=${encodeURIComponent(chars[cn].avatar)}`:null});
    }

    if (p.pathname==='/api/images') {
        const cn=p.query.char;
        const {chars,allImgs}=scan(roots);
        const list = cn&&chars[cn] ? chars[cn].images : allImgs;
        return J(res,{images:list.map(i=>({name:i.name,char:i.char||'',url:`/api/img?p=${encodeURIComponent(i.path)}`}))});
    }

    if (p.pathname==='/api/img') {
        const ip=p.query.p;
        if (!ip){res.writeHead(400);return res.end();}
        const resolved=path.resolve(ip);
        if (!resolved.startsWith(HOME)){res.writeHead(403);return res.end();}
        return sendFile(resolved,res);
    }

    let fp = p.pathname==='/' ? '/index.html' : p.pathname;
    fp = path.join(__dirname,'public',fp);
    if (fs.existsSync(fp)&&fs.statSync(fp).isFile()) return sendFile(fp,res);
    return sendFile(path.join(__dirname,'public','index.html'),res);

}).listen(PORT,'0.0.0.0',()=>{
    console.log(`  🌐 http://localhost:${PORT}\n`);
    const {spawn}=require('child_process');
    const cf=spawn('cloudflared',['tunnel','--url',`http://localhost:${PORT}`],{stdio:['ignore','pipe','pipe']});
    cf.stderr.on('data',d=>{const m=d.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);if(m)console.log(`  ☁  ${m[0]}\n`);});
    cf.on('error',e=>{if(e.code==='ENOENT')console.log('  ⚠ cloudflared 없음 → pkg install cloudflared\n');});
});
