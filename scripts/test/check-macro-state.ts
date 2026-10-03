import assert from "node:assert/strict";
import { STRUCTURE_TEMPLATES } from "../../src/compose/compose-sections";
import {
	COMPOSE_GENRES,
	DEFAULT_COMPOSE_GENRE,
	genreFromTemplate,
} from "../../src/ui/compose-genres";
import {
	KEPT_SONGS_LIMIT,
	MACRO_STORAGE_KEYS,
	readKeptSong,
	readKeptSongs,
	readMacroSetting,
	writeKeptSong,
	writeKeptSongs,
	writeMacroSetting,
} from "../../src/ui/state/macro-state";

console.log("● macro-state tests");

// 1. localStorage モック環境の構築
class MockLocalStorage {
	private store = new Map<string, string>();

	getItem(key: string): string | null {
		return this.store.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.store.set(key, value);
	}

	removeItem(key: string): void {
		this.store.delete(key);
	}

	clear(): void {
		this.store.clear();
	}
}

const mockStorage = new MockLocalStorage();
(globalThis as any).localStorage = mockStorage;

// 2. 単一設定の読み書きテスト
mockStorage.clear();
assert.equal(readMacroSetting("template"), null, "初期値は null");

writeMacroSetting("template", "jpop_standard");
assert.equal(
	mockStorage.getItem(MACRO_STORAGE_KEYS.template),
	"jpop_standard",
	"localStorage に書き込まれていること",
);
assert.equal(
	readMacroSetting("template"),
	"jpop_standard",
	"正しく読み出せること",
);

writeMacroSetting("key", "mood_happy");
assert.equal(readMacroSetting("key"), "mood_happy");

writeMacroSetting("shift", "48");
assert.equal(readMacroSetting("shift"), "48");

writeMacroSetting("transpose", "2");
assert.equal(readMacroSetting("transpose"), "2");

// 4. localStorage がアクセス例外を投げる環境（クォータ超過やプライベートブラウズ）での安全性テスト
const throwingStorage = {
	getItem() {
		throw new Error("SecurityError: Access is denied");
	},
	setItem() {
		throw new Error("QuotaExceededError");
	},
};
(globalThis as any).localStorage = throwingStorage;

assert.equal(
	readMacroSetting("template"),
	null,
	"例外発生時でもクラッシュせず null を返すこと",
);
assert.doesNotThrow(() => {
	writeMacroSetting("template", "custom");
}, "書き込み時の例外でもクラッシュしないこと");

// 5. localStorage が未定義の環境
(globalThis as any).localStorage = undefined;
assert.equal(
	readMacroSetting("template"),
	null,
	"localStorage 未定義でも null",
);
assert.doesNotThrow(() => {
	writeMacroSetting("template", "custom");
}, "localStorage 未定義でも書き込みでクラッシュしないこと");

console.log("✓ すべてのテストに合格しました！");

// キープ枠（自動作曲の退避）
{
	// 直前の節が例外を投げる localStorage に差し替えているので、モックへ戻す。
	(globalThis as any).localStorage = mockStorage;
	mockStorage.clear();
	assert.equal(readKeptSong(), null, "キープ枠の初期値は null");

	writeKeptSong({ mml: "t120 o4 cdef", startStep: 768 });
	assert.deepEqual(
		readKeptSong(),
		{ mml: "t120 o4 cdef", startStep: 768 },
		"MML と再生開始位置が往復すること",
	);

	writeKeptSong(null);
	assert.equal(readKeptSong(), null, "null で枠が空になること");

	// 壊れた保存値は無視する（古い形式・手で書き換えられた値など）
	mockStorage.setItem("dtm-macro:kept", "{not json");
	assert.equal(readKeptSong(), null, "JSON でなければ null");
	mockStorage.setItem("dtm-macro:kept", JSON.stringify({ mml: "" }));
	assert.equal(readKeptSong(), null, "MML が空なら null");
	mockStorage.setItem(
		"dtm-macro:kept",
		JSON.stringify({ mml: "cde", startStep: -5 }),
	);
	assert.deepEqual(
		readKeptSong(),
		{ mml: "cde", startStep: 0 },
		"不正な再生位置は 0 へ倒す",
	);
	mockStorage.setItem("dtm-macro:kept", JSON.stringify({ mml: "cde" }));
	assert.deepEqual(
		readKeptSong(),
		{ mml: "cde", startStep: 0 },
		"再生位置が無ければ 0",
	);
	console.log("  ✓ キープ枠の読み書き");
}

// 残した曲（一覧）と旧キープ枠の移行
{
	mockStorage.clear();
	assert.deepEqual(readKeptSongs(), [], "一覧の初期値は空");

	// 旧キープ枠（1曲）だけがあれば一覧へ移し、旧枠は消す
	writeKeptSong({ mml: "t120 o4 cdef", startStep: 768 });
	const migrated = readKeptSongs();
	assert.equal(migrated.length, 1, "旧キープ枠が一覧へ移ること");
	assert.equal(migrated[0]?.mml, "t120 o4 cdef");
	assert.equal(migrated[0]?.startStep, 768);
	assert.ok(migrated[0]?.id, "移した曲に id が付くこと");
	assert.equal(readKeptSong(), null, "移した後は旧枠が空になること");
	assert.equal(readKeptSongs()[0]?.id, migrated[0]?.id, "2回目は同じ一覧");

	// 往復と上限
	const many = Array.from({ length: KEPT_SONGS_LIMIT + 3 }, (_, i) => ({
		id: `id${i}`,
		mml: `cde${i}`,
		startStep: i,
		title: `曲${i}`,
		info: "120 BPM",
		savedAt: i,
	}));
	assert.equal(writeKeptSongs(many), true);
	const back = readKeptSongs();
	assert.equal(back.length, KEPT_SONGS_LIMIT, "上限で切ること");
	assert.deepEqual(back[0], many[0], "見出し・補足まで往復すること");

	// 壊れた要素は捨てる
	mockStorage.setItem(
		"dtm-macro:kept-list",
		JSON.stringify([{ mml: "" }, { mml: "abc", startStep: -1 }, 3]),
	);
	const cleaned = readKeptSongs();
	assert.equal(cleaned.length, 1);
	assert.equal(cleaned[0]?.startStep, 0);
	mockStorage.setItem("dtm-macro:kept-list", "{not json");
	assert.deepEqual(readKeptSongs(), [], "JSON でなければ空");
	console.log("  ✓ 残した曲の一覧と旧枠の移行");
}

// ジャンルのカード → テンプレート
{
	const names = new Set(STRUCTURE_TEMPLATES.map((t) => t.name));
	for (const g of COMPOSE_GENRES) {
		for (const vocal of [true, false]) {
			const t = g.template(vocal);
			assert.ok(names.has(t), `${g.id} → ${t} は既存テンプレート`);
		}
	}
	// 残したカードの旧「構成」の保存値は、そのカードへ戻せる（往復でテンプレート名が変わらない）
	for (const old of [
		"game_loop",
		"kaiwai_kaisen",
		"kaiwai_2go_lead",
		"kaiwai_2go",
		"kaiwai_speder2_lead",
		"kaiwai_speder2",
	]) {
		const m = genreFromTemplate(old);
		const g = COMPOSE_GENRES.find((x) => x.id === m.genre);
		assert.ok(g, old);
		assert.equal(g.template(m.vocal ?? g.vocalDefault), old, `${old} の移行`);
	}
	// 外したジャンルの保存値は既定のカードへ落ちる
	for (const old of ["jpop_standard", "vocaloid", "kaiwai", "custom"])
		assert.equal(genreFromTemplate(old).genre, DEFAULT_COMPOSE_GENRE, old);
	console.log("  ✓ ジャンルのカードとテンプレートの対応");
}
