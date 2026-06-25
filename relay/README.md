# dtm-collab-relay

DTM 協力DAW Discord Activity 用 WebSocket リレーサーバー。

## 構成

```
relay/
├── server.js     # エントリポイント
├── package.json
├── Dockerfile
└── README.md
```

## ローカル起動

```bash
cd relay
npm install
npm run dev   # node --watch server.js（ポート 3001）
```

`demo/activity/collab.js` はローカル（localhost）を検出すると自動で `ws://localhost:3001` に接続します。

## Koyeb へのデプロイ

### 前提

- Koyeb アカウント（無料枠で動作）
- GitHub リポジトリが Koyeb に連携済み

### 手順

1. **Koyeb ダッシュボード** → "Create Service" → "GitHub"

2. 以下を設定：

   | 項目 | 値 |
   |---|---|
   | Repository | `onjmin/dtm` |
   | Branch | `main` |
   | Build context | `relay` |
   | Dockerfile path | `relay/Dockerfile` |
   | Port | `3001` |

3. "Deploy" を押す。

4. デプロイ完了後、払い出された URL（例: `https://dtm-relay-xxxx.koyeb.app`）を確認する。

5. `demo/activity/collab.js` の以下の行を書き換える：

   ```js
   const RELAY_URL_PROD = 'wss://dtm-relay-xxxx.koyeb.app';
   ```

6. `main` にプッシュ → GitHub Actions が自動デプロイ。

### 環境変数

Koyeb は `PORT` を自動注入します。手動設定は不要です。

## プロトコル

```
Client → Server
  { type: "join",  roomId, userId, username }
  { type: "patch", added: NoteData[], removed: NoteRemove[] }

Server → Client
  { type: "joined",     yourTrackIndex }
  { type: "full-state", users: [{ userId, username, trackIndex, notes }] }
  { type: "user-join",  userId, username, trackIndex }
  { type: "user-leave", userId, trackIndex }
  { type: "patch",      userId, trackIndex, added, removed }
```

ルームID は Discord の `guildId:channelId`。ローカルでは `local-xxxxxx`。
