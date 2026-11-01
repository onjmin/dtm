# VOICEVOX で歌わせる（試作）

> まっさらな PC に入れて鳴らすまでの手順（ほかのエンジンと共通の準備・`pnpm engines` でのまとめての起動を含む）は [local-engines-setup.md](local-engines-setup.md)。このページはこのエンジンの細かい話。

歌詞トラックの音源に VOICEVOX の歌い手を選ぶと、手元で起動した VOICEVOX エンジンの歌唱 API で歌わせる。
koe（UTAU 音源をブラウザ内で合成）とは別の経路で、エンジンに楽譜を送って WAV を受け取り、伴奏に合わせて並べる。
選ぶまでの調べ物と、採らなかった案は [research/singing-engines.md](../research/singing-engines.md)。

## 使い方

1. VOICEVOX エンジンを起動する（既定 `http://127.0.0.1:50021`）。手元では 0.26.0 の CPU 版を `tmp/voicevox/engine/` に置き、`run.exe` で動かしている（`tmp/` は git 管理外）。
2. dtm のページを**手元で**開き（localhost・127.0.0.1・file:）、歌詞トラックの音源から「VOICEVOX（要エンジン起動）」の中の声を選ぶ。MML では `@@0 vv_zundamon かし…` と書く。公開サイトなど手元以外で開いたページでは選択肢に出ない（NEUTRINO と同じ。`src/voice/local-engines.ts`）。
3. 歌声だけを WAV にするときは CLI を使う（伴奏は入らない）。

   ```bash
   npx tsx scripts/misc/voicevox-sing.ts 曲.mml --track 0 --singer ずんだもん --out scratch/voicevox/sing.wav
   ```

   `--singer` はエンジンの歌い手一覧から名前の一部で探す。`--key` で半音単位に移調する。

| モデル名 | 歌い手（クレジット表記は「VOICEVOX:」＋この名前） | 歌唱スタイルID | 語りの話し声のスタイルID |
| :--- | :--- | :--- | :--- |
| `vv_zundamon` | ずんだもん | 3003 | 3 |
| `vv_metan` | 四国めたん | 3002 | 2 |
| `vv_tsumugi` | 春日部つむぎ | 3008 | 8 |
| `vv_hau` | 雨晴はう | 3010 | 10 |
| `vv_ritsu` | 波音リツ | 3009 | 9 |
| `vv_takehiro` | 玄野武宏 | 3011 | 11 |
| `vv_kotarou` | 白上虎太郎 | 3012 | 12 |
| `vv_ryusei` | 青山龍星 | 3013 | 13 |
| `vv_himari` | 冥鳴ひまり | 3014 | 14 |
| `vv_sora` | 九州そら | 3016 | 16 |
| `vv_mochiko` | もち子(cv 明日葉よもぎ) | 3020 | 20 |
| `vv_mesuo` | 剣崎雌雄 | 3021 | 21 |
| `vv_whitecul` | WhiteCUL | 3023 | 23 |
| `vv_goki` | 後鬼 | 3027 | 27 |
| `vv_no7` | No.7 | 3029 | 29 |
| `vv_chibijii` | ちび式じい | 3042 | 42 |
| `vv_miko` | 櫻歌ミコ | 3043 | 43 |
| `vv_sayo` | 小夜/SAYO | 3046 | 46 |
| `vv_nurserobo` | ナースロボ＿タイプＴ | 3047 | 47 |
| `vv_benizakura` | †聖騎士 紅桜† | 3051 | 51 |
| `vv_akashi` | 雀松朱司 | 3052 | 52 |
| `vv_sourin` | 麒ヶ島宗麟 | 3053 | 53 |
| `vv_nana` | 春歌ナナ | 3054 | 54 |
| `vv_aru` | 猫使アル | 3055 | 55 |
| `vv_bi` | 猫使ビィ | 3058 | 58 |
| `vv_usagi` | 中国うさぎ | 3061 | 61 |
| `vv_maron` | 栗田まろん | 3067 | 67 |
| `vv_aierutan` | あいえるたん | 3068 | 68 |
| `vv_hanamaru` | 満別花丸 | 3069 | 69 |
| `vv_nia` | 琴詠ニア | 3074 | 74 |

歌えるのは、VOICEVOX の歌声用モデル（[voicevox_vvm](https://github.com/VOICEVOX/voicevox_vvm) の `s0.vvm`）に入っている30人全員（2026-11-01、エンジン 0.26.0 の `/singers` で確かめ、全員に短い楽譜を歌わせて声が出ることを確かめた）。上の表はそれぞれのノーマル（白上虎太郎は「ふつう」、後鬼は「人間ver.」）。ほかのスタイルは下の「スタイル違い」。
**東北ずん子・東北きりたん・東北イタコ、ユーレイちゃん、Voidoll などは、VOICEVOX では話し声（トーク）のモデルしか配られておらず、歌えない。** 東北三姉妹は NEUTRINO の歌声ライブラリで歌える（[neutrino-sing.md](neutrino-sing.md)）。
歌い手を増やすときは `src/voice/voicevox-sing.ts` の `VOICEVOX_CHARACTERS` に1人足す（スタイル違いは `VOICEVOX_EXTRA_STYLES`）。
公開するときは「VOICEVOX:ずんだもん」のような表記が要る（もち子さんは「VOICEVOX:もち子(cv 明日葉よもぎ)」）。キャラごとに規約が違い、商用や企業での利用に条件が付くキャラもいる（No.7 は非商用、青山龍星・もち子さん・後鬼などは企業が携わるときに事前の確認が要る。voicevox_vvm の README の「音声ライブラリ利用規約」）。利用規約のリンクは、VOICEVOX 公式のキャラクターページを指す。

### スタイル違い（ひそひそ声など）

ノーマル以外の歌えるスタイルは、モデル名 `<キャラのモデル名>_<スタイル>` で選ぶ（例: `@@0 vv_zundamon_hisohiso かし…`）。音源の一覧では、そのキャラのノーマルのすぐ下に「VOICEVOX:ずんだもん（ヒソヒソ）」のように並ぶ。アイコン・利用規約・クレジット表記は元のキャラと同じ。
語り（`「…」`）は同じスタイルの話し声で読む（ヒソヒソで歌うキャラは語りもヒソヒソ）。

エンジン 0.26.0 の `/singers` に出る歌えるスタイル（frame_decode）を全部載せた。17人・51スタイル。2026-11-01 に全スタイルで短い楽譜を歌わせ、声が出ることを確かめた。歌唱スタイルIDは、どれも話し声のスタイルID + 3000。
話し声にしか無いスタイル（ずんだもん・四国めたん・九州そらの「ささやき」、青山龍星の「囁き」、ナースロボの「内緒話」、猫使アルの「つよつよ」など）は歌えない。ひそひそ声で歌いたいときは「ヒソヒソ」（ずんだもん・四国めたん）か「ささやき」（満別花丸）を使う。

| モデル名 | スタイル | 歌唱スタイルID | 語りの話し声のスタイルID |
| :--- | :--- | :--- | :--- |
| `vv_metan_amaama` | あまあま | 3000 | 0 |
| `vv_metan_tsuntsun` | ツンツン | 3006 | 6 |
| `vv_metan_sexy` | セクシー | 3004 | 4 |
| `vv_metan_hisohiso` | ヒソヒソ | 3037 | 37 |
| `vv_zundamon_amaama` | あまあま | 3001 | 1 |
| `vv_zundamon_tsuntsun` | ツンツン | 3007 | 7 |
| `vv_zundamon_sexy` | セクシー | 3005 | 5 |
| `vv_zundamon_hisohiso` | ヒソヒソ | 3038 | 38 |
| `vv_zundamon_herohero` | ヘロヘロ | 3075 | 75 |
| `vv_zundamon_namidame` | なみだめ | 3076 | 76 |
| `vv_ritsu_queen` | クイーン | 3065 | 65 |
| `vv_takehiro_yorokobi` | 喜び | 3039 | 39 |
| `vv_takehiro_tsungire` | ツンギレ | 3040 | 40 |
| `vv_takehiro_kanashimi` | 悲しみ | 3041 | 41 |
| `vv_kotarou_wai` | わーい | 3032 | 32 |
| `vv_kotarou_bikubiku` | びくびく | 3033 | 33 |
| `vv_kotarou_oko` | おこ | 3034 | 34 |
| `vv_kotarou_bien` | びえーん | 3035 | 35 |
| `vv_ryusei_nekketsu` | 熱血 | 3081 | 81 |
| `vv_ryusei_fukigen` | 不機嫌 | 3082 | 82 |
| `vv_ryusei_yorokobi` | 喜び | 3083 | 83 |
| `vv_ryusei_shittori` | しっとり | 3084 | 84 |
| `vv_ryusei_kanashimi` | かなしみ | 3085 | 85 |
| `vv_sora_amaama` | あまあま | 3015 | 15 |
| `vv_sora_tsuntsun` | ツンツン | 3018 | 18 |
| `vv_sora_sexy` | セクシー | 3017 | 17 |
| `vv_mochiko_sexy` | セクシー／あん子 | 3066 | 66 |
| `vv_mochiko_naki` | 泣き | 3077 | 77 |
| `vv_mochiko_ikari` | 怒り | 3078 | 78 |
| `vv_mochiko_yorokobi` | 喜び | 3079 | 79 |
| `vv_mochiko_nonbiri` | のんびり | 3080 | 80 |
| `vv_whitecul_tanoshii` | たのしい | 3024 | 24 |
| `vv_whitecul_kanashii` | かなしい | 3025 | 25 |
| `vv_whitecul_bien` | びえーん | 3026 | 26 |
| `vv_goki_nuigurumi` | ぬいぐるみver. | 3028 | 28 |
| `vv_no7_announce` | アナウンス | 3030 | 30 |
| `vv_no7_yomikikase` | 読み聞かせ | 3031 | 31 |
| `vv_miko_daini` | 第二形態 | 3044 | 44 |
| `vv_miko_loli` | ロリ | 3045 | 45 |
| `vv_nurserobo_rakuraku` | 楽々 | 3048 | 48 |
| `vv_nurserobo_kyofu` | 恐怖 | 3049 | 49 |
| `vv_aru_ochitsuki` | おちつき | 3056 | 56 |
| `vv_aru_ukiuki` | うきうき | 3057 | 57 |
| `vv_bi_ochitsuki` | おちつき | 3059 | 59 |
| `vv_usagi_odoroki` | おどろき | 3062 | 62 |
| `vv_usagi_kowagari` | こわがり | 3063 | 63 |
| `vv_usagi_herohero` | へろへろ | 3064 | 64 |
| `vv_hanamaru_genki` | 元気 | 3070 | 70 |
| `vv_hanamaru_sasayaki` | ささやき | 3071 | 71 |
| `vv_hanamaru_burikko` | ぶりっ子 | 3072 | 72 |
| `vv_hanamaru_boy` | ボーイ | 3073 | 73 |

## 仕組み

- **楽譜への変換**（`buildVoicevoxScore`）: dtm の音符と音節を VOICEVOX の Score にする。単位はフレーム（24000Hz / 256 = 93.75 フレーム/秒）。秒で累積してから丸めるので、長い曲でも誤差は溜まらない。
  - 和音・重なった音は、UST 書き出しと同じく先に置いた音を残す（単旋律だけ歌う）。
  - `ー` は、同じ高さなら前の音を伸ばし、高さが変わるなら母音で歌い直す。
  - `_` と語り（`「…」`）は歌の楽譜では休符にする（語りは下の話し声で別に鳴らす）。`、`（ブレス）は前の音の尻を 0.12 秒削って休符を入れる。
- **合成**: `/sing_frame_audio_query` で歌唱ティーチャー（波音リツ、6000）が音素長とピッチを決め、`/frame_synthesis` で選んだ歌い手の声色で鳴らす。
- **語り**（`「…」`）: 同じキャラの VOICEVOX の話し声（`VOICEVOX_SINGERS` の `talk`。ずんだもんは 3 など）で、`/audio_query` → `/synthesis` で読み上げ、その音符の頭から鳴らす。本文は漢字まじりのまま渡し、読みとアクセントはエンジンが決める（`synthesizeVoicevoxTalk`）。2026-10-31 にデモの DAW で、語りが音符の頭に置かれ、前後の歌と重ならないことを確かめた。
- **再生**（`src/voice/lyrics.ts` の `createSingingVoices`）: 休符・ブレス・語りでフレーズに切り、フレーズごとにエンジンへ頼む。
  - 同じ内容のフレーズはキャッシュし、2回目以降の再生やシークでは作り直さない。
  - エンジンへは、どのトラックでも再生位置に近いフレーズから先に頼み、残りが間に合う見込みが立ったら鳴らし始める（手元のエンジン共通。[neutrino-sing.md](neutrino-sing.md) の「待たずに鳴らし始める仕組み」）。
  - 再生前は最初のフレーズができるまで待ち、残りは再生しながら頭から順に作る。間に合わなかったフレーズと、シークで途中から始まるフレーズは途中から鳴らす。
  - 音量・定位・リバーブとディレイの送り・ソロ・ループ・停止は、ほかの歌声と同じように効く。
- 歌入り作曲でボーカルをおまかせにしたときは VOICEVOX の声を引かない（エンジンが起動していないと鳴らないため。`daw.ts` の `COMPOSE_VOCAL_POOL`）。
- テストは `scripts/test/check-voicevox-score.ts`（変換だけ。エンジンは呼ばない）。

## 確かめたこと（2026-10-31）

- CLI でデモ曲（どんぐりころころ）を歌わせ、波形から測った音の高さが楽譜どおりだった。
- デモ画面からエンジンを直接呼べた（CORS は通る）。DAW で2フレーズ再生して録音し、楽譜どおりの高さで伴奏と同じタイミングに歌っていた。

## 制約

- **エンジンが起動していないと VOICEVOX のトラックは鳴らない。** 他の声で代わりに鳴らさず、コンソールに警告を1回出すだけ。
- エンジンの場所は既定で `127.0.0.1:50021` なので、エンジンを動かしている PC のブラウザでしか歌わない。公開サイトの聴き手に届けるには、エンジンを外から呼べる場所に置く（Strata のようにキー付きで公開するなど）。
- 歌えるのは単旋律だけ。声のフェード（`↓` `↑`）、オクターブ重ね、声質のつまみ（gender など）は効かない。
