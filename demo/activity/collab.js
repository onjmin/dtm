/**
 * DTM Collab - Discord Activity collab.js
 * 協力DAWアクティビティのメインロジック（CSP準拠：インラインJS不可）
 */

import { DiscordSDK, patchUrlMappings } from './discord-sdk.js';

// ─── Discord CSP対策: surikov 楽器データの <script> 注入を blob: に変換 ───
(function patchScriptAppendForDiscordCSP() {
    const SURIKOV = 'https://surikov.github.io/';
    const PROXY   = '/.proxy/surikov/';
    const srcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
    function interceptInsert(origFn) {
        return function(node, ...rest) {
            if (node instanceof HTMLScriptElement) {
                const rawSrc = node.getAttribute('src');
                if (rawSrc && rawSrc.startsWith(SURIKOV)) {
                    const proxied = PROXY + rawSrc.slice(SURIKOV.length);
                    const parent = this;
                    node.removeAttribute('src');
                    fetch(proxied)
                        .then(r => r.text())
                        .then(code => {
                            const blobUrl = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
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
    Element.prototype.append    = interceptInsert(Element.prototype.append);
})();

// ─── 定数 ────────────────────────────────────────────────────
const CLIENT_ID = '1519696988495548547';

/**
 * Koyebデプロイ後にここを書き換える。
 * ローカルでは ws://localhost:3001 を自動使用。
 */
const RELAY_URL_PROD = 'wss://detailed-donkey-onjmin-fceb78f2.koyeb.app';

// TRACKS_SIMPLEと同じ4色（track index 0〜3）
const TRACK_COLORS = ['#29adff', '#ffec27', '#00e436', '#ff77a8', '#ab5236', '#7e2553', '#5f574f', '#83769c'];
const TRACK_NAMES  = ['MELODY', 'SUBMELODY', 'BASS', 'CHORD', 'T4', 'T5', 'T6', 'T7'];
// TRACKS_SIMPLEと同じトラックID順（studio.mountEditor → DawOptions.tracks）
const TRACK_IDS    = ['melody', 'submelody', 'bass', 'chord', 't4', 't5', 't6', 't7'];

// ─── DOM ─────────────────────────────────────────────────────
const discordDot    = document.getElementById('discord-dot');
const discordStatus = document.getElementById('discord-status');
const relayDot      = document.getElementById('relay-dot');
const relayStatus   = document.getElementById('relay-status');
const playersList   = document.getElementById('players-list');
const bootMsg       = document.getElementById('boot-msg');
const loadError     = document.getElementById('load-error');
const dawArea       = document.getElementById('daw-area');
const arrowLeft     = document.getElementById('arrow-left');
const arrowRight    = document.getElementById('arrow-right');

// ─── 状態 ─────────────────────────────────────────────────────
let myTrackIndex = -1;
let dawInstance  = null;
// userId → { username, trackIndex }
const players = new Map();
// trackIndex → { audioMuted: bool, visualMuted: bool }
const muteState = new Map();

// ─── UI ヘルパ ────────────────────────────────────────────────
const setDiscordStatus = (state, msg) => {
    discordDot.className = state;
    discordStatus.textContent = msg;
};
const setRelayStatus = (state, msg) => {
    relayDot.className = state;
    relayStatus.textContent = msg;
};
const showError = (msg) => {
    loadError.style.display = 'block';
    loadError.textContent = '⚠ ' + msg;
};

// プレイヤーカード一覧を再描画
const renderPlayers = () => {
    playersList.innerHTML = '';
    const sorted = [...players.entries()].sort((a, b) => a[1].trackIndex - b[1].trackIndex);
    for (const [uid, p] of sorted) {
        const isMe = p.trackIndex === myTrackIndex;
        const mute = muteState.get(p.trackIndex) ?? { audioMuted: false, visualMuted: false };
        const card = document.createElement('div');
        card.className = 'player-card' + (isMe ? ' is-me' : '');
        card.dataset.track = String(p.trackIndex);

        const dot = document.createElement('div');
        dot.className = 'player-track-dot';

        const name = document.createElement('span');
        name.className = 'player-name';
        name.textContent = p.username;

        const you = document.createElement('span');
        you.className = 'player-you';
        you.textContent = isMe ? 'YOU' : TRACK_NAMES[p.trackIndex] ?? `T${p.trackIndex}`;

        card.appendChild(dot);
        card.appendChild(name);
        card.appendChild(you);

        // 自分のトラックにはミュートボタンを出さない（自分の音は常に聞く）
        if (!isMe) {
            const audioBtn = document.createElement('button');
            audioBtn.className = 'mute-btn' + (mute.audioMuted ? ' muted' : '');
            audioBtn.title = mute.audioMuted ? '音ミュート中' : '音あり';
            audioBtn.textContent = mute.audioMuted ? '🔇' : '🔊';
            audioBtn.addEventListener('click', () => toggleAudioMute(p.trackIndex));

            const visualBtn = document.createElement('button');
            visualBtn.className = 'mute-btn' + (mute.visualMuted ? ' muted' : '');
            visualBtn.title = mute.visualMuted ? '非表示中' : '表示中';
            visualBtn.textContent = mute.visualMuted ? '🙈' : '👁️';
            visualBtn.addEventListener('click', () => toggleVisualMute(p.trackIndex));

            card.appendChild(audioBtn);
            card.appendChild(visualBtn);
        }

        playersList.appendChild(card);
    }
};

// ─── ミュート操作 ─────────────────────────────────────────────
const toggleAudioMute = (trackIndex) => {
    const m = muteState.get(trackIndex) ?? { audioMuted: false, visualMuted: false };
    const next = !m.audioMuted;
    muteState.set(trackIndex, { ...m, audioMuted: next });
    if (dawInstance) {
        const trackId = TRACK_IDS[trackIndex];
        if (trackId) dawInstance.setTrackAudible(trackId, !next);
    }
    renderPlayers();
};

const toggleVisualMute = (trackIndex) => {
    const m = muteState.get(trackIndex) ?? { audioMuted: false, visualMuted: false };
    const next = !m.visualMuted;
    muteState.set(trackIndex, { ...m, visualMuted: next });
    if (dawInstance) {
        const trackId = TRACK_IDS[trackIndex];
        if (trackId) dawInstance.setTrackVisible(trackId, !next);
    }
    renderPlayers();
};

// ─── 画面外編集インジケーター ─────────────────────────────────
const offscreenTimers = new Map();
const showOffscreenArrow = (trackIndex, side) => {
    const arrow = side === 'left' ? arrowLeft : arrowRight;
    const color = TRACK_COLORS[trackIndex] ?? '#fff';
    arrow.style.display = 'block';
    arrow.style.borderColor = color;
    arrow.style.color = color;
    arrow.textContent = (side === 'left' ? '◀ ' : '') + (TRACK_NAMES[trackIndex] ?? `T${trackIndex}`) + (side === 'right' ? ' ▶' : '');

    if (offscreenTimers.has(side)) clearTimeout(offscreenTimers.get(side));
    const t = setTimeout(() => {
        arrow.style.display = 'none';
        offscreenTimers.delete(side);
    }, 3000);
    offscreenTimers.set(side, t);
};

// ─── WebSocket リレー ─────────────────────────────────────────
let ws = null;
let myUserId = null;
let myUsername = 'Player';

const getRelayUrl = () => {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        return 'ws://localhost:3001';
    }
    return RELAY_URL_PROD;
};

const connectRelay = (roomId) => {
    setRelayStatus('', 'CONNECTING TO RELAY…');
    const url = `${getRelayUrl()}?room=${encodeURIComponent(roomId)}`;
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
        setRelayStatus('connected', 'RELAY CONNECTED');
        ws.send(JSON.stringify({ type: 'join', roomId, userId: myUserId, username: myUsername }));
    });

    ws.addEventListener('message', (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        handleRelayMessage(msg);
    });

    ws.addEventListener('close', () => {
        setRelayStatus('error', 'RELAY DISCONNECTED');
        // 3秒後に再接続
        setTimeout(() => connectRelay(roomId), 3000);
    });

    ws.addEventListener('error', () => {
        setRelayStatus('error', 'RELAY ERROR');
    });
};

const handleRelayMessage = (msg) => {
    switch (msg.type) {
        case 'joined': {
            myTrackIndex = msg.yourTrackIndex;
            // 自分のトラック以外をロック（DawOptionsのlockedTracksは初期化時のみ設定可能なため、
            // DAWが起動済みならここでは参考情報のみ。DAW起動前なら initDAW で使う）
            renderPlayers();
            break;
        }
        case 'full-state': {
            for (const u of (msg.users ?? [])) {
                players.set(u.userId, { username: u.username, trackIndex: u.trackIndex });
                // 既存ノートを適用
                if (dawInstance && u.notes?.length > 0) {
                    const trackId = TRACK_IDS[u.trackIndex];
                    if (trackId) dawInstance.applyPatch(trackId, u.notes, []);
                }
            }
            renderPlayers();
            break;
        }
        case 'user-join': {
            players.set(msg.userId, { username: msg.username, trackIndex: msg.trackIndex });
            renderPlayers();
            break;
        }
        case 'user-leave': {
            players.delete(msg.userId);
            renderPlayers();
            break;
        }
        case 'patch': {
            if (!dawInstance) return;
            const trackId = TRACK_IDS[msg.trackIndex];
            if (!trackId) return;
            dawInstance.applyPatch(trackId, msg.added ?? [], msg.removed ?? []);

            // 画面外インジケーター検出
            const canvas = document.querySelector('[data-dtm="roll"] canvas');
            if (canvas && (msg.added?.length > 0)) {
                const canvasRect = canvas.getBoundingClientRect();
                // 最も左の追加ノートのstepから画面外かどうかを判定
                // （簡易版：step > 0 なら一旦右矢印を表示。正確な判定はscrollOffsetが必要）
                showOffscreenArrow(msg.trackIndex, 'right');
            }
            break;
        }
    }
};

const sendPatch = (trackId, added, removed) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'patch', added, removed }));
};

// ─── DAW 起動 ────────────────────────────────────────────────
const initDAW = async () => {
    bootMsg.style.display = 'none';

    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const DTM = await import(isLocal
        ? 'http://localhost:40298/dist/index.mjs'
        : '/.proxy/dtm/demo/index.mjs?v=9fa6d9b1');

    const { createDtmStudio, TRACKS_SIMPLE } = DTM;

    const studio = await createDtmStudio({
        koeBaseUrl: '/.proxy/koe',
        worldlineScriptUrl: '/.proxy/koe-lib/demo/world/worldline.js',
    });

    // lockedTracks = 自分のトラック以外すべて
    const myTrackId  = TRACK_IDS[myTrackIndex] ?? 'melody';
    const lockedTracks = TRACK_IDS.filter((_, i) => i !== myTrackIndex && i < (TRACKS_SIMPLE?.length ?? 4));

    dawInstance = studio.mountEditor(dawArea, {
        lockedTracks,
        onNotesPatch: (trackId, added, removed) => {
            sendPatch(trackId, added, removed);
        },
    });

    // 自分のトラックをアクティブにする
    // （DAWのトラック切り替えAPIが公開されていないため、初期activeTrackIdはDAW内部で決定）

    renderPlayers();
};

// ─── エントリポイント ─────────────────────────────────────────
const main = async () => {
    // Discord SDK URL Mapping
    try {
        patchUrlMappings([
            { prefix: '/.proxy/fonts',   target: 'db.onlinewebfonts.com' },
            { prefix: '/.proxy/dtm',     target: 'onjmin.github.io/dtm' },
            { prefix: '/.proxy/sf',      target: 'rpgen3.github.io' },
            { prefix: '/.proxy/surikov', target: 'surikov.github.io' },
            { prefix: '/.proxy/koe',     target: 'pub-12482a6b5cbc4c9e906b2e1904cabae5.r2.dev' },
        ]);
    } catch (_) {}

    // Discord SDK 接続
    let roomId = 'standalone';
    try {
        const sdk = new DiscordSDK(CLIENT_ID);
        await Promise.race([
            sdk.ready(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
        ]);
        setDiscordStatus('connected', 'DISCORD CONNECTED');
        roomId = `${sdk.guildId ?? 'guild'}:${sdk.channelId ?? 'channel'}`;

        // Discord ユーザー情報取得（SDK v2: instanceId をベースに疑似ID）
        myUserId   = sdk.instanceId ?? Math.random().toString(36).slice(2);
        myUsername = `Player`;

        // 参加者リストに自分を仮登録（joined メッセージで trackIndex が確定する前）
    } catch (e) {
        const isTimeout = e?.message === 'timeout';
        setDiscordStatus('error', isTimeout ? 'STANDALONE MODE' : 'DISCORD ERROR');
        myUserId = Math.random().toString(36).slice(2);
        roomId   = 'local-' + myUserId.slice(0, 6);
    }

    // リレーに接続（joined を受け取ってから DAW を起動）
    myUsername = `Player-${myUserId.slice(0, 4)}`;
    players.set(myUserId, { username: myUsername, trackIndex: -1 }); // trackIndex は joined で確定

    connectRelay(roomId);

    // joined を受け取ったら DAW 起動（最大5秒待機）
    await new Promise((resolve) => {
        const check = setInterval(() => {
            if (myTrackIndex >= 0) { clearInterval(check); resolve(); }
        }, 100);
        setTimeout(() => { clearInterval(check); resolve(); }, 5000);
    });

    // 自分のエントリを trackIndex で更新
    players.set(myUserId, { username: myUsername, trackIndex: myTrackIndex >= 0 ? myTrackIndex : 0 });
    if (myTrackIndex < 0) myTrackIndex = 0;

    try {
        await initDAW();
    } catch (e) {
        showError('DAW初期化に失敗しました: ' + (e?.message ?? e));
        console.error(e);
    }
};

main().catch((e) => {
    showError('初期化エラー: ' + (e?.message ?? e));
    console.error(e);
});
