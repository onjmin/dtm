import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static' 

const app = new Hono()

// ルートで demo/index.html を配信
app.get('/', serveStatic({ root: './demo'})) 

// dist 配信
app.get('/dist/*', serveStatic({ root: './' }))

// CORS ヘッダ
app.use('*', (c, next) => {
  c.header('Access-Control-Allow-Origin', '*')
  return next()
})

// サーバー起動
serve({ fetch: app.fetch, port: 3000 })

console.log('Server running at http://localhost:3000')
