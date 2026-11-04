# 作業の決まり

## コミットと push

言われる前に push する。作業の区切り（機能 1 つ、修正 1 つ、文書の更新 1 つが終わったところ）ごとに、確認を待たずにコミットして、次の手順で push する。

1. `git fetch upstream`
2. `git merge upstream/main`
3. コードを変えたら `pnpm test` と `npx tsc --noEmit` を通す。
4. `git push upstream HEAD:main`（本家 onjmin/dtm）
5. `git push origin HEAD:main`（elves-shoemaker/dtm）

- 作業が終わった報告は、push まで済ませてからする。
- コミットに入れるのは、その作業のファイルだけにする。改行コードだけの差分などを混ぜない。
- テストが落ちる、競合が解けない、早送りで push できないときは、force push せずに所有者に伝える。
- 動画や音源など `tmp/` の作品は git に入らない。作品ごとの行も足さない（作品の情報は手元の `docs/otomad/works/` に置く）。
