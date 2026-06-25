/**
 * DTM Collab Relay Server
 *
 * Protocol (JSON):
 *   Client → Server:
 *     { type: "join",  roomId, userId, username }
 *     { type: "patch", added: NoteData[], removed: NoteRemove[] }
 *   Server → Client:
 *     { type: "joined",     yourTrackIndex, yourNotes: NoteData[] }
 *     { type: "full-state", tracks: [{ userId, username, trackIndex, notes, online }] }
 *     { type: "user-join",  userId, username, trackIndex }
 *     { type: "user-leave", userId, trackIndex }
 *     { type: "patch",      userId, trackIndex, added, removed }
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('DTM Collab Relay OK\n');
});

const wss = new WebSocketServer({ server });

/**
 * rooms: Map<roomId, Room>
 *
 * Room.users:       Map<userId, { ws, username, trackIndex }>  現在接続中
 * Room.trackNotes:  Map<trackIndex, { notes, lastUserId, lastUsername }>  切断後も保持
 */
const rooms = new Map();

const keyOf = (n) => `${n.startStep}_${n.pitch}`;

const broadcast = (room, message, exceptUserId = null) => {
    const data = JSON.stringify(message);
    for (const [uid, user] of room.users) {
        if (uid !== exceptUserId && user.ws.readyState === 1) {
            user.ws.send(data);
        }
    }
};

const getOrCreateRoom = (id) => {
    if (!rooms.has(id)) rooms.set(id, { users: new Map(), trackNotes: new Map() });
    return rooms.get(id);
};

const applyPatchToNotes = (notes, added, removed) => {
    const removeSet = new Set(removed.map(keyOf));
    const result = notes.filter((n) => !removeSet.has(keyOf(n)));
    for (const n of added) {
        if (!result.some((e) => keyOf(e) === keyOf(n))) {
            result.push({ startStep: n.startStep, pitch: n.pitch, durationSteps: n.durationSteps, velocity: n.velocity });
        }
    }
    return result;
};

wss.on('connection', (ws) => {
    let roomId = null;
    let userId = null;

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        // ── join ──────────────────────────────────────────────
        if (msg.type === 'join') {
            roomId = String(msg.roomId ?? 'default');
            userId = String(msg.userId ?? crypto.randomUUID());
            const username = String(msg.username ?? 'Player');

            const room = getOrCreateRoom(roomId);

            // 再接続時は旧セッションを退出扱い
            if (room.users.has(userId)) {
                const old = room.users.get(userId);
                broadcast(room, { type: 'user-leave', userId, trackIndex: old.trackIndex }, userId);
                room.users.delete(userId);
            }

            // トラックインデックス割り当て
            // 同じ userId が前回使ったトラックがあれば優先して再利用
            const MAX_TRACKS = 15;
            const savedTrack = room.trackNotes.get('__owner__' + userId); // 前回のtrackIndex記録
            const usedByOthers = new Set(
                [...room.users.values()].map((u) => u.trackIndex).filter((i) => i >= 0),
            );

            let trackIndex = -1;
            if (savedTrack !== undefined && !usedByOthers.has(savedTrack)) {
                // 前回のトラックが空いていれば再利用
                trackIndex = savedTrack;
            } else if (usedByOthers.size < MAX_TRACKS) {
                trackIndex = 0;
                while (usedByOthers.has(trackIndex)) trackIndex++;
            }

            room.users.set(userId, { ws, username, trackIndex });
            if (trackIndex >= 0) {
                room.trackNotes.set('__owner__' + userId, trackIndex);
                // trackNotes に既存エントリがなければ初期化
                if (!room.trackNotes.has(trackIndex)) {
                    room.trackNotes.set(trackIndex, { notes: [], lastUserId: userId, lastUsername: username });
                } else {
                    // オーナー情報を更新
                    room.trackNotes.get(trackIndex).lastUserId = userId;
                    room.trackNotes.get(trackIndex).lastUsername = username;
                }
            }

            // 自分のトラックの保存済みノートを返す
            const yourNotes = trackIndex >= 0 ? (room.trackNotes.get(trackIndex)?.notes ?? []) : [];
            ws.send(JSON.stringify({ type: 'joined', yourTrackIndex: trackIndex, yourNotes }));

            // 全トラックの状態を送信（接続中 + オフラインのトラック両方）
            const tracks = [];
            for (const [key, entry] of room.trackNotes) {
                if (typeof key !== 'number') continue; // __owner__ エントリをスキップ
                if (key === trackIndex) continue;       // 自分のトラックはスキップ（yourNotes で渡した）
                const onlineUser = [...room.users.entries()].find(([, u]) => u.trackIndex === key);
                tracks.push({
                    userId: onlineUser ? onlineUser[0] : entry.lastUserId,
                    username: onlineUser ? onlineUser[1].username : entry.lastUsername,
                    trackIndex: key,
                    notes: entry.notes,
                    online: !!onlineUser,
                });
            }
            // trackNotes にないが接続中のユーザー（ノートゼロ）
            for (const [uid, u] of room.users) {
                if (uid === userId) continue;
                if (!room.trackNotes.has(u.trackIndex)) {
                    tracks.push({ userId: uid, username: u.username, trackIndex: u.trackIndex, notes: [], online: true });
                }
            }
            ws.send(JSON.stringify({ type: 'full-state', tracks }));

            // 既存ユーザーに新メンバー通知
            if (trackIndex >= 0) {
                broadcast(room, { type: 'user-join', userId, username, trackIndex }, userId);
            }
            return;
        }

        // ── lyrics ────────────────────────────────────────────
        if (msg.type === 'lyrics') {
            if (!roomId || !userId) return;
            const room = rooms.get(roomId);
            if (!room) return;
            const user = room.users.get(userId);
            if (!user || user.trackIndex < 0) return;
            broadcast(room, {
                type: 'lyrics',
                trackId: msg.trackId,
                data: msg.data,
            }, userId);
            return;
        }

        // ── cursor ────────────────────────────────────────────
        if (msg.type === 'cursor') {
            if (!roomId || !userId) return;
            const room = rooms.get(roomId);
            if (!room) return;
            const user = room.users.get(userId);
            if (!user || user.trackIndex < 0) return;
            broadcast(room, {
                type: 'cursor',
                userId,
                trackIndex: user.trackIndex,
                step: msg.step,
                pitch: msg.pitch,
            }, userId);
            return;
        }

        // ── patch ─────────────────────────────────────────────
        if (msg.type === 'patch') {
            if (!roomId || !userId) return;
            const room = rooms.get(roomId);
            if (!room) return;
            const user = room.users.get(userId);
            if (!user || user.trackIndex < 0) return;

            const added   = Array.isArray(msg.added)   ? msg.added   : [];
            const removed = Array.isArray(msg.removed) ? msg.removed : [];

            // trackNotes を更新
            const entry = room.trackNotes.get(user.trackIndex);
            if (entry) entry.notes = applyPatchToNotes(entry.notes, added, removed);

            broadcast(room, { type: 'patch', userId, trackIndex: user.trackIndex, added, removed }, userId);
            return;
        }
    });

    ws.on('close', () => {
        if (!roomId || !userId) return;
        const room = rooms.get(roomId);
        if (!room) return;
        const user = room.users.get(userId);
        if (user) {
            broadcast(room, { type: 'user-leave', userId, trackIndex: user.trackIndex });
        }
        room.users.delete(userId);
        // trackNotes は削除しない（再参加・新規参加のために保持）
        // 全員抜けたら部屋ごと削除
        if (room.users.size === 0) rooms.delete(roomId);
    });

    ws.on('error', (err) => {
        console.error('[relay] ws error:', err.message);
    });
});

server.listen(PORT, () => {
    console.log(`[relay] Listening on port ${PORT}`);
});
