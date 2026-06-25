/**
 * DTM Discord Activity - player.js
 * CSP準拠のため外部スクリプトとして分離（インラインJS不可）
 * Discord Embedded App SDK: discord-sdk.js (esbuildバンドル済み)
 */

import { DiscordSDK, patchUrlMappings } from './discord-sdk.js';

// ─── Discord CSP対策: <script>タグ動的注入をblob:URLに変換 ──────────────
// Discord の script-src は blob: を許可しているが外部ドメインは不可。
// SoundFont ライブラリが <script src="https://surikov..."> を注入するため、
// appendChild/insertBefore をインターセプトして fetch→blob に差し替える。
// ※ document.createElement は一切触らない（PLAY回帰の原因になるため）
(function patchScriptInjectionForDiscordCSP() {
    const URL_REMAP = [
        ['https://surikov.github.io/', '/.proxy/surikov/'],
        ['https://rpgen3.github.io/',  '/.proxy/sf/'],
    ];
    function remap(url) {
        if (!url) return null;
        for (const [from, to] of URL_REMAP) {
            if (url.startsWith(from)) return to + url.slice(from.length);
        }
        return null;
    }

    const srcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');

    function interceptInsert(origFn) {
        return function(node, ...rest) {
            if (node instanceof HTMLScriptElement) {
                // getAttribute で生の属性値を読む（JSプロパティは絶対URL化されるため）
                const rawSrc = node.getAttribute('src');
                const proxied = remap(rawSrc);
                if (proxied) {
                    const parent = this;
                    node.removeAttribute('src');
                    fetch(proxied)
                        .then(r => r.text())
                        .then(code => {
                            const blobUrl = URL.createObjectURL(
                                new Blob([code], { type: 'application/javascript' })
                            );
                            srcDesc.set.call(node, blobUrl);
                            origFn.call(parent, node, ...rest);
                        })
                        .catch(() => node.dispatchEvent(new Event('error')));
                    return node;
                }
            }
            return origFn.call(this, node, ...rest);
        };
    }
    Node.prototype.appendChild  = interceptInsert(Node.prototype.appendChild);
    Node.prototype.insertBefore = interceptInsert(Node.prototype.insertBefore);
    // rpgen3/mylib の getScript は document.head.append() を使うため追加で patch
    Element.prototype.append    = interceptInsert(Element.prototype.append);
})();

// ─── DOM要素 ───────────────────────────────────────────────
const discordDot   = document.getElementById('discord-dot');
const statusText   = document.getElementById('status-text');
const bootMsg      = document.getElementById('boot-msg');
const loadError    = document.getElementById('load-error');
const hashInput    = document.getElementById('hash-input');
const loadBtn      = document.getElementById('load-btn');
const hintText     = document.getElementById('hint-text');
const playerArea   = document.getElementById('player-area');

// ─── MML デコードロジック（embed.html と同一） ─────────────
const fromBase64Url = (s) => {
    let normalized = s.replace(/-/g, '+').replace(/_/g, '/');
    while (normalized.length % 4 !== 0) normalized += '=';
    const bin = atob(normalized);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
};

const HIRAGANA_START   = 0x3041;
const PROLONGED_MARK   = 0x30fc;
const SHIFT_KATAKANA   = 255;
const VALUE_PROLONGED  = 223;

const customDecode = (bytes) => {
    let str = '';
    let i = 0;
    while (i < bytes.length) {
        const byte = bytes[i];
        if (byte <= 127) {
            str += String.fromCharCode(byte); i++;
        } else if (byte === VALUE_PROLONGED) {
            str += String.fromCharCode(PROLONGED_MARK); i++;
        } else if (byte >= 128 && byte <= 222) {
            str += String.fromCharCode(HIRAGANA_START + (byte - 128)); i++;
        } else if (byte === SHIFT_KATAKANA) {
            if (i + 1 < bytes.length) {
                const nb = bytes[i + 1];
                if (nb >= 128 && nb <= 222) {
                    str += String.fromCharCode(HIRAGANA_START + 0x60 + (nb - 128));
                }
                i += 2;
            } else { i++; }
        } else { i++; }
    }
    return str;
};

const gunzipCustom = async (bytes) => {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return customDecode(new Uint8Array(buf));
};

const gunzip = async (bytes) => {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return new TextDecoder().decode(buf);
};

/**
 * MMLペイロードをデコードする
 * @param {string} payload - ハッシュ部分（#を除いた文字列）
 */
const decodeMml = async (payload) => {
    if (!payload) return '';
    if (payload.startsWith('z.')) return await gunzipCustom(fromBase64Url(payload.slice(2)));
    if (payload.startsWith('g.')) return await gunzip(fromBase64Url(payload.slice(2)));
    if (payload.startsWith('u.')) return decodeURIComponent(payload.slice(2));
    return decodeURIComponent(payload);
};

// ─── 共有コード（URL or hash）からペイロードを抽出 ────────
const extractPayload = (input) => {
    const trimmed = input.trim();
    // フルURL形式: https://onjmin.github.io/dtm/demo/embed.html#g.xxx
    const hashIdx = trimmed.indexOf('#');
    if (hashIdx !== -1) return trimmed.slice(hashIdx + 1);
    // ハッシュのみ形式: g.xxx
    return trimmed;
};

// ─── エラー表示 ────────────────────────────────────────────
const showError = (msg) => {
    loadError.style.display = 'block';
    loadError.textContent = '⚠ ' + msg;
};

// ─── プレイヤーをマウント ──────────────────────────────────
let playerInstance = null;

const mountPlayer = async (mml) => {
    loadError.style.display = 'none';
    playerArea.innerHTML = '<div style="color:#83769c;font-size:11px;letter-spacing:.1em;text-transform:uppercase;padding:16px">▒ LOADING PLAYER…</div>';

    try {
        // embed.html と同じロジックで DTM ライブラリをロード
        // Developer Portal の Proxy Mapping:
        //   Prefix: /dtm  →  Target: onjmin.github.io/dtm
        // → /.proxy/dtm/demo/index.mjs = onjmin.github.io/dtm/demo/index.mjs
        const isLocal = location.hostname === 'localhost';
        const DTM = await import(isLocal
            ? 'http://localhost:40298/dist/index.mjs'
            : '/.proxy/dtm/demo/index.mjs?v=15166450');

        const { createDtmStudio } = DTM;

        if (playerInstance) {
            playerInstance.destroy();
            playerInstance = null;
        }

        playerArea.innerHTML = '';
        const studio = await createDtmStudio({
            koeBaseUrl: '/.proxy/koe',
            worldlineScriptUrl: '/.proxy/koe-lib/demo/world/worldline.js',
        });
        playerInstance = studio.mountPlayer(playerArea, mml, { volume: 50 });
    } catch (e) {
        playerArea.innerHTML = '';
        showError('プレイヤーの初期化に失敗しました: ' + (e?.message ?? e));
        console.error(e);
    }
};

// ─── ロードボタン ──────────────────────────────────────────
const handleLoad = async () => {
    const input = hashInput.value;
    if (!input.trim()) {
        showError('コードを入力してください。');
        return;
    }
    const payload = extractPayload(input);
    let mml;
    try {
        mml = await decodeMml(payload);
    } catch (e) {
        showError('コードの解析に失敗しました: ' + (e?.message ?? e));
        return;
    }
    if (!mml) {
        showError('有効な共有コードではありません。');
        return;
    }
    loadError.style.display = 'none';
    await mountPlayer(mml);
};

loadBtn.addEventListener('click', handleLoad);

// Ctrl+Enter / Cmd+Enter でも送信
hashInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleLoad();
});

// テキスト入力時にボタン有効化
hashInput.addEventListener('input', () => {
    loadBtn.disabled = hashInput.value.trim() === '';
});

// ─── Discord SDK 初期化 ────────────────────────────────────
const CLIENT_ID = '1396565902383906961';

const setStatus = (state, msg) => {
    statusText.textContent = msg;
    discordDot.className = state; // 'connected' | 'error' | ''
};

const showInputUI = () => {
    bootMsg.style.display     = 'none';
    hashInput.style.display   = '';
    loadBtn.style.display     = '';
    hintText.style.display    = '';
};

const initDiscord = async () => {
    // ─── Discord の URL Mapping（CSP制限対策）────────────────────
    // Developer Portal > Activities > URL Mappings に以下を追加:
    //   Prefix: /fonts   Target: db.onlinewebfonts.com
    //   Prefix: /dtm     Target: onjmin.github.io/dtm
    //   Prefix: /sf      Target: rpgen3.github.io
    //
    // ※ Portal側のPrefixに「.proxy」は不要。
    //   コード側の patchUrlMappings では /.proxy/ を付けて指定する（SDKの仕様）。
    try {
        patchUrlMappings([
            { prefix: '/.proxy/fonts',   target: 'db.onlinewebfonts.com' },
            { prefix: '/.proxy/dtm',     target: 'onjmin.github.io/dtm' },
            { prefix: '/.proxy/sf',      target: 'rpgen3.github.io' },
            { prefix: '/.proxy/surikov', target: 'surikov.github.io' },
            { prefix: '/.proxy/koe',     target: 'pub-12482a6b5cbc4c9e906b2e1904cabae5.r2.dev' },
        ]);
    } catch (_) {
        // patchUrlMappings はDiscord外では何もしないので無視
    }

    // Discord 接続（タイムアウト付き）
    let discordConnected = false;
    try {
        const sdk = new DiscordSDK(CLIENT_ID);

        // 5秒でタイムアウト（Discord外ブラウザ対策）
        const readyResult = await Promise.race([
            sdk.ready(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 5000)
            ),
        ]);

        discordConnected = true;
        setStatus('connected', 'DISCORD CONNECTED');
        console.log('[DTM Activity] Discord SDK ready');
    } catch (e) {
        // Discord外（通常ブラウザ）またはタイムアウト
        const isTimeout = e?.message === 'timeout';
        setStatus('error', isTimeout ? 'STANDALONE MODE (Discord外)' : 'DISCORD ERROR: ' + e?.message);
        console.warn('[DTM Activity] Running without Discord:', e?.message);
    }

    // 入力UIを表示
    showInputUI();

    // URLハッシュにすでにペイロードがあれば自動ロード
    const hash = location.hash.slice(1);
    if (hash) {
        hashInput.value = hash;
        loadBtn.disabled = false;
        await handleLoad();
    }
};

// エントリポイント
initDiscord().catch((e) => {
    showError('初期化エラー: ' + (e?.message ?? e));
    console.error(e);
    showInputUI();
});
