import assert from "node:assert/strict";
import {
	GLOBAL_STORAGE_KEYS,
	readGlobalBool,
	readGlobalNumber,
	readGlobalSetting,
	writeGlobalSetting,
} from "../src/global-state";

console.log("● global-state tests");

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

// 2. 基本的な読み書きテスト
mockStorage.clear();
assert.equal(readGlobalSetting("masterVolume"), null, "初期状態は null");

writeGlobalSetting("masterVolume", "75");
assert.equal(
	mockStorage.getItem(GLOBAL_STORAGE_KEYS.masterVolume),
	"75",
	"localStorage に書き込まれていること",
);
assert.equal(
	readGlobalSetting("masterVolume"),
	"75",
	"正しく読み出せること",
);

// 3. 全項目のキーの読み書きテスト
const allKeys = Object.keys(GLOBAL_STORAGE_KEYS) as (keyof typeof GLOBAL_STORAGE_KEYS)[];
for (const key of allKeys) {
	mockStorage.clear();
	writeGlobalSetting(key, "test_val");
	assert.equal(readGlobalSetting(key), "test_val", `${key} の読み書き`);
}

// 4. 数値の読み出しとクランプのテスト
mockStorage.clear();
assert.equal(readGlobalNumber("masterVolume", 0, 100), null, "未設定時は null");

writeGlobalSetting("masterVolume", "50");
assert.equal(readGlobalNumber("masterVolume", 0, 100), 50, "範囲内はそのまま");

writeGlobalSetting("masterVolume", "150");
assert.equal(readGlobalNumber("masterVolume", 0, 100), 100, "上限を超えたらクランプ");

writeGlobalSetting("masterVolume", "-10");
assert.equal(readGlobalNumber("masterVolume", 0, 100), 0, "下限を下回ったらクランプ");

writeGlobalSetting("masterVolume", "not-a-number");
assert.equal(readGlobalNumber("masterVolume", 0, 100), null, "不正な値は null");

writeGlobalSetting("reverbDecay", "2.2");
assert.equal(readGlobalNumber("reverbDecay", 0.3, 4.0), 2.2, "小数も正確にパース");

// 5. 真偽値の読み出しテスト
mockStorage.clear();
assert.equal(readGlobalBool("loop"), null, "未設定時は null");

writeGlobalSetting("loop", "1");
assert.equal(readGlobalBool("loop"), true, "'1' は true");

writeGlobalSetting("loop", "0");
assert.equal(readGlobalBool("loop"), false, "'0' は false");

writeGlobalSetting("loop", "true");
assert.equal(readGlobalBool("loop"), true, "'true' は true");

writeGlobalSetting("loop", "false");
assert.equal(readGlobalBool("loop"), false, "'false' は false");

writeGlobalSetting("loop", "other");
assert.equal(readGlobalBool("loop"), null, "不正な値は null");

// 6. 例外安全性テスト（クオータ超過・プライベートブラウズ）
const throwingStorage = {
	getItem() {
		throw new Error("SecurityError: Access is denied");
	},
	setItem() {
		throw new Error("QuotaExceededError");
	},
};
(globalThis as any).localStorage = throwingStorage;

assert.equal(readGlobalSetting("masterVolume"), null, "例外時 null");
assert.equal(readGlobalNumber("masterVolume", 0, 100), null, "例外時 null");
assert.equal(readGlobalBool("loop"), null, "例外時 null");
assert.doesNotThrow(() => {
	writeGlobalSetting("masterVolume", "50");
}, "書き込み例外時でもクラッシュしないこと");

// 7. localStorage 未定義環境
(globalThis as any).localStorage = undefined;
assert.equal(readGlobalSetting("masterVolume"), null, "未定義時 null");
assert.equal(readGlobalNumber("masterVolume", 0, 100), null, "未定義時 null");
assert.equal(readGlobalBool("loop"), null, "未定義時 null");
assert.doesNotThrow(() => {
	writeGlobalSetting("masterVolume", "50");
}, "未定義時でもクラッシュしないこと");

console.log("✓ すべてのテストに合格しました！");
