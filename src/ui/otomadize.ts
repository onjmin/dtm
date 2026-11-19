/**
 * 「音MAD化」の音源選定・音域調整・ミックス計画（DOM 非依存）。
 *
 * 「おまかせマスタリング」の亜種として、トラックの役割・ノートの置き方（音域・音価・同時発音・
 * 密度）・現在設定されている GM 楽器を手掛かりに、淫ク☆（Inc）およびレ淫棒（Niji / Otenkiame）
 * の中から適切な音色を選び、音源の得意音域に合わせたオクターブ調整と音MAD向けの音量・EQ・
 * 音圧・定位を一括で計算する。
 */
import {
	GM_INSTRUMENT_NAMES,
	programOfInstrumentName,
} from "../audio/audio-config";
import { MAX_REVERB_DECAY_SEC, MIN_REVERB_DECAY_SEC } from "../audio/reverb";
import { UNITS_PER_SEMITONE } from "../audio/tuning";
import type { AutoRole, PresetSlot } from "../compose/advanced-layers";
import {
	AUTO_ROLE_STEPS_PER_BEAT,
	type AutoRoleStats,
	classifyTrackRole,
	computeAutoRoleStats,
	pickTopSingleVoice,
	roleOfSlot,
} from "./auto-role";

export type OtomadGenre = "auto" | "inmu" | "cookie" | "both";
export type OtomadSource = "all" | "modern" | "niji" | "inc";
export type OtomadCastPolicy = "balanced" | "classic" | "varied";

export type OtomadSubRole =
	| "lead_sustain"
	| "lead_pluck"
	| "sub_sustain"
	| "sub_pluck"
	| "bass_sustain"
	| "bass_punch"
	| "chord_pad"
	| "chord_stab"
	| "arp"
	| "sparkle";

export type GmTimbre =
	| "piano"
	| "bell"
	| "organ"
	| "guitar_clean"
	| "guitar_drive"
	| "bass"
	| "strings"
	| "pluck"
	| "choir"
	| "hit"
	| "brass"
	| "wind"
	| "synth_lead"
	| "pad"
	| "ethnic"
	| "perc"
	| "fx";

export type OtomadArticulation =
	| "synth"
	| "pad"
	| "pluck"
	| "short_hit"
	| "bass_loop"
	| "bass_punch"
	| "bell";

export type OtomadPresetEntry = {
	id: string;
	/** TrackState.trackFont に入る値（"Inc_sf2_file" / "Niji_<bank>_<prog>" / "Otenkiame_<bank>_<prog>"）。 */
	font: string;
	/** 淫ク☆（Inc_sf2_file）専用の GM プログラム番号（80..83）。レ淫棒は undefined。 */
	gmProgram?: number;
	label: string;
	source: "inc" | "niji" | "otenkiame";
	family: "inmu" | "cookie";
	character: string;
	iconic: boolean;
	articulation: OtomadArticulation;
	roles: readonly OtomadSubRole[];
	gmAffinities: readonly GmTimbre[];
	rootMidi: number;
	sweetMin: number;
	sweetMax: number;
	multisampled: boolean;
	looped: boolean;
	volumeOffset: number;
	brightnessTrim: number;
};

export type OtomadizeOptions = {
	genre: OtomadGenre;
	source: OtomadSource;
	castPolicy: OtomadCastPolicy;
	adjustOctave: boolean;
	adjustMix: boolean;
	useCurrentInstrument: boolean;
	activeOnly?: boolean;
	activeTrackId?: string;
	rng?: () => number;
};

export type OtomadizeTrackInput = {
	id: string;
	index: number;
	name: string;
	notes: readonly {
		pitchUnits: number;
		startStep: number;
		durationSteps: number;
	}[];
	declaredRole?: AutoRole;
	composeSlot?: PresetSlot | null;
	/** 解決済み GM 楽器名。currentFont が Inc_sf2_file のときは音源固有番号のためヒントに使わない。 */
	currentInstrument?: string;
	currentFont?: string;
	isVocal?: boolean;
};

export type OtomadizeTrackPlan = {
	trackId: string;
	trackIndex: number;
	trackName: string;
	role: AutoRole;
	subRole: OtomadSubRole;
	preset: OtomadPresetEntry;
	font: string;
	/** Inc_sf2_file を選んだときだけ設定。レ淫棒は undefined（元の GM 楽器名を保持）。 */
	gmInstrument?: string;
	/** -2〜+2 の整数オクターブ補正。 */
	octave: number;
	/** トラック音量（1〜127）。 */
	volume: number;
	pan: number;
	compression: number;
	width: number;
	eqLow: number;
	eqMid: number;
	eqHigh: number;
	reverbSend: number;
	delaySend: number;
};

export type OtomadizeMasterPlan = {
	masterCompression: number;
	reverbAmount: number;
	reverbDecay: number;
	reverbPreDelay: number;
	fadeOutMinSec: number;
};

export type OtomadizeResult = {
	tracks: OtomadizeTrackPlan[];
	master: OtomadizeMasterPlan;
};

export type TrackNoteProfile = {
	stats: AutoRoleStats;
	minMidi: number;
	maxMidi: number;
	medianMidi: number;
	p15Midi: number;
	p85Midi: number;
	shortNoteRatio: number;
	longNoteRatio: number;
	notesPerBar: number;
};

const STEPS_PER_BAR = AUTO_ROLE_STEPS_PER_BEAT * 4;

const clamp = (v: number, min: number, max: number): number =>
	Math.min(Math.max(v, min), max);

type PresetSpec = Omit<OtomadPresetEntry, "sweetMin" | "sweetMax"> & {
	sweetMin?: number;
	sweetMax?: number;
};

const makePreset = (spec: PresetSpec): OtomadPresetEntry => ({
	...spec,
	sweetMin: spec.sweetMin ?? Math.max(36, spec.rootMidi - 10),
	sweetMax: spec.sweetMax ?? Math.min(108, spec.rootMidi + 9),
});

type NijiRawDef = {
	bank: number;
	program: number;
	label: string;
	family: "inmu" | "cookie";
	character: string;
	iconic: boolean;
	articulation: OtomadArticulation;
	rootMidi: number;
	looped: boolean;
	roles?: readonly OtomadSubRole[];
	gmAffinities?: readonly GmTimbre[];
	sweetMin?: number;
	sweetMax?: number;
	volumeOffset?: number;
	brightnessTrim?: number;
};

const defaultRolesForArticulation = (
	art: OtomadArticulation,
	rootMidi: number,
): readonly OtomadSubRole[] => {
	switch (art) {
		case "bass_loop":
			return ["bass_sustain", "bass_punch"];
		case "bass_punch":
			return ["bass_punch", "bass_sustain"];
		case "bell":
			return ["sparkle", "arp", "sub_sustain"];
		case "pad":
			return ["chord_pad", "sub_sustain", "lead_sustain"];
		case "synth":
			return rootMidi >= 75
				? ["lead_sustain", "sub_sustain", "chord_stab", "sparkle"]
				: ["lead_sustain", "sub_sustain", "chord_stab"];
		case "pluck":
			return rootMidi >= 75
				? ["lead_pluck", "sub_pluck", "chord_stab", "arp", "sparkle"]
				: ["lead_pluck", "sub_pluck", "chord_stab", "arp"];
		case "short_hit":
			return rootMidi >= 75
				? ["arp", "sub_pluck", "chord_stab", "sparkle"]
				: ["arp", "sub_pluck", "chord_stab"];
	}
};

const defaultAffinitiesForArticulation = (
	art: OtomadArticulation,
): readonly GmTimbre[] => {
	switch (art) {
		case "bass_loop":
		case "bass_punch":
			return ["bass"];
		case "bell":
			return ["bell", "perc"];
		case "pad":
			return ["pad", "strings", "choir"];
		case "synth":
			return ["synth_lead", "organ", "wind", "brass"];
		case "pluck":
			return ["piano", "guitar_clean", "pluck", "ethnic"];
		case "short_hit":
			return ["perc", "pluck", "piano", "hit"];
	}
};

const NIJI_RAW: readonly NijiRawDef[] = [
	// --- 淫夢（バンク 0〜6, 31。31-1 セミ兄貴は除外） ---
	{
		bank: 0,
		program: 0,
		label: "野獣「オォン！_P」",
		family: "inmu",
		character: "yaju",
		iconic: true,
		articulation: "pluck",
		rootMidi: 67,
		looped: false,
		gmAffinities: ["piano", "guitar_clean", "pluck"],
	},
	{
		bank: 0,
		program: 1,
		label: "野獣「アォン！_P」",
		family: "inmu",
		character: "yaju",
		iconic: false,
		articulation: "pluck",
		rootMidi: 64,
		looped: false,
		volumeOffset: 2,
	},
	{
		bank: 0,
		program: 2,
		label: "野獣「ンアッー！_P」",
		family: "inmu",
		character: "yaju",
		iconic: true,
		articulation: "pluck",
		rootMidi: 68,
		looped: false,
		gmAffinities: ["piano", "pluck", "brass"],
	},
	{
		bank: 0,
		program: 3,
		label: "野獣「ンアッー！_S」",
		family: "inmu",
		character: "yaju",
		iconic: true,
		articulation: "pad",
		rootMidi: 67,
		looped: true,
		roles: ["chord_pad", "sub_sustain", "lead_sustain"],
		gmAffinities: ["pad", "strings", "choir"],
	},
	{
		bank: 0,
		program: 4,
		label: "野獣「ンアッー！_S2」",
		family: "inmu",
		character: "yaju",
		iconic: true,
		articulation: "synth",
		rootMidi: 68,
		looped: true,
		gmAffinities: ["synth_lead", "guitar_drive", "brass"],
	},
	{
		bank: 0,
		program: 5,
		label: "野獣「ファッ！？」",
		family: "inmu",
		character: "yaju",
		iconic: true,
		articulation: "short_hit",
		rootMidi: 65,
		looped: false,
		volumeOffset: 2,
		gmAffinities: ["hit", "perc", "pluck"],
	},
	{
		bank: 0,
		program: 6,
		label: "野獣「ぬわああ_S」",
		family: "inmu",
		character: "yaju",
		iconic: true,
		articulation: "pad",
		rootMidi: 63,
		looped: true,
		volumeOffset: 3,
	},
	{
		bank: 0,
		program: 7,
		label: "野獣「ヌッ！」",
		family: "inmu",
		character: "yaju",
		iconic: true,
		articulation: "short_hit",
		rootMidi: 62,
		looped: false,
		volumeOffset: 4,
	},
	{
		bank: 1,
		program: 0,
		label: "遠野「アン！」",
		family: "inmu",
		character: "ton",
		iconic: false,
		articulation: "pluck",
		rootMidi: 69,
		looped: false,
		volumeOffset: 4,
	},
	{
		bank: 1,
		program: 1,
		label: "遠野「アーン！」",
		family: "inmu",
		character: "ton",
		iconic: true,
		articulation: "pluck",
		rootMidi: 71,
		looped: false,
		volumeOffset: 2,
		gmAffinities: ["guitar_clean", "pluck", "piano"],
	},
	{
		bank: 1,
		program: 2,
		label: "遠野「アーン！_S」",
		family: "inmu",
		character: "ton",
		iconic: true,
		articulation: "pad",
		rootMidi: 71,
		looped: true,
	},
	{
		bank: 1,
		program: 3,
		label: "遠野「アーン！_S2」",
		family: "inmu",
		character: "ton",
		iconic: false,
		articulation: "pad",
		rootMidi: 71,
		looped: true,
	},
	{
		bank: 1,
		program: 4,
		label: "遠野「アーン！_S3」",
		family: "inmu",
		character: "ton",
		iconic: false,
		articulation: "synth",
		rootMidi: 71,
		looped: true,
		volumeOffset: -6,
	},
	{
		bank: 2,
		program: 0,
		label: "MUR「s「お」うだよ_B」",
		family: "inmu",
		character: "mur",
		iconic: true,
		articulation: "bass_loop",
		rootMidi: 41,
		looped: true,
		sweetMin: 28,
		sweetMax: 53,
		volumeOffset: -2,
	},
	{
		bank: 2,
		program: 1,
		label: "MUR「s「お」うだよ_B2」",
		family: "inmu",
		character: "mur",
		iconic: false,
		articulation: "bass_loop",
		rootMidi: 41,
		looped: true,
		sweetMin: 28,
		sweetMax: 53,
		volumeOffset: -2,
	},
	{
		bank: 2,
		program: 2,
		label: "MUR「s「お」うだよ_S」",
		family: "inmu",
		character: "mur",
		iconic: true,
		articulation: "pad",
		rootMidi: 53,
		looped: true,
		sweetMin: 43,
		sweetMax: 64,
		roles: ["chord_pad", "sub_sustain", "bass_sustain"],
	},
	{
		bank: 3,
		program: 0,
		label: "HTN「ウィ「ヒッ！」」",
		family: "inmu",
		character: "htn",
		iconic: false,
		articulation: "pluck",
		rootMidi: 71,
		looped: false,
		volumeOffset: 4,
	},
	{
		bank: 3,
		program: 1,
		label: "HTN「ア゜ッー_S」",
		family: "inmu",
		character: "htn",
		iconic: false,
		articulation: "pad",
		rootMidi: 65,
		looped: true,
	},
	{
		bank: 4,
		program: 0,
		label: "AOK「あああ！_S」",
		family: "inmu",
		character: "aok",
		iconic: true,
		articulation: "pad",
		rootMidi: 66,
		looped: true,
	},
	{
		bank: 5,
		program: 0,
		label: "ひで「あぅぅ！_S」",
		family: "inmu",
		character: "hide",
		iconic: true,
		articulation: "synth",
		rootMidi: 68,
		looped: true,
		volumeOffset: -4,
	},
	{
		bank: 6,
		program: 0,
		label: "TKGW「マ゜ッ！」",
		family: "inmu",
		character: "tkgw",
		iconic: false,
		articulation: "pluck",
		rootMidi: 76,
		looped: false,
		volumeOffset: 4,
	},
	{
		bank: 31,
		program: 0,
		label: "COATロゴ",
		family: "inmu",
		character: "inmu_misc",
		iconic: true,
		articulation: "bell",
		rootMidi: 102,
		looped: false,
		sweetMin: 82,
		sweetMax: 108,
		roles: ["sparkle"],
		gmAffinities: ["bell", "fx"],
		volumeOffset: 4,
		brightnessTrim: -2,
	},
	{
		bank: 31,
		program: 2,
		label: "ストラディバリ椅子_S",
		family: "inmu",
		character: "inmu_misc",
		iconic: true,
		articulation: "bell",
		rootMidi: 95,
		looped: true,
		sweetMin: 76,
		sweetMax: 104,
		roles: ["sparkle", "sub_sustain"],
		gmAffinities: ["bell", "strings", "synth_lead"],
		volumeOffset: -2,
		brightnessTrim: -2,
	},
	{
		bank: 31,
		program: 3,
		label: "ホモビーム",
		family: "inmu",
		character: "inmu_misc",
		iconic: true,
		articulation: "pad",
		rootMidi: 77,
		looped: true,
		sweetMin: 62,
		sweetMax: 88,
		roles: ["chord_pad", "sparkle", "sub_sustain"],
		gmAffinities: ["fx", "pad", "synth_lead"],
	},

	// --- クッキー☆（バンク 32〜115） ---
	{
		bank: 32,
		program: 0,
		label: "RU「ぷはー」",
		family: "cookie",
		character: "ru",
		iconic: true,
		articulation: "pluck",
		rootMidi: 68,
		looped: false,
	},
	{
		bank: 32,
		program: 1,
		label: "RU「いい「天」気_P」",
		family: "cookie",
		character: "ru",
		iconic: true,
		articulation: "pluck",
		rootMidi: 65,
		looped: false,
		gmAffinities: ["piano", "guitar_clean", "pluck"],
	},
	{
		bank: 32,
		program: 2,
		label: "RU「「クォ」ラ！_P」",
		family: "cookie",
		character: "ru",
		iconic: false,
		articulation: "short_hit",
		rootMidi: 68,
		looped: false,
	},
	{
		bank: 33,
		program: 0,
		label: "UDK「「バン」ホーテン_P」",
		family: "cookie",
		character: "udk",
		iconic: true,
		articulation: "pluck",
		rootMidi: 61,
		looped: false,
		gmAffinities: ["piano", "pluck", "guitar_clean"],
	},
	{
		bank: 33,
		program: 1,
		label: "UDK「バン「ホー」テン_S」",
		family: "cookie",
		character: "udk",
		iconic: true,
		articulation: "synth",
		rootMidi: 67,
		looped: true,
		volumeOffset: -4,
		gmAffinities: ["synth_lead", "organ", "wind"],
	},
	{
		bank: 33,
		program: 2,
		label: "UDK「あああ！_S」",
		family: "cookie",
		character: "udk",
		iconic: true,
		articulation: "synth",
		rootMidi: 75,
		looped: true,
		volumeOffset: -4,
		brightnessTrim: -1,
		gmAffinities: ["synth_lead", "guitar_drive", "brass"],
	},
	{
		bank: 33,
		program: 3,
		label: "UDK「あああ！_S2」",
		family: "cookie",
		character: "udk",
		iconic: false,
		articulation: "synth",
		rootMidi: 75,
		looped: true,
		volumeOffset: -7,
		brightnessTrim: -2,
	},
	{
		bank: 33,
		program: 4,
		label: "UDK「あああ！_S3」",
		family: "cookie",
		character: "udk",
		iconic: false,
		articulation: "pad",
		rootMidi: 75,
		looped: true,
	},
	{
		bank: 33,
		program: 5,
		label: "UDK「あああ！_S4」",
		family: "cookie",
		character: "udk",
		iconic: false,
		articulation: "synth",
		rootMidi: 75,
		looped: true,
		volumeOffset: -6,
		brightnessTrim: -2,
	},
	{
		bank: 33,
		program: 6,
		label: "UDK「あああ！_S5」",
		family: "cookie",
		character: "udk",
		iconic: false,
		articulation: "synth",
		rootMidi: 75,
		looped: true,
		volumeOffset: -4,
		brightnessTrim: -1,
	},
	{
		bank: 33,
		program: 7,
		label: "UDK「忘れてた「ー！」_S」",
		family: "cookie",
		character: "udk",
		iconic: true,
		articulation: "synth",
		rootMidi: 76,
		looped: true,
		volumeOffset: -6,
		brightnessTrim: -1,
	},
	{
		bank: 34,
		program: 0,
		label: "HNS「きゃっ！」",
		family: "cookie",
		character: "hns",
		iconic: true,
		articulation: "short_hit",
		rootMidi: 79,
		looped: false,
		gmAffinities: ["bell", "perc", "pluck"],
	},
	{
		bank: 34,
		program: 1,
		label: "HNS「もういっ「かー」い_S」",
		family: "cookie",
		character: "hns",
		iconic: true,
		articulation: "synth",
		rootMidi: 70,
		looped: true,
		volumeOffset: -4,
	},
	{
		bank: 34,
		program: 2,
		label: "HNS「もういっか「－」い_S」",
		family: "cookie",
		character: "hns",
		iconic: true,
		articulation: "pad",
		rootMidi: 69,
		looped: true,
	},
	{
		bank: 34,
		program: 3,
		label: "HNS「あっ！…_P」",
		family: "cookie",
		character: "hns",
		iconic: false,
		articulation: "short_hit",
		rootMidi: 73,
		looped: false,
	},
	{
		bank: 35,
		program: 0,
		label: "YMN「あっ…「まい！」」",
		family: "cookie",
		character: "ymn",
		iconic: true,
		articulation: "pluck",
		rootMidi: 75,
		looped: false,
		gmAffinities: ["piano", "bell", "pluck"],
	},
	{
		bank: 35,
		program: 1,
		label: "YMN「食べさせる「ー」_S」",
		family: "cookie",
		character: "ymn",
		iconic: true,
		articulation: "synth",
		rootMidi: 73,
		looped: true,
		volumeOffset: -4,
		brightnessTrim: -1,
		gmAffinities: ["synth_lead", "wind", "organ"],
	},
	{
		bank: 35,
		program: 2,
		label: "YMN「食べさせる「ー」_S2」",
		family: "cookie",
		character: "ymn",
		iconic: true,
		articulation: "pad",
		rootMidi: 73,
		looped: true,
	},
	{
		bank: 35,
		program: 3,
		label: "YMN「食べさせる「ー」_S3」",
		family: "cookie",
		character: "ymn",
		iconic: false,
		articulation: "pad",
		rootMidi: 73,
		looped: true,
	},
	{
		bank: 35,
		program: 4,
		label: "YMN「食べさせる「－」_B」",
		family: "cookie",
		character: "ymn",
		iconic: true,
		articulation: "bass_loop",
		rootMidi: 49,
		looped: true,
		sweetMin: 34,
		sweetMax: 56,
	},
	{
		bank: 35,
		program: 5,
		label: "YMN「「完」成」",
		family: "cookie",
		character: "ymn",
		iconic: false,
		articulation: "short_hit",
		rootMidi: 66,
		looped: false,
	},
	{
		bank: 35,
		program: 6,
		label: "YMN「扱っ「て！」」",
		family: "cookie",
		character: "ymn",
		iconic: false,
		articulation: "short_hit",
		rootMidi: 67,
		looped: false,
	},
	{
		bank: 36,
		program: 0,
		label: "NDK「「そー」なのかー_S」",
		family: "cookie",
		character: "ndk",
		iconic: true,
		articulation: "synth",
		rootMidi: 65,
		looped: true,
		volumeOffset: -4,
	},
	{
		bank: 36,
		program: 1,
		label: "NDK「そ「ー」なのかー_B」",
		family: "cookie",
		character: "ndk",
		iconic: true,
		articulation: "bass_loop",
		rootMidi: 41,
		looped: true,
		sweetMin: 28,
		sweetMax: 53,
	},
	{
		bank: 37,
		program: 0,
		label: "YZY「えい！_P」",
		family: "cookie",
		character: "yzy",
		iconic: false,
		articulation: "pluck",
		rootMidi: 72,
		looped: false,
	},
	{
		bank: 37,
		program: 1,
		label: "YZY「わっ！？」",
		family: "cookie",
		character: "yzy",
		iconic: false,
		articulation: "short_hit",
		rootMidi: 75,
		looped: false,
	},
	{
		bank: 38,
		program: 0,
		label: "YKMR「おは「よ」う_S」",
		family: "cookie",
		character: "ykmr",
		iconic: false,
		articulation: "synth",
		rootMidi: 69,
		looped: true,
		volumeOffset: -3,
	},
	{
		bank: 40,
		program: 0,
		label: "BNKRG「「だ」って」",
		family: "cookie",
		character: "bnkrg",
		iconic: false,
		articulation: "short_hit",
		rootMidi: 72,
		looped: false,
	},
	{
		bank: 40,
		program: 1,
		label: "BNKRG「んーっ「と」_S」",
		family: "cookie",
		character: "bnkrg",
		iconic: false,
		articulation: "synth",
		rootMidi: 71,
		looped: true,
		volumeOffset: -5,
	},
	{
		bank: 41,
		program: 0,
		label: "MZ「「ちょ」っとまった！_P」",
		family: "cookie",
		character: "mz",
		iconic: false,
		articulation: "short_hit",
		rootMidi: 68,
		looped: false,
	},
	{
		bank: 41,
		program: 1,
		label: "MZ「いら「ねー」_S」",
		family: "cookie",
		character: "mz",
		iconic: false,
		articulation: "synth",
		rootMidi: 66,
		looped: true,
		volumeOffset: -4,
		gmAffinities: ["synth_lead", "guitar_drive", "brass"],
	},
	{
		bank: 47,
		program: 0,
		label: "海綿体「クリス「マ」ス_S」",
		family: "cookie",
		character: "kaimentai",
		iconic: false,
		articulation: "synth",
		rootMidi: 60,
		looped: true,
	},
	{
		bank: 47,
		program: 1,
		label: "海綿体「クリスm「ア」ス_B」",
		family: "cookie",
		character: "kaimentai",
		iconic: false,
		articulation: "bass_loop",
		rootMidi: 48,
		looped: true,
		sweetMin: 34,
		sweetMax: 56,
	},
	{
		bank: 48,
		program: 0,
		label: "KNN「「あ＾～」生き返るわ～_S」",
		family: "cookie",
		character: "knn",
		iconic: true,
		articulation: "pad",
		rootMidi: 72,
		looped: true,
	},
	{
		bank: 48,
		program: 1,
		label: "KNN「「あ＾～」生き返るわ～_S2」",
		family: "cookie",
		character: "knn",
		iconic: true,
		articulation: "synth",
		rootMidi: 72,
		looped: true,
		volumeOffset: -5,
	},
	{
		bank: 49,
		program: 0,
		label: "AZS「あー_S」",
		family: "cookie",
		character: "azs",
		iconic: false,
		articulation: "pad",
		rootMidi: 61,
		looped: true,
	},
	{
		bank: 49,
		program: 1,
		label: "AZS「「そー」だなー_B」",
		family: "cookie",
		character: "azs",
		iconic: false,
		articulation: "bass_loop",
		rootMidi: 46,
		looped: true,
		sweetMin: 33,
		sweetMax: 55,
	},
	{
		bank: 56,
		program: 0,
		label: "RI「ひつじ」",
		family: "cookie",
		character: "ri",
		iconic: true,
		articulation: "synth",
		rootMidi: 66,
		looped: true,
	},
	{
		bank: 64,
		program: 0,
		label: "JOKER「「あ」とは_S」",
		family: "cookie",
		character: "joker",
		iconic: false,
		articulation: "synth",
		rootMidi: 59,
		looped: true,
	},
	{
		bank: 72,
		program: 0,
		label: "NYN「いらっしゃいま「せー」_S」",
		family: "cookie",
		character: "nyn",
		iconic: true,
		articulation: "synth",
		rootMidi: 55,
		looped: true,
		sweetMin: 46,
		sweetMax: 65,
	},
	{
		bank: 72,
		program: 1,
		label: "NYN「「な」いです_S」",
		family: "cookie",
		character: "nyn",
		iconic: true,
		articulation: "synth",
		rootMidi: 60,
		looped: true,
		sweetMin: 50,
		sweetMax: 70,
	},
	{
		bank: 72,
		program: 2,
		label: "NYN「バレン「タイン」_P」",
		family: "cookie",
		character: "nyn",
		iconic: false,
		articulation: "pluck",
		rootMidi: 64,
		looped: false,
	},
	{
		bank: 72,
		program: 3,
		label: "NYN「まいどあり「－」_B」",
		family: "cookie",
		character: "nyn",
		iconic: true,
		articulation: "bass_loop",
		rootMidi: 39,
		looped: true,
		sweetMin: 28,
		sweetMax: 52,
		volumeOffset: -6,
		brightnessTrim: -1,
	},
	{
		bank: 72,
		program: 4,
		label: "NYN「NYN_P」",
		family: "cookie",
		character: "nyn",
		iconic: true,
		articulation: "pluck",
		rootMidi: 58,
		looped: false,
		gmAffinities: ["piano", "pluck", "guitar_clean"],
	},
	{
		bank: 73,
		program: 0,
		label: "ICG「えっと「ー」_S」",
		family: "cookie",
		character: "icg",
		iconic: true,
		articulation: "pad",
		rootMidi: 61,
		looped: true,
	},
	{
		bank: 73,
		program: 1,
		label: "ICG「えっ「とー」_S」",
		family: "cookie",
		character: "icg",
		iconic: true,
		articulation: "synth",
		rootMidi: 61,
		looped: true,
		volumeOffset: -5,
	},
	{
		bank: 74,
		program: 0,
		label: "RRM「バレン「タイン」_P」",
		family: "cookie",
		character: "rrm",
		iconic: true,
		articulation: "pluck",
		rootMidi: 68,
		looped: false,
	},
	{
		bank: 74,
		program: 1,
		label: "RRM「「こ」んなもの！_S」",
		family: "cookie",
		character: "rrm",
		iconic: true,
		articulation: "synth",
		rootMidi: 77,
		looped: true,
		brightnessTrim: -1,
	},
	{
		bank: 74,
		program: 2,
		label: "RRM「こん「な」もの！_S」",
		family: "cookie",
		character: "rrm",
		iconic: false,
		articulation: "synth",
		rootMidi: 77,
		looped: true,
		brightnessTrim: -1,
	},
	{
		bank: 74,
		program: 3,
		label: "RRM「うぅ…_P」",
		family: "cookie",
		character: "rrm",
		iconic: false,
		articulation: "pluck",
		rootMidi: 75,
		looped: false,
	},
	{
		bank: 75,
		program: 0,
		label: "SZ「フ「フ」フフ」",
		family: "cookie",
		character: "sz",
		iconic: true,
		articulation: "short_hit",
		rootMidi: 67,
		looped: false,
	},
	{
		bank: 75,
		program: 1,
		label: "SZ「フフ「フ」フ」",
		family: "cookie",
		character: "sz",
		iconic: false,
		articulation: "short_hit",
		rootMidi: 72,
		looped: false,
	},
	{
		bank: 75,
		program: 2,
		label: "SZ「フフフ「フ」」",
		family: "cookie",
		character: "sz",
		iconic: false,
		articulation: "short_hit",
		rootMidi: 76,
		looped: false,
		gmAffinities: ["bell", "perc", "pluck"],
	},
	{
		bank: 88,
		program: 0,
		label: "SRMY「おー_S」",
		family: "cookie",
		character: "srmy",
		iconic: false,
		articulation: "pad",
		rootMidi: 60,
		looped: true,
	},
	{
		bank: 96,
		program: 0,
		label: "CL「じぇんとる「め！」」",
		family: "cookie",
		character: "cl",
		iconic: false,
		articulation: "pluck",
		rootMidi: 72,
		looped: false,
	},
	{
		bank: 97,
		program: 0,
		label: "NBR「し「まー」す_S」",
		family: "cookie",
		character: "nbr",
		iconic: false,
		articulation: "pad",
		rootMidi: 66,
		looped: true,
	},
	{
		bank: 98,
		program: 0,
		label: "MIMI「「そ」こで」",
		family: "cookie",
		character: "mimi",
		iconic: false,
		articulation: "short_hit",
		rootMidi: 62,
		looped: false,
	},
	{
		bank: 98,
		program: 1,
		label: "MIMI「そ「こ」で」",
		family: "cookie",
		character: "mimi",
		iconic: false,
		articulation: "pluck",
		rootMidi: 60,
		looped: false,
	},
	{
		bank: 98,
		program: 2,
		label: "MIMI「そこ「で」」",
		family: "cookie",
		character: "mimi",
		iconic: false,
		articulation: "pluck",
		rootMidi: 66,
		looped: false,
	},
	{
		bank: 98,
		program: 3,
		label: "MIMI「ぬえ「ちゃん」」",
		family: "cookie",
		character: "mimi",
		iconic: false,
		articulation: "short_hit",
		rootMidi: 66,
		looped: false,
	},
	{
		bank: 104,
		program: 0,
		label: "Web「But_P」",
		family: "cookie",
		character: "web",
		iconic: false,
		articulation: "pluck",
		rootMidi: 72,
		looped: false,
	},
	{
		bank: 104,
		program: 1,
		label: "Web「One」",
		family: "cookie",
		character: "web",
		iconic: false,
		articulation: "pluck",
		rootMidi: 66,
		looped: false,
		volumeOffset: 3,
	},
	{
		bank: 105,
		program: 0,
		label: "Kofji「Hmm_S」",
		family: "cookie",
		character: "kofji",
		iconic: false,
		articulation: "synth",
		rootMidi: 59,
		looped: true,
	},
	{
		bank: 105,
		program: 1,
		label: "Kofji「Hmm_B」",
		family: "cookie",
		character: "kofji",
		iconic: false,
		articulation: "bass_loop",
		rootMidi: 47,
		looped: true,
		sweetMin: 34,
		sweetMax: 56,
	},
	{
		bank: 105,
		program: 2,
		label: "Kofji「Sure_P」",
		family: "cookie",
		character: "kofji",
		iconic: false,
		articulation: "pluck",
		rootMidi: 58,
		looped: false,
	},
	{
		bank: 113,
		program: 0,
		label: "KN「「こ」↑こ↓」",
		family: "cookie",
		character: "kn",
		iconic: false,
		articulation: "short_hit",
		rootMidi: 60,
		looped: false,
	},
	{
		bank: 113,
		program: 1,
		label: "KN「ぽい」",
		family: "cookie",
		character: "kn",
		iconic: false,
		articulation: "short_hit",
		rootMidi: 67,
		looped: false,
	},
	{
		bank: 114,
		program: 0,
		label: "BBAN「「あ＾～」生き返るわ～_S」",
		family: "cookie",
		character: "bban",
		iconic: false,
		articulation: "pad",
		rootMidi: 72,
		looped: true,
	},
	{
		bank: 115,
		program: 0,
		label: "偽NYN「いらっしゃいま「せー」_S」",
		family: "cookie",
		character: "fnyn",
		iconic: false,
		articulation: "synth",
		rootMidi: 55,
		looped: true,
	},
];

/**
 * 淫ク☆・レ淫棒（お天気雨 2020 / 虹.）の音色カタログ。
 * 効果音・セミ兄貴・レスリング・キレテナーイ・PCM 重複変種は除いている。
 */
export const OTOMAD_PRESETS: readonly OtomadPresetEntry[] = [
	// --- 淫ク☆（Inc_sf2_file、17ゾーンマルチサンプル） ---
	makePreset({
		id: "Inc:80",
		font: "Inc_sf2_file",
		gmProgram: 80,
		label: "淫ク☆ / YMN「るぅ＾～」",
		source: "inc",
		family: "cookie",
		character: "ymn",
		iconic: true,
		articulation: "synth",
		roles: ["lead_sustain", "sub_sustain", "chord_pad", "arp", "sparkle"],
		gmAffinities: ["synth_lead", "wind", "bell", "organ", "pad"],
		rootMidi: 72,
		sweetMin: 52,
		sweetMax: 84,
		multisampled: true,
		looped: true,
		volumeOffset: 2,
		brightnessTrim: 0,
	}),
	makePreset({
		id: "Inc:81",
		font: "Inc_sf2_file",
		gmProgram: 81,
		label: "淫ク☆ / UDK「あーっ」",
		source: "inc",
		family: "cookie",
		character: "udk",
		iconic: true,
		articulation: "pad",
		roles: ["chord_pad", "sub_sustain", "lead_sustain", "bass_sustain"],
		gmAffinities: ["pad", "strings", "choir", "synth_lead", "piano"],
		rootMidi: 58,
		sweetMin: 36,
		sweetMax: 79,
		multisampled: true,
		looped: true,
		volumeOffset: 1,
		brightnessTrim: 0,
	}),
	makePreset({
		id: "Inc:82",
		font: "Inc_sf2_file",
		gmProgram: 82,
		label: "淫ク☆ / 野獣シンセ",
		source: "inc",
		family: "inmu",
		character: "yaju",
		iconic: true,
		articulation: "synth",
		roles: [
			"lead_sustain",
			"sub_sustain",
			"chord_pad",
			"chord_stab",
			"sparkle",
		],
		gmAffinities: ["synth_lead", "guitar_drive", "brass", "organ"],
		rootMidi: 67,
		sweetMin: 50,
		sweetMax: 82,
		multisampled: true,
		looped: true,
		volumeOffset: 2,
		brightnessTrim: 0,
	}),
	makePreset({
		id: "Inc:83",
		font: "Inc_sf2_file",
		gmProgram: 83,
		label: "淫ク☆ / MUR「ゾ～」",
		source: "inc",
		family: "inmu",
		character: "mur",
		iconic: true,
		articulation: "bass_loop",
		roles: ["bass_sustain", "bass_punch", "chord_pad", "sub_sustain"],
		gmAffinities: ["bass", "pad", "strings", "brass"],
		rootMidi: 49,
		sweetMin: 33,
		sweetMax: 68,
		multisampled: true,
		looped: true,
		volumeOffset: 1,
		brightnessTrim: 0,
	}),

	// --- レ淫棒2020 お天気雨版（重複 PCM 変種を除く） ---
	makePreset({
		id: "Otenkiame_0_3",
		font: "Otenkiame_0_3",
		label: "レ淫棒2020 / 野獣の咆哮 Syn1St",
		source: "otenkiame",
		family: "inmu",
		character: "yaju",
		iconic: true,
		articulation: "synth",
		roles: ["lead_sustain", "sub_sustain", "chord_stab"],
		gmAffinities: ["synth_lead", "guitar_drive", "brass"],
		rootMidi: 67,
		sweetMin: 57,
		sweetMax: 77,
		multisampled: false,
		looped: true,
		volumeOffset: -2,
		brightnessTrim: 0,
	}),
	makePreset({
		id: "Otenkiame_0_0",
		font: "Otenkiame_0_0",
		label: "レ淫棒2020 / 野獣の咆哮",
		source: "otenkiame",
		family: "inmu",
		character: "yaju",
		iconic: true,
		articulation: "pluck",
		roles: ["lead_pluck", "chord_stab", "sub_pluck"],
		gmAffinities: ["guitar_drive", "brass", "hit", "piano"],
		rootMidi: 67,
		sweetMin: 57,
		sweetMax: 76,
		multisampled: false,
		looped: false,
		volumeOffset: 4,
		brightnessTrim: 0,
	}),
	makePreset({
		id: "Otenkiame_0_12",
		font: "Otenkiame_0_12",
		label: "レ淫棒2020 / ダブリング咆哮",
		source: "otenkiame",
		family: "inmu",
		character: "yaju",
		iconic: false,
		articulation: "pluck",
		roles: ["chord_stab", "lead_pluck", "sub_pluck"],
		gmAffinities: ["guitar_drive", "brass", "hit"],
		rootMidi: 67,
		sweetMin: 57,
		sweetMax: 76,
		multisampled: false,
		looped: false,
		volumeOffset: 3,
		brightnessTrim: 0,
	}),
	makePreset({
		id: "Otenkiame_0_16",
		font: "Otenkiame_0_16",
		label: "レ淫棒2020 / 野獣「オォン！」",
		source: "otenkiame",
		family: "inmu",
		character: "yaju",
		iconic: true,
		articulation: "pluck",
		roles: ["lead_pluck", "chord_stab", "arp"],
		gmAffinities: ["piano", "pluck", "guitar_clean"],
		rootMidi: 65,
		sweetMin: 55,
		sweetMax: 74,
		multisampled: false,
		looped: false,
		volumeOffset: 5,
		brightnessTrim: 0,
	}),
	makePreset({
		id: "Otenkiame_0_20",
		font: "Otenkiame_0_20",
		label: "レ淫棒2020 / 野獣「こ↑こ↓」",
		source: "otenkiame",
		family: "inmu",
		character: "yaju",
		iconic: true,
		articulation: "short_hit",
		roles: ["arp", "sub_pluck", "chord_stab"],
		gmAffinities: ["perc", "pluck", "hit"],
		rootMidi: 57,
		sweetMin: 48,
		sweetMax: 69,
		multisampled: false,
		looped: false,
		volumeOffset: 8,
		brightnessTrim: 0,
	}),
	makePreset({
		id: "Otenkiame_0_32",
		font: "Otenkiame_0_32",
		label: "レ淫棒2020 / 世界の遠野",
		source: "otenkiame",
		family: "inmu",
		character: "ton",
		iconic: true,
		articulation: "pluck",
		roles: ["lead_pluck", "sub_pluck", "chord_stab"],
		gmAffinities: ["guitar_clean", "piano", "pluck", "ethnic"],
		rootMidi: 71,
		sweetMin: 61,
		sweetMax: 80,
		multisampled: false,
		looped: false,
		volumeOffset: 4,
		brightnessTrim: 0,
	}),
	makePreset({
		id: "Otenkiame_0_34",
		font: "Otenkiame_0_34",
		label: "レ淫棒2020 / 宇宙の遠野",
		source: "otenkiame",
		family: "inmu",
		character: "ton",
		iconic: true,
		articulation: "pad",
		roles: ["chord_pad", "sub_sustain", "lead_sustain"],
		gmAffinities: ["pad", "strings", "choir"],
		rootMidi: 71,
		sweetMin: 59,
		sweetMax: 80,
		multisampled: false,
		looped: true,
		volumeOffset: 0,
		brightnessTrim: 0,
	}),
	makePreset({
		id: "Otenkiame_0_64",
		font: "Otenkiame_0_64",
		label: "レ淫棒2020 / MUR 便乗ベース",
		source: "otenkiame",
		family: "inmu",
		character: "mur",
		iconic: true,
		articulation: "bass_punch",
		roles: ["bass_punch", "bass_sustain"],
		gmAffinities: ["bass"],
		rootMidi: 53,
		sweetMin: 34,
		sweetMax: 56,
		multisampled: false,
		looped: false,
		volumeOffset: 6,
		brightnessTrim: 0,
	}),
	makePreset({
		id: "Otenkiame_8_0",
		font: "Otenkiame_8_0",
		label: "レ淫棒2020 / TDN「ワン！」",
		source: "otenkiame",
		family: "inmu",
		character: "tdn",
		iconic: true,
		articulation: "pluck",
		roles: ["sub_pluck", "chord_stab", "bass_punch"],
		gmAffinities: ["pluck", "bass", "hit"],
		rootMidi: 51,
		sweetMin: 42,
		sweetMax: 62,
		multisampled: false,
		looped: false,
		volumeOffset: 6,
		brightnessTrim: 0,
	}),
	makePreset({
		id: "Otenkiame_8_4",
		font: "Otenkiame_8_4",
		label: "レ淫棒2020 / TDNシンセ",
		source: "otenkiame",
		family: "inmu",
		character: "tdn",
		iconic: true,
		articulation: "synth",
		roles: ["lead_sustain", "sub_sustain", "chord_stab", "arp"],
		gmAffinities: ["synth_lead", "ethnic", "guitar_clean"],
		rootMidi: 56,
		sweetMin: 46,
		sweetMax: 68,
		multisampled: false,
		looped: true,
		volumeOffset: -4,
		brightnessTrim: -1,
	}),
	makePreset({
		id: "Otenkiame_16_0",
		font: "Otenkiame_16_0",
		label: "レ淫棒2020 / ゆうさく ビンビンベース",
		source: "otenkiame",
		family: "inmu",
		character: "yusaku",
		iconic: true,
		articulation: "bass_punch",
		roles: ["bass_punch"],
		gmAffinities: ["bass"],
		rootMidi: 48,
		sweetMin: 34,
		sweetMax: 55,
		multisampled: false,
		looped: false,
		volumeOffset: 8,
		brightnessTrim: 0,
	}),
	makePreset({
		id: "Otenkiame_64_0",
		font: "Otenkiame_64_0",
		label: "レ淫棒2020 / RU「ぷはー」",
		source: "otenkiame",
		family: "cookie",
		character: "ru",
		iconic: true,
		articulation: "pluck",
		roles: ["lead_pluck", "sub_pluck", "chord_stab"],
		gmAffinities: ["guitar_clean", "pluck", "wind"],
		rootMidi: 68,
		sweetMin: 58,
		sweetMax: 77,
		multisampled: false,
		looped: false,
		volumeOffset: 5,
		brightnessTrim: 0,
	}),
	makePreset({
		id: "Otenkiame_64_1",
		font: "Otenkiame_64_1",
		label: "レ淫棒2020 / RU ぷはーベル",
		source: "otenkiame",
		family: "cookie",
		character: "ru",
		iconic: true,
		articulation: "bell",
		roles: ["sparkle", "arp", "sub_sustain"],
		gmAffinities: ["bell", "piano", "perc"],
		rootMidi: 68,
		sweetMin: 60,
		sweetMax: 82,
		multisampled: false,
		looped: true,
		volumeOffset: -2,
		brightnessTrim: -1,
	}),
	makePreset({
		id: "Otenkiame_64_4",
		font: "Otenkiame_64_4",
		label: "レ淫棒2020 / RU「てん気」",
		source: "otenkiame",
		family: "cookie",
		character: "ru",
		iconic: true,
		articulation: "pluck",
		roles: ["arp", "chord_stab", "lead_pluck"],
		gmAffinities: ["piano", "pluck"],
		rootMidi: 65,
		sweetMin: 55,
		sweetMax: 74,
		multisampled: false,
		looped: false,
		volumeOffset: 5,
		brightnessTrim: 0,
	}),
	makePreset({
		id: "Otenkiame_64_5",
		font: "Otenkiame_64_5",
		label: "レ淫棒2020 / RU てん気ピアノ",
		source: "otenkiame",
		family: "cookie",
		character: "ru",
		iconic: true,
		articulation: "pluck",
		roles: ["chord_stab", "lead_pluck", "arp"],
		gmAffinities: ["piano", "organ"],
		rootMidi: 65,
		sweetMin: 55,
		sweetMax: 76,
		multisampled: false,
		looped: true,
		volumeOffset: 3,
		brightnessTrim: 0,
	}),
	makePreset({
		id: "Otenkiame_64_32",
		font: "Otenkiame_64_32",
		label: "レ淫棒2020 / UDKシンセA Syn1",
		source: "otenkiame",
		family: "cookie",
		character: "udk",
		iconic: true,
		articulation: "synth",
		roles: ["lead_sustain", "sub_sustain", "chord_stab"],
		gmAffinities: ["synth_lead", "guitar_drive", "brass", "organ"],
		rootMidi: 75,
		sweetMin: 63,
		sweetMax: 84,
		multisampled: false,
		looped: true,
		volumeOffset: -4,
		brightnessTrim: -1,
	}),
	makePreset({
		id: "Otenkiame_64_33",
		font: "Otenkiame_64_33",
		label: "レ淫棒2020 / UDKシンセA Syn2",
		source: "otenkiame",
		family: "cookie",
		character: "udk",
		iconic: true,
		articulation: "synth",
		roles: ["lead_sustain", "arp", "sub_sustain"],
		gmAffinities: ["synth_lead", "organ"],
		rootMidi: 75,
		sweetMin: 63,
		sweetMax: 84,
		multisampled: false,
		looped: true,
		volumeOffset: -4,
		brightnessTrim: -1,
	}),
	makePreset({
		id: "Otenkiame_64_40",
		font: "Otenkiame_64_40",
		label: "レ淫棒2020 / UDKシンセB",
		source: "otenkiame",
		family: "cookie",
		character: "udk",
		iconic: true,
		articulation: "pluck",
		roles: ["lead_pluck", "sub_pluck", "chord_stab"],
		gmAffinities: ["wind", "pluck", "guitar_clean"],
		rootMidi: 76,
		sweetMin: 64,
		sweetMax: 84,
		multisampled: false,
		looped: false,
		volumeOffset: 2,
		brightnessTrim: 0,
	}),
	makePreset({
		id: "Otenkiame_64_44",
		font: "Otenkiame_64_44",
		label: "レ淫棒2020 / UDK VANホーテン",
		source: "otenkiame",
		family: "cookie",
		character: "udk",
		iconic: true,
		articulation: "pluck",
		roles: ["chord_stab", "arp", "lead_pluck", "sub_pluck"],
		gmAffinities: ["piano", "pluck", "guitar_clean"],
		rootMidi: 64,
		sweetMin: 54,
		sweetMax: 74,
		multisampled: false,
		looped: false,
		volumeOffset: 5,
		brightnessTrim: 0,
	}),
	makePreset({
		id: "Otenkiame_64_64",
		font: "Otenkiame_64_64",
		label: "レ淫棒2020 / SIKシンセ",
		source: "otenkiame",
		family: "cookie",
		character: "ymn",
		iconic: true,
		articulation: "synth",
		roles: ["lead_sustain", "sub_sustain", "chord_pad"],
		gmAffinities: ["synth_lead", "wind", "pad"],
		rootMidi: 73,
		sweetMin: 61,
		sweetMax: 83,
		multisampled: false,
		looped: true,
		volumeOffset: -4,
		brightnessTrim: -1,
	}),
	makePreset({
		id: "Otenkiame_64_72",
		font: "Otenkiame_64_72",
		label: "レ淫棒2020 / SIK「あっ！」",
		source: "otenkiame",
		family: "cookie",
		character: "ymn",
		iconic: true,
		articulation: "short_hit",
		roles: ["arp", "sub_pluck", "sparkle"],
		gmAffinities: ["perc", "pluck", "bell"],
		rootMidi: 75,
		sweetMin: 65,
		sweetMax: 84,
		multisampled: false,
		looped: false,
		volumeOffset: 7,
		brightnessTrim: 0,
	}),
	makePreset({
		id: "Otenkiame_64_74",
		font: "Otenkiame_64_74",
		label: "レ淫棒2020 / SIK「まい！ Pt」",
		source: "otenkiame",
		family: "cookie",
		character: "ymn",
		iconic: true,
		articulation: "pluck",
		roles: ["lead_pluck", "sub_pluck", "chord_stab"],
		gmAffinities: ["guitar_clean", "pluck", "ethnic"],
		rootMidi: 74,
		sweetMin: 64,
		sweetMax: 83,
		multisampled: false,
		looped: false,
		volumeOffset: 5,
		brightnessTrim: 0,
	}),
	makePreset({
		id: "Otenkiame_64_96",
		font: "Otenkiame_64_96",
		label: "レ淫棒2020 / ALC 大外刈り",
		source: "otenkiame",
		family: "cookie",
		character: "alc",
		iconic: true,
		articulation: "short_hit",
		roles: ["sparkle", "arp", "sub_pluck"],
		gmAffinities: ["bell", "perc", "fx"],
		rootMidi: 79,
		sweetMin: 68,
		sweetMax: 88,
		multisampled: false,
		looped: false,
		volumeOffset: 6,
		brightnessTrim: -1,
	}),

	// --- レ淫棒（虹. 20171022） ---
	...NIJI_RAW.map((r) =>
		makePreset({
			id: `Niji_${r.bank}_${r.program}`,
			font: `Niji_${r.bank}_${r.program}`,
			label: `レ淫棒 / ${r.label}`,
			source: "niji",
			family: r.family,
			character: r.character,
			iconic: r.iconic,
			articulation: r.articulation,
			roles: r.roles ?? defaultRolesForArticulation(r.articulation, r.rootMidi),
			gmAffinities:
				r.gmAffinities ?? defaultAffinitiesForArticulation(r.articulation),
			rootMidi: r.rootMidi,
			sweetMin: r.sweetMin,
			sweetMax: r.sweetMax,
			multisampled: false,
			looped: r.looped,
			volumeOffset: r.volumeOffset ?? 0,
			brightnessTrim: r.brightnessTrim ?? 0,
		}),
	),
];

/** GM プログラム番号（0-127）を音MADの音源選別で使う音色族へ畳む。 */
export const gmProgramToTimbre = (program: number | null): GmTimbre | null => {
	if (program === null || program < 0 || program > 127) return null;
	if (program <= 7) return "piano";
	if (program <= 15) return "bell";
	if (program <= 23) return "organ";
	if (program <= 28 || program === 31) return "guitar_clean";
	if (program <= 30) return "guitar_drive";
	if (program <= 39) return "bass";
	if (program <= 44 || program === 48 || program === 49) return "strings";
	if (program <= 47) return "pluck";
	if (program <= 51) return "pad";
	if (program <= 54) return "choir";
	if (program === 55) return "hit";
	if (program <= 63) return "brass";
	if (program <= 79) return "wind";
	if (program <= 87) return "synth_lead";
	if (program <= 95) return "pad";
	if (program <= 103) return "fx";
	if (program <= 111) return "ethnic";
	if (program <= 119) return "perc";
	return "fx";
};

/** ノート列から音域分布・音価・密度を測る。空のときは呼び出し側で弾く。 */
export const computeTrackNoteProfile = (
	notes: readonly {
		pitchUnits: number;
		startStep: number;
		durationSteps: number;
	}[],
): TrackNoteProfile => {
	const stats = computeAutoRoleStats(notes);
	const sorted = notes
		.map((n) => n.pitchUnits / UNITS_PER_SEMITONE)
		.sort((a, b) => a - b);
	const quantile = (q: number): number => {
		const idx = clamp(
			Math.floor((sorted.length - 1) * q),
			0,
			sorted.length - 1,
		);
		return sorted[idx];
	};
	let shortCount = 0;
	let longCount = 0;
	const activeBars = new Set<number>();
	for (const n of notes) {
		if (n.durationSteps <= 18) shortCount++;
		if (n.durationSteps >= 72) longCount++;
		activeBars.add(Math.floor(n.startStep / STEPS_PER_BAR));
	}
	return {
		stats,
		minMidi: sorted[0],
		maxMidi: sorted[sorted.length - 1],
		medianMidi: quantile(0.5),
		p15Midi: quantile(0.15),
		p85Midi: quantile(0.85),
		shortNoteRatio: shortCount / notes.length,
		longNoteRatio: longCount / notes.length,
		notesPerBar: notes.length / Math.max(1, activeBars.size),
	};
};

/** 役割とノートの置き方・元の GM 楽器から細かい役柄を決める。 */
export const classifyOtomadSubRole = (
	role: AutoRole,
	composeSlot: PresetSlot | null | undefined,
	profile: TrackNoteProfile,
	gmTimbre: GmTimbre | null,
	gmProgram: number | null,
): OtomadSubRole => {
	const { stats, shortNoteRatio, longNoteRatio, medianMidi, notesPerBar } =
		profile;
	if (role === "bass") {
		if (
			shortNoteRatio >= 0.6 &&
			stats.avgDur <= 30 &&
			notesPerBar >= 6 &&
			(gmProgram === null ||
				gmProgram === 34 ||
				gmProgram === 36 ||
				gmProgram === 37 ||
				gmProgram === 39)
		) {
			return "bass_punch";
		}
		return shortNoteRatio >= 0.7 && stats.avgDur <= 24
			? "bass_punch"
			: "bass_sustain";
	}
	if (composeSlot === "sparkle") return "sparkle";
	if (
		role === "chord" &&
		stats.maxPoly === 1 &&
		medianMidi >= 74 &&
		(gmTimbre === "bell" || notesPerBar <= 6)
	) {
		return "sparkle";
	}
	if (role === "melody") {
		const pluckGm =
			gmTimbre === "piano" || gmTimbre === "pluck" || gmTimbre === "ethnic";
		if (shortNoteRatio >= 0.72 && stats.avgDur <= 22 && longNoteRatio < 0.1) {
			return "lead_pluck";
		}
		if (pluckGm && stats.avgDur < 36) return "lead_pluck";
		return "lead_sustain";
	}
	if (role === "submelody") {
		if (
			medianMidi >= 76 &&
			gmTimbre === "bell" &&
			(composeSlot === "chorusLead" || notesPerBar <= 6)
		) {
			return "sparkle";
		}
		const pluckGm =
			gmTimbre === "piano" || gmTimbre === "pluck" || gmTimbre === "bell";
		if (shortNoteRatio >= 0.65 && stats.avgDur <= 24) return "sub_pluck";
		if (pluckGm && stats.avgDur < 36) return "sub_pluck";
		return "sub_sustain";
	}
	// role === "chord"
	if (stats.maxPoly === 1 && stats.avgDur < 40) return "arp";
	if (
		stats.polyOnsetRatio >= 0.5 &&
		stats.avgDur <= 36 &&
		shortNoteRatio >= 0.5
	) {
		return "chord_stab";
	}
	return "chord_pad";
};

/** 役割ごとの音楽的な適正音域 `[最低端, 最高端, 中央下限, 中央上限]`（MIDI 番号）。 */
const ROLE_REGISTER_BOUNDS: Record<
	AutoRole | "sparkle",
	[number, number, number, number]
> = {
	bass: [24, 57, 30, 52],
	melody: [52, 88, 57, 82],
	submelody: [48, 88, 53, 82],
	chord: [45, 82, 48, 76],
	sparkle: [64, 104, 69, 96],
};

/**
 * 音源の得意音域と役割の適正音域の両方を満たすオクターブ補正（-2〜+2）を双方向で探す。
 */
export const computeBestOctave = (
	role: AutoRole,
	subRole: OtomadSubRole,
	profile: TrackNoteProfile,
	preset: OtomadPresetEntry,
	allowShift: boolean,
): { octave: number; penalty: number } => {
	const shifts = allowShift ? [0, 1, -1, 2, -2] : [0];
	const [roleLo, roleHi, medLo, medHi] =
		ROLE_REGISTER_BOUNDS[subRole === "sparkle" ? "sparkle" : role];
	let bestOctave = 0;
	let bestPenalty = Number.POSITIVE_INFINITY;

	for (const oct of shifts) {
		const d = oct * 12;
		const med = profile.medianMidi + d;
		const p15 = profile.p15Midi + d;
		const p85 = profile.p85Midi + d;

		// 1. 音源サンプルの得意音域（単一サンプルは引き伸ばし劣化が大きいため強めに守る）
		const belowInst =
			Math.max(0, preset.sweetMin - p15) * 1.4 +
			Math.max(0, preset.sweetMin - med) * 0.8;
		const aboveInst =
			Math.max(0, p85 - preset.sweetMax) * 1.8 +
			Math.max(0, med - preset.sweetMax) * 1.0;
		const instWeight = preset.multisampled ? 0.55 : 1.65;

		// 2. サンプル元の高さからの距離（単一サンプルは ±1oct 以内が自然）
		const rootDist =
			Math.abs(med - preset.rootMidi) * (preset.multisampled ? 0.15 : 0.55);

		// 3. 役割ごとの音楽的音域（ベースが中音域へ逃げないようにする）
		const roleEdge =
			Math.max(0, roleLo - p15) * 3.0 + Math.max(0, p85 - roleHi) * 3.0;
		const roleMed =
			Math.max(0, medLo - med) * 6.0 + Math.max(0, med - medHi) * 6.0;

		// 4. 不要なオクターブ移動を避ける慣性
		const inertia = oct === 0 ? 0 : Math.abs(oct) === 1 ? 3.5 : 11.0;

		const penalty =
			(belowInst + aboveInst) * instWeight +
			rootDist +
			roleEdge +
			roleMed +
			inertia;
		if (penalty < bestPenalty) {
			bestPenalty = penalty;
			bestOctave = oct;
		}
	}
	return { octave: bestOctave, penalty: bestPenalty };
};

const matchesGenre = (
	preset: OtomadPresetEntry,
	genre: OtomadGenre,
): boolean => {
	if (genre === "inmu") return preset.family === "inmu";
	if (genre === "cookie") return preset.family === "cookie";
	return true;
};

const matchesSource = (
	preset: OtomadPresetEntry,
	source: OtomadSource,
): boolean => {
	switch (source) {
		case "all":
			return true;
		case "modern":
			return preset.source === "inc" || preset.source === "otenkiame";
		case "niji":
			return preset.source === "niji";
		case "inc":
			return preset.source === "inc";
	}
};

const ROLE_PRIORITY: Record<AutoRole | "sparkle", number> = {
	melody: 0,
	bass: 1,
	submelody: 2,
	chord: 3,
	sparkle: 4,
};

type ResolvedTrackContext = {
	input: OtomadizeTrackInput;
	role: AutoRole;
	subRole: OtomadSubRole;
	profile: TrackNoteProfile;
	gmTimbre: GmTimbre | null;
};

const scoreCandidate = (
	ctx: ResolvedTrackContext,
	preset: OtomadPresetEntry,
	options: OtomadizeOptions,
	familyCounts: { inmu: number; cookie: number },
	remainingCount: number,
	usedPresetIds: ReadonlySet<string>,
	usedCharacters: ReadonlyMap<string, number>,
): { score: number; octave: number } => {
	const { role, subRole, profile, gmTimbre } = ctx;
	let score = 0;

	// 1. 役割・サブ役割との一致
	if (preset.roles[0] === subRole) score += 42;
	else if (preset.roles.includes(subRole)) score += 32;
	else {
		const sameBroadRole = preset.roles.some((r) => {
			if (role === "bass") return r.startsWith("bass_");
			if (role === "melody") return r.startsWith("lead_");
			if (role === "submelody") return r.startsWith("sub_");
			return r.startsWith("chord_") || r === "arp" || r === "sparkle";
		});
		if (sameBroadRole) score += 16;
	}

	const isBassPreset =
		preset.articulation === "bass_loop" || preset.articulation === "bass_punch";
	if (role === "bass" && !isBassPreset) {
		score -= preset.rootMidi > 60 ? 55 : 22;
	}
	if (role !== "bass" && isBassPreset) {
		score -= 40;
	}
	if (subRole === "sparkle" && preset.sweetMax < 76) {
		score -= 24;
	}

	// 2. 音価・ループ適性
	const needsSustain =
		subRole === "lead_sustain" ||
		subRole === "sub_sustain" ||
		subRole === "chord_pad" ||
		subRole === "bass_sustain" ||
		profile.longNoteRatio >= 0.35;
	const needsPunch =
		subRole === "lead_pluck" ||
		subRole === "sub_pluck" ||
		subRole === "chord_stab" ||
		subRole === "arp" ||
		subRole === "bass_punch" ||
		profile.shortNoteRatio >= 0.6;

	if (needsSustain) {
		if (preset.looped) score += 16;
		else score -= 22;
	} else if (needsPunch) {
		if (
			preset.articulation === "pluck" ||
			preset.articulation === "short_hit" ||
			preset.articulation === "bass_punch"
		) {
			score += 12;
		} else if (preset.articulation === "pad") {
			score -= 10;
		}
	}

	// 3. 元の GM 楽器ヒント（useCurrentInstrument 有効かつ、既に Inc を使っていない場合）
	if (options.useCurrentInstrument && gmTimbre) {
		const idx = preset.gmAffinities.indexOf(gmTimbre);
		if (idx === 0) score += 20;
		else if (idx > 0) score += 14;
	}

	// 4. 音域適合（オクターブ補正も考慮）
	const fit = computeBestOctave(
		role,
		subRole,
		profile,
		preset,
		options.adjustOctave,
	);
	score -= Math.min(35, fit.penalty * 0.9);
	if (fit.octave === 0 && Math.abs(profile.medianMidi - preset.rootMidi) <= 6) {
		score += 8;
	}

	// 5. 配役方針・出典バランス
	if (options.castPolicy === "classic") {
		score += preset.iconic ? 16 : -6;
		if (preset.source === "inc" || preset.source === "otenkiame") score += 4;
	} else if (options.castPolicy === "balanced") {
		score += preset.iconic ? 8 : 0;
	}

	// 6. 淫夢 & クッキー☆ の混在保証
	if (options.genre === "both") {
		const oppositeCount =
			preset.family === "inmu" ? familyCounts.cookie : familyCounts.inmu;
		const selfCount = familyCounts[preset.family];
		if (selfCount === 0 && oppositeCount > 0) {
			score += remainingCount <= 1 ? 65 : 30;
		}
	}

	// 7. トラック間の重複回避（キャラ散らし・同一音色回避）
	if (usedPresetIds.has(preset.id)) score -= 50;
	const charUsed = usedCharacters.get(preset.character) ?? 0;
	if (charUsed > 0) score -= 14 * charUsed;

	return { score, octave: fit.octave };
};

const pickCandidate = <T extends { score: number }>(
	scored: T[],
	policy: OtomadCastPolicy,
	rng: () => number,
): T => {
	scored.sort((a, b) => b.score - a.score);
	const topScore = scored[0].score;
	const window = policy === "classic" ? 4 : policy === "balanced" ? 8 : 16;
	const maxItems = policy === "classic" ? 2 : policy === "balanced" ? 4 : 8;
	const pool = scored
		.filter((s) => s.score >= topScore - window)
		.slice(0, maxItems);
	if (pool.length <= 1) return pool[0];
	const temp = policy === "varied" ? 5 : 3.5;
	const weights = pool.map((p) => Math.exp((p.score - topScore) / temp));
	const sum = weights.reduce((a, b) => a + b, 0);
	let r = clamp(rng(), 0, 0.999999) * sum;
	for (let i = 0; i < pool.length; i++) {
		r -= weights[i];
		if (r <= 0) return pool[i];
	}
	return pool[pool.length - 1];
};

const computeVoiceVolumeAndMix = (
	role: AutoRole,
	subRole: OtomadSubRole,
	profile: TrackNoteProfile,
	preset: OtomadPresetEntry,
	octave: number,
	panCounter: Map<AutoRole, number>,
): {
	volume: number;
	pan: number;
	compression: number;
	width: number;
	eqLow: number;
	eqMid: number;
	eqHigh: number;
	reverbSend: number;
	delaySend: number;
} => {
	const baseByRole: Record<AutoRole, number> = {
		melody: 104,
		submelody: 88,
		bass: 92,
		chord: 70,
	};
	let vol =
		(subRole === "sparkle" ? 74 : baseByRole[role]) + preset.volumeOffset;
	if (role === "chord" && profile.stats.avgPoly > 1) {
		vol /= profile.stats.avgPoly ** 0.45;
	}
	const effMedian = profile.medianMidi + octave * 12;
	if (role === "bass" && effMedian < 48) {
		vol += Math.min(10, (48 - effMedian) * 0.5);
	}
	if (effMedian > 76) {
		vol -= Math.min(14, (effMedian - 76) * 1.1);
	}
	if (role !== "melody" && profile.notesPerBar > 12) {
		vol -= 4;
	}
	const volume = clamp(Math.round(vol), 35, 124);

	const PAN_OFFSETS: Record<AutoRole | "sparkle", readonly number[]> = {
		melody: [0],
		bass: [0],
		submelody: [22, -22, 36, -36],
		chord: [38, -38, 50, -50],
		sparkle: [30, -30, 44, -44],
	};
	const panKey: AutoRole = subRole === "sparkle" ? "chord" : role;
	const panCount = panCounter.get(panKey) ?? 0;
	panCounter.set(panKey, panCount + 1);
	const offsets = PAN_OFFSETS[subRole === "sparkle" ? "sparkle" : role];
	const pan = clamp(64 + offsets[panCount % offsets.length], 0, 127);

	const highTrim = effMedian >= 78 ? 1 : 0;
	if (role === "bass") {
		return {
			volume,
			pan,
			compression: 48,
			width: 100,
			eqLow: 4,
			eqMid: -2,
			eqHigh: clamp(-4 + preset.brightnessTrim, -12, 12),
			reverbSend: 3,
			delaySend: 0,
		};
	}
	if (subRole === "sparkle") {
		return {
			volume,
			pan,
			compression: 25,
			width: 125,
			eqLow: -6,
			eqMid: -2,
			eqHigh: clamp(1 + preset.brightnessTrim - highTrim, -12, 12),
			reverbSend: 22,
			delaySend: 12,
		};
	}
	if (role === "chord") {
		return {
			volume,
			pan,
			compression: 30,
			width: 125,
			eqLow: -5,
			eqMid: -3,
			eqHigh: clamp(-1 + preset.brightnessTrim - highTrim, -12, 12),
			reverbSend: 20,
			delaySend: 0,
		};
	}
	if (role === "submelody") {
		return {
			volume,
			pan,
			compression: 35,
			width: 118,
			eqLow: -4,
			eqMid: -1,
			eqHigh: clamp(1 + preset.brightnessTrim - highTrim, -12, 12),
			reverbSend: 14,
			delaySend: 6,
		};
	}
	return {
		volume,
		pan,
		compression: 42,
		width: 112,
		eqLow: -3,
		eqMid: 1,
		eqHigh: clamp(2 + preset.brightnessTrim - highTrim, -12, 12),
		reverbSend: 10,
		delaySend: 12,
	};
};

/**
 * 曲全体のトラック情報・ノート傾向・楽器設定から「音MAD化」の割り当て計画を作る。
 */
export const planOtomadize = (
	tracks: readonly OtomadizeTrackInput[],
	options: OtomadizeOptions,
	bpm: number,
): OtomadizeResult => {
	const rng = options.rng ?? Math.random;
	const activeTrackCount = tracks.filter(
		(t) => !t.isVocal && t.notes.length > 0,
	).length;
	const densityT = clamp((activeTrackCount - 2) / (8 - 2), 0, 1);
	const bpmT = clamp((bpm - 60) / (180 - 60), 0, 1);
	const master: OtomadizeMasterPlan = {
		masterCompression: 32,
		reverbAmount: Math.round(20 - densityT * (20 - 8)),
		reverbDecay: clamp(
			2.2 - bpmT * (2.2 - 0.7),
			MIN_REVERB_DECAY_SEC,
			MAX_REVERB_DECAY_SEC,
		),
		reverbPreDelay: 15,
		fadeOutMinSec: 1.0,
	};

	// 全非ボーカル・非空トラックで統計を取り、activeOnly 時も曲全体の文脈から主旋律を正しく判定する。
	const profileById = new Map<string, TrackNoteProfile>();
	const unknownStats = new Map<string, AutoRoleStats>();
	for (const t of tracks) {
		if (t.isVocal || t.notes.length === 0) continue;
		const profile = computeTrackNoteProfile(t.notes);
		profileById.set(t.id, profile);
		if (!t.declaredRole && !t.composeSlot) {
			unknownStats.set(t.id, profile.stats);
		}
	}
	const topSingleVoiceId = pickTopSingleVoice(unknownStats);

	const targets = tracks.filter((t) => {
		if (t.isVocal || t.notes.length === 0) return false;
		if (options.activeOnly && options.activeTrackId) {
			return t.id === options.activeTrackId;
		}
		return true;
	});

	const contexts: ResolvedTrackContext[] = targets.map((t) => {
		const profile = profileById.get(t.id);
		if (!profile) throw new Error(`Missing profile for track ${t.id}`);
		const role: AutoRole =
			t.declaredRole ??
			(t.composeSlot
				? roleOfSlot(t.composeSlot)
				: classifyTrackRole(profile.stats, t.id === topSingleVoiceId));
		// useCurrentInstrument が無効、または既に淫ク☆（Inc_sf2_file、80〜83 が音源固有番号）のときはヒントにしない。
		const rawInst =
			!options.useCurrentInstrument || t.currentFont === "Inc_sf2_file"
				? undefined
				: t.currentInstrument;
		const gmProgram = rawInst ? programOfInstrumentName(rawInst) : null;
		const gmTimbre = gmProgramToTimbre(gmProgram);
		const subRole = classifyOtomadSubRole(
			role,
			t.composeSlot,
			profile,
			gmTimbre,
			gmProgram,
		);
		return { input: t, role, subRole, profile, gmTimbre };
	});

	contexts.sort((a, b) => {
		const pa = ROLE_PRIORITY[a.subRole === "sparkle" ? "sparkle" : a.role] ?? 9;
		const pb = ROLE_PRIORITY[b.subRole === "sparkle" ? "sparkle" : b.role] ?? 9;
		return pa - pb || a.input.index - b.input.index;
	});

	const candidates = OTOMAD_PRESETS.filter(
		(p) => matchesGenre(p, options.genre) && matchesSource(p, options.source),
	);
	const pool = candidates.length > 0 ? candidates : OTOMAD_PRESETS;

	const familyCounts = { inmu: 0, cookie: 0 };
	const usedPresetIds = new Set<string>();
	const usedCharacters = new Map<string, number>();
	const panCounter = new Map<AutoRole, number>();
	const plans: OtomadizeTrackPlan[] = [];

	for (let i = 0; i < contexts.length; i++) {
		const ctx = contexts[i];
		const remainingCount = contexts.length - i;
		const scored = pool.map((preset) => {
			const { score, octave } = scoreCandidate(
				ctx,
				preset,
				options,
				familyCounts,
				remainingCount,
				usedPresetIds,
				usedCharacters,
			);
			return { preset, score, octave };
		});
		const chosen = pickCandidate(scored, options.castPolicy, rng);
		const preset = chosen.preset;
		const octave = clamp(Math.round(chosen.octave), -2, 2);

		familyCounts[preset.family]++;
		usedPresetIds.add(preset.id);
		usedCharacters.set(
			preset.character,
			(usedCharacters.get(preset.character) ?? 0) + 1,
		);

		const mix = computeVoiceVolumeAndMix(
			ctx.role,
			ctx.subRole,
			ctx.profile,
			preset,
			octave,
			panCounter,
		);
		plans.push({
			trackId: ctx.input.id,
			trackIndex: ctx.input.index,
			trackName: ctx.input.name,
			role: ctx.role,
			subRole: ctx.subRole,
			preset,
			font: preset.font,
			gmInstrument:
				preset.source === "inc" && preset.gmProgram !== undefined
					? GM_INSTRUMENT_NAMES[preset.gmProgram]
					: undefined,
			octave,
			...mix,
		});
	}

	plans.sort((a, b) => a.trackIndex - b.trackIndex);
	return { tracks: plans, master };
};
