import assert from "node:assert/strict";
import {
	MACRO_STORAGE_KEYS,
	readKeptSong,
	readMacroSections,
	readMacroSetting,
	writeKeptSong,
	writeMacroSections,
	writeMacroSetting,
} from "../src/macro-state";

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

// 3. セクション（配列）の読み書きテスト
mockStorage.clear();
assert.equal(readMacroSections(), null, "未設定時は null");

const testSections = ["intro", "verse", "chorus", "outro"];
writeMacroSections(testSections);
assert.deepEqual(
	readMacroSections(),
	testSections,
	"配列がシリアライズ・デシリアライズされること",
);

// 不正な JSON または不正な型のテスト
mockStorage.setItem(MACRO_STORAGE_KEYS.sections, "invalid-json");
assert.equal(readMacroSections(), null, "不正な JSON の場合は null を返すこと");

mockStorage.setItem(
	MACRO_STORAGE_KEYS.sections,
	JSON.stringify({ not: "an array" }),
);
assert.equal(
	readMacroSections(),
	null,
	"オブジェクト等の場合は null を返すこと",
);

mockStorage.setItem(MACRO_STORAGE_KEYS.sections, JSON.stringify([1, 2, 3]));
assert.equal(
	readMacroSections(),
	null,
	"文字列以外の配列が含まれる場合は null を返すこと",
);

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
assert.equal(
	readMacroSections(),
	null,
	"例外発生時でもクラッシュせず null を返すこと",
);
assert.doesNotThrow(() => {
	writeMacroSetting("template", "custom");
	writeMacroSections(["verse"]);
}, "書き込み時の例外でもクラッシュしないこと");

// 5. localStorage が未定義の環境
(globalThis as any).localStorage = undefined;
assert.equal(
	readMacroSetting("template"),
	null,
	"localStorage 未定義でも null",
);
assert.equal(readMacroSections(), null, "localStorage 未定義でも null");
assert.doesNotThrow(() => {
	writeMacroSetting("template", "custom");
	writeMacroSections(["verse"]);
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
