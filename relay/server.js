/**
 * DTM Collab Relay Server
 *
 * WebSocket relay for the collaborative DAW Discord Activity.
 * Deploy to Koyeb: set PORT env var (Koyeb injects it automatically).
 *
 * Protocol (JSON):
 *   Client → Server:
 *     { type: "join",  roomId, userId, username }
 *     { type: "patch", added: NoteData[], removed: NoteRemove[] }
 *   Server → Client:
 *     { type: "joined",     yourTrackIndex }
 *     { type: "full-state", users: [{ userId, username, trackIndex, notes }] }
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
 * rooms: Map<roomId, Map<userId, UserState>>
 * UserState: { ws, username, trackIndex, notes: NoteData[] }
 */
const rooms = new Map();

const keyOf = (n) => `${n.startStep}_${n.pitch}`;

const broadcast = (room, message, exceptUserId = null) => {
    const data = JSON.stringify(message);
    for (const [uid, user] of room) {
        if (uid !== exceptUserId && user.ws.readyState === 1 /* OPEN */) {
            user.ws.send(data);
        }
    }
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
            userId = String(msg.userId ?? Math.random().toString(36).slice(2));
            const username = String(msg.username ?? 'Player');

            if (!rooms.has(roomId)) rooms.set(roomId, new Map());
            const room = rooms.get(roomId);

            // 再接続時は古いセッションを上書き
            if (room.has(userId)) {
                broadcast(room, { type: 'user-leave', userId, trackIndex: room.get(userId).trackIndex }, userId);
                room.delete(userId);
            }

            // トラックインデックスを最小の未使用番号で割り当て
            const usedIndices = new Set([...room.values()].map((u) => u.trackIndex));
            let trackIndex = 0;
            while (usedIndices.has(trackIndex)) trackIndex++;

            room.set(userId, { ws, username, trackIndex, notes: [] });

            // 参加確認 + 他ユーザーの現在状態を送信
            ws.send(JSON.stringify({ type: 'joined', yourTrackIndex: trackIndex }));
            const fullState = [...room.entries()]
                .filter(([uid]) => uid !== userId)
                .map(([uid, u]) => ({
                    userId: uid,
                    username: u.username,
                    trackIndex: u.trackIndex,
                    notes: u.notes,
                }));
            ws.send(JSON.stringify({ type: 'full-state', users: fullState }));

            // 既存ユーザーに新メンバー通知
            broadcast(room, { type: 'user-join', userId, username, trackIndex }, userId);
            return;
        }

        // ── patch ─────────────────────────────────────────────
        if (msg.type === 'patch') {
            if (!roomId || !userId) return;
            const room = rooms.get(roomId);
            if (!room) return;
            const user = room.get(userId);
            if (!user) return;

            const added = Array.isArray(msg.added) ? msg.added : [];
            const removed = Array.isArray(msg.removed) ? msg.removed : [];

            // サーバー側のノート状態を更新
            const removeSet = new Set(removed.map((r) => keyOf(r)));
            user.notes = user.notes.filter((n) => !removeSet.has(keyOf(n)));
            for (const n of added) {
                if (!user.notes.some((e) => keyOf(e) === keyOf(n))) {
                    user.notes.push({
                        startStep: n.startStep,
                        pitch: n.pitch,
                        durationSteps: n.durationSteps,
                        velocity: n.velocity,
                    });
                }
            }

            broadcast(room, { type: 'patch', userId, trackIndex: user.trackIndex, added, removed }, userId);
            return;
        }
    });

    ws.on('close', () => {
        if (!roomId || !userId) return;
        const room = rooms.get(roomId);
        if (!room) return;
        const user = room.get(userId);
        if (user) {
            broadcast(room, { type: 'user-leave', userId, trackIndex: user.trackIndex });
        }
        room.delete(userId);
        if (room.size === 0) rooms.delete(roomId);
    });

    ws.on('error', (err) => {
        console.error('[relay] ws error:', err.message);
    });
});

server.listen(PORT, () => {
    console.log(`[relay] Listening on port ${PORT}`);
});
