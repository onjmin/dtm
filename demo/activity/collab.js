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

// トラックインデックス 0〜14 に対応する動物絵文字
// 十二支 + 猫・狐・狸
const TRACK_EMOJIS = ['🐀','🐄','🐅','🐇','🐉','🐍','🐎','🐑','🐒','🐓','🐕','🐗','🐈','🦊','🦝'];

// TRACKS_ADVANCED と同じ順（t0〜t14、15トラック）
const TRACK_COLORS = [
    '#29adff','#00e436','#ff77a8','#ffa300',
    '#ffec27','#83769c','#ff004d','#ffcca8',
    '#c2c3c7','#008751','#ab5236','#7e2553',
    '#fff1e8','#78c8ff','#64ffa0',
];
const TRACK_NAMES = [
    'TRACK 01','TRACK 02','TRACK 03','TRACK 04','TRACK 05',
    'TRACK 06','TRACK 07','TRACK 08','TRACK 09','TRACK 10',
    'TRACK 11','TRACK 12','TRACK 13','TRACK 14','TRACK 15',
];
// TRACKS_ADVANCED のトラックID順（t0〜t14）
const TRACK_IDS = ['t0','t1','t2','t3','t4','t5','t6','t7','t8','t9','t10','t11','t12','t13','t14'];

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
let pendingOwnNotes = [];
let pendingAllTracks = [];
// userId → { step, pitch } リモートカーソル
const remoteCursors = new Map();
// userId → { username, trackIndex }
const players = new Map();
// trackIndex → { audioMuted: bool, visualMuted: bool }
const muteState = new Map();
// trackIndex → instrumentName（DAW再マウント時に復元する）
const trackInstrumentOverrides = new Map();

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
        const card = document.createElement('span');
        card.className = 'player-card' + (isMe ? ' is-me' : '');

        const idEl = document.createElement('span');
        idEl.className = 'player-id';
        idEl.textContent = (TRACK_EMOJIS[p.trackIndex] ?? '🎵') + ' @' + (p.trackIndex + 1);

        card.appendChild(idEl);

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

// ─── カーソルオーバーレイ ──────────────────────────────────────
const startCursorOverlay = () => {
    const rollEl = document.querySelector('[data-dtm="roll"]');
    if (!rollEl) return;

    // ピアノロール内に絶対配置のオーバーレイを挿入
    const overlay = document.createElement('div');
    overlay.id = 'cursor-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:10';
    rollEl.style.position = 'relative';
    rollEl.appendChild(overlay);

    // userId → { dot, edge } DOM要素
    const markerEls = new Map();

    const getOrCreateMarker = (userId, color, label) => {
        if (markerEls.has(userId)) return markerEls.get(userId);

        const dot = document.createElement('div');
        dot.style.cssText = `position:absolute;width:10px;height:10px;border-radius:50%;background:${color};
            box-shadow:0 0 0 2px #000;transform:translate(-50%,-50%);transition:left .1s,top .1s`;

        const tag = document.createElement('div');
        tag.style.cssText = `position:absolute;font-size:9px;letter-spacing:.06em;color:#fff;
            background:#000a;padding:1px 4px;white-space:nowrap;transform:translate(-50%,-140%);
            pointer-events:none`;
        tag.textContent = label;
        dot.appendChild(tag);

        const edge = document.createElement('div');
        edge.style.cssText = `position:absolute;font-size:9px;letter-spacing:.06em;padding:2px 6px;
            border:2px solid ${color};color:${color};background:#000c;white-space:nowrap;display:none`;

        overlay.appendChild(dot);
        overlay.appendChild(edge);
        markerEls.set(userId, { dot, edge });
        return { dot, edge };
    };

    const rafLoop = () => {
        if (!dawInstance) { requestAnimationFrame(rafLoop); return; }
        // グリッドキャンバス（ノート描画用）= wrapper 内の最後の canvas
        const wrapper = rollEl.querySelector('[data-dtm="wrapper"]');
        const canvases = wrapper ? wrapper.querySelectorAll('canvas') : rollEl.querySelectorAll('canvas');
        const gridCanvas = canvases[canvases.length - 1]; // header + grid の順なので最後がグリッド
        const cw = gridCanvas?.offsetWidth  ?? overlay.offsetWidth;
        const ch = gridCanvas?.offsetHeight ?? overlay.offsetHeight;
        // rollEl 基準でのグリッドキャンバス左上オフセット
        const canvasOffsetX = gridCanvas ? (gridCanvas.getBoundingClientRect().left - rollEl.getBoundingClientRect().left) : 0;
        const canvasOffsetY = gridCanvas ? (gridCanvas.getBoundingClientRect().top  - rollEl.getBoundingClientRect().top)  : 0;

        const toRemove = new Set(markerEls.keys());

        for (const [uid, cursor] of remoteCursors) {
            const player = players.get(uid);
            if (!player || player.trackIndex < 0) continue;
            toRemove.delete(uid);

            const color = TRACK_COLORS[cursor.trackIndex] ?? '#fff';
            const trackLabel = TRACK_NAMES[cursor.trackIndex] ?? `T${cursor.trackIndex}`;
            const emoji = TRACK_EMOJIS[cursor.trackIndex] ?? '🎵';
            const shortId = (players.get(uid)?.username ?? '').replace(/^Player-/, '');
            const label = `${emoji} ${shortId} @${cursor.trackIndex + 1}`;
            const { dot, edge } = getOrCreateMarker(uid, color, label);
            const pos = dawInstance.noteToCanvas(cursor.step, cursor.pitch);

            if (pos.onScreen) {
                dot.style.display = 'block';
                dot.style.left = `${pos.x + 2 + canvasOffsetX}px`;
                dot.style.top  = `${pos.y + 2 + canvasOffsetY}px`;
                edge.style.display = 'none';
            } else {
                dot.style.display = 'none';
                // 画面端にナビ表示
                const margin = 4;
                let ex = 0, ey = 0, arrow = '';
                const cx = canvasOffsetX + Math.max(margin, Math.min(cw - margin, pos.x));
                const cy = canvasOffsetY + Math.max(margin, Math.min(ch - margin, pos.y));
                if (pos.side === 'left')  { ex = canvasOffsetX + margin; ey = cy; arrow = `◀ ${label}`; edge.style.transform = 'translateY(-50%)'; }
                if (pos.side === 'right') { ex = canvasOffsetX + cw - margin; ey = cy; arrow = `${label} ▶`; edge.style.transform = 'translateX(-100%) translateY(-50%)'; }
                if (pos.side === 'top')   { ex = cx; ey = canvasOffsetY + margin; arrow = `▲ ${label}`; edge.style.transform = 'translateX(-50%)'; }
                if (pos.side === 'bottom'){ ex = cx; ey = canvasOffsetY + ch - margin; arrow = `${label} ▼`; edge.style.transform = 'translate(-50%,-100%)'; }
                edge.style.left = `${ex}px`;
                edge.style.top  = `${ey}px`;
                edge.textContent = arrow;
                edge.style.display = 'block';
            }
        }

        // 接続が切れたユーザーのマーカーを削除
        for (const uid of toRemove) {
            const els = markerEls.get(uid);
            if (els) { els.dot.remove(); els.edge.remove(); }
            markerEls.delete(uid);
            remoteCursors.delete(uid);
        }

        requestAnimationFrame(rafLoop);
    };
    requestAnimationFrame(rafLoop);
};

// ─── 保留ノートの適用 ────────────────────────────────────────
const applyPendingNotes = () => {
    if (!dawInstance) return;
    if (pendingOwnNotes.length > 0 && myTrackIndex >= 0) {
        const trackId = TRACK_IDS[myTrackIndex];
        if (trackId) dawInstance.applyPatch(trackId, pendingOwnNotes, []);
        pendingOwnNotes = [];
    }
    for (const t of pendingAllTracks) {
        if (!t.notes?.length) continue;
        const trackId = TRACK_IDS[t.trackIndex];
        if (trackId) dawInstance.applyPatch(trackId, t.notes, []);
    }
    pendingAllTracks = [];
};

// 全プレイヤーにトラック楽器オーバーライドを再送信（再接続時）
const rebroadcastInstrumentOverrides = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    for (const [trackIndex, instrumentName] of trackInstrumentOverrides) {
        ws.send(JSON.stringify({ type: 'track-instrument', trackIndex, instrumentName }));
    }
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
// ページセッション固有のUUID（instanceIdは全員共通なので使わない）
const myUserId = (() => {
    const key = 'dtm-collab-uid';
    const stored = sessionStorage.getItem(key);
    if (stored) return stored;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
})();
let myUsername = 'Player';

const getRelayUrl = () => {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        return 'ws://localhost:3001';
    }
    // Discord Activity 内では /.proxy/ 経由でないと CSP でブロックされる
    return `wss://${location.host}/.proxy/relay`;
};

const connectRelay = (roomId) => {
    setRelayStatus('', 'CONNECTING TO RELAY…');
    const url = `${getRelayUrl()}?room=${encodeURIComponent(roomId)}`;
    ws = new WebSocket(url);
    ws._roomId = roomId;

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
            const wasSpectator = myTrackIndex === -1;
            myTrackIndex = msg.yourTrackIndex;
            players.set(myUserId, { username: myUsername, trackIndex: myTrackIndex });
            renderPlayers();
            // 自分の保存済みノートを保留（DAW起動後に適用）
            if (msg.yourNotes?.length > 0) pendingOwnNotes = msg.yourNotes;
            // スペクテーターから昇格した場合は DAW を再マウント
            if (wasSpectator && myTrackIndex >= 0 && dawInstance) {
                dawInstance.destroy();
                dawInstance = null;
                document.getElementById('players-label').textContent = '► PLAYERS';
                initDAW(false).then(() => {
                    rebroadcastInstrumentOverrides();
                }).catch(console.error);
            }
            break;
        }
        case 'full-state': {
            for (const t of (msg.tracks ?? [])) {
                if (t.userId) players.set(t.userId, { username: t.username, trackIndex: t.trackIndex });
            }
            // DAW起動後に適用するため保留
            pendingAllTracks = msg.tracks ?? [];
            if (dawInstance) applyPendingNotes();
            renderPlayers();
            // 再接続時に全プレイヤーへトラック楽器を再通知
            rebroadcastInstrumentOverrides();
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
            // スペクテーターは先客が抜けたら再join して昇格を試みる
            if (myTrackIndex === -1 && ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'join', roomId: ws._roomId, userId: myUserId, username: myUsername }));
            }
            break;
        }
        case 'lyrics': {
            if (dawInstance && msg.trackId && msg.data) {
                dawInstance.applyLyrics(msg.trackId, msg.data);
            }
            break;
        }
        case 'track-instrument': {
            if (msg.trackIndex != null) {
                trackInstrumentOverrides.set(msg.trackIndex, msg.instrumentName ?? '');
                if (dawInstance) {
                    dawInstance.applyTrackInstrument(msg.trackIndex, msg.instrumentName ?? '');
                }
            }
            break;
        }
        case 'cursor': {
            remoteCursors.set(msg.userId, { step: msg.step, pitch: msg.pitch, trackIndex: msg.trackIndex });
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
    // カーソル位置を操作したノートから取得して送信
    const ref = added[0] ?? removed[0];
    if (ref) ws.send(JSON.stringify({ type: 'cursor', step: ref.startStep, pitch: ref.pitch }));
};

// ─── DAW 起動 ────────────────────────────────────────────────
const initDAW = async (spectator = false) => {
    bootMsg.style.display = 'none';

    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const DTM = await import(isLocal
        ? 'http://localhost:40298/dist/index.mjs'
        : '/.proxy/dtm/demo/index.mjs?v=3d8c5d5e');

    const { createDtmStudio, TRACKS_ADVANCED } = DTM;

    const studio = await createDtmStudio({
        koeBaseUrl: '/.proxy/koe',
        worldlineScriptUrl: '/.proxy/koe-lib/demo/world/worldline.js',
        features: { midi: false },
    });

    const trackCount = TRACKS_ADVANCED?.length ?? 15;
    const myTrackId = TRACK_IDS[myTrackIndex] ?? TRACK_IDS[0];

    // スペクテーターは全トラックロック、通常は自分以外ロック
    const lockedTracks = spectator
        ? TRACK_IDS.slice(0, trackCount)
        : TRACK_IDS.filter((_, i) => i !== myTrackIndex && i < trackCount);

    dawInstance = studio.mountEditor(dawArea, {
        mode: 'advanced',
        tracks: TRACKS_ADVANCED,
        lockedTracks,
        initialActiveTrack: spectator ? TRACK_IDS[0] : myTrackId,
        initialScrollPitch: 60,
        onNotesPatch: spectator ? undefined : (trackId, added, removed) => {
            sendPatch(trackId, added, removed);
        },
        onLyricsChange: spectator ? undefined : (trackId, data) => {
            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'lyrics', trackId, data }));
            }
        },
        onTrackInstrumentChange: spectator ? undefined : (trackIndex, instrumentName) => {
            trackInstrumentOverrides.set(trackIndex, instrumentName);
            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'track-instrument', trackIndex, instrumentName }));
            }
        },
    });

    renderPlayers();
    applyPendingNotes();
    // トラック楽器オーバーライドを復元（再接続／昇格時のDAW再マウント対応）
    for (const [trackIndex, instrumentName] of trackInstrumentOverrides) {
        dawInstance.applyTrackInstrument(trackIndex, instrumentName);
    }
    startCursorOverlay();
};

// ─── エントリポイント ─────────────────────────────────────────
const main = async () => {
    // Discord SDK URL Mapping
    try {
        patchUrlMappings([
            { prefix: '/.proxy/fonts',   target: 'db.onlinewebfonts.com' },
            { prefix: '/.proxy/dtm',     target: 'onjmin.github.io/dtm' },
            { prefix: '/.proxy/surikov', target: 'surikov.github.io' },
            { prefix: '/.proxy/koe',     target: 'pub-12482a6b5cbc4c9e906b2e1904cabae5.r2.dev' },
            { prefix: '/.proxy/relay',   target: 'detailed-donkey-onjmin-fceb78f2.koyeb.app' },
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

    } catch (e) {
        const isTimeout = e?.message === 'timeout';
        setDiscordStatus('error', isTimeout ? 'STANDALONE MODE' : 'DISCORD ERROR');
        roomId = 'local-' + myUserId.slice(0, 6);
    }

    // リレーに接続（joined を受け取ってから DAW を起動）
    myUsername = `Player-${myUserId.slice(0, 4)}`;
    players.set(myUserId, { username: myUsername, trackIndex: -1 }); // trackIndex は joined で確定

    connectRelay(roomId);

    // joined を受け取ったら DAW 起動（最大5秒待機）
    await new Promise((resolve) => {
        const check = setInterval(() => {
            if (myTrackIndex !== -1) { clearInterval(check); resolve(); }
        }, 100);
        setTimeout(() => { clearInterval(check); resolve(); }, 5000);
    });

    // 自分のエントリを trackIndex で更新
    players.set(myUserId, { username: myUsername, trackIndex: myTrackIndex });

    if (myTrackIndex === -1) {
        // スペクテーターモード：全トラックを読み取り専用で表示
        bootMsg.style.display = 'none';
        document.getElementById('players-label').textContent = '► PLAYERS  （満員 — 閲覧専用）';
        try {
            await initDAW(true);
        } catch (e) {
            showError('DAW初期化に失敗しました: ' + (e?.message ?? e));
            console.error(e);
        }
        return;
    }

    try {
        await initDAW(false);
    } catch (e) {
        showError('DAW初期化に失敗しました: ' + (e?.message ?? e));
        console.error(e);
    }
};

main().catch((e) => {
    showError('初期化エラー: ' + (e?.message ?? e));
    console.error(e);
});
