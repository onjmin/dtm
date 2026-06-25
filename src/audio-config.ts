/**
 * オーディオ設定とSoundFont管理
 * Audio Context初期化、SoundFont読み込み、ノート再生等
 */

/**
 * Audio Context初期化
 * DOMに依存しない純粋な音声設定
 */
export function createAudioContext() {
	const audioCtx = new AudioContext();
	const gainNode = audioCtx.createGain();
	gainNode.connect(audioCtx.destination);

	// ドラム用の独立したGainNode
	const drumGainNode = audioCtx.createGain();
	drumGainNode.connect(audioCtx.destination);

	return { audioCtx, gainNode, drumGainNode };
}

/**
 * GM楽器名 → SoundFontキー対応表（静的埋め込み）
 * @credits rpgen3 https://rpgen3.github.io/soundfont/list/fontName_surikov.txt (MIT)
 */
const FONT_NAME_SURIKOV = `0000 Acoustic Grand Piano
0010 Bright Acoustic Piano
0020 Electric Grand Piano
0030 Honky-tonk Piano
0040 Electric Piano 1
0050 Electric Piano 2
0060 Harpsichord
0070 Clavinet
0080 Celesta
0090 Glockenspiel
0100 Music Box
0110 Vibraphone
0120 Marimba
0130 Xylophone
0140 Tubular Bells
0150 Dulcimer
0160 Drawbar Organ
0170 Percussive Organ
0180 Rock Organ
0190 Church Organ
0200 Reed Organ
0210 Accordion
0220 Harmonica
0230 Tango Accordion
0240 Acoustic Guitar (nylon)
0250 Acoustic Guitar (steel)
0260 Electric Guitar (jazz)
0270 Electric Guitar (clean)
0280 Electric Guitar (muted)
0290 Overdriven Guitar
0300 Distortion Guitar
0310 Guitar Harmonics
0320 Acoustic Bass
0330 Electric Bass (finger)
0340 Electric Bass (pick)
0350 Fretless Bass
0360 Slap Bass 1
0370 Slap Bass 2
0380 Synth Bass 1
0390 Synth Bass 2
0400 Violin
0410 Viola
0420 Cello
0430 Contrabass
0440 Tremolo Strings
0450 Pizzicato Strings
0460 Orchestral Harp
0470 Timpani
0480 String Ensemble 1
0490 String Ensemble 2
0500 Synth Strings 1
0510 Synth Strings 2
0520 Choir Aahs
0530 Voice Oohs
0540 Synth Choir
0550 Orchestra Hit
0560 Trumpet
0570 Trombone
0580 Tuba
0590 Muted Trumpet
0600 French Horn
0610 Brass Section
0620 Synth Brass 1
0630 Synth Brass 2
0640 Soprano Sax
0650 Alto Sax
0660 Tenor Sax
0670 Baritone Sax
0680 Oboe
0690 English Horn
0700 Bassoon
0710 Clarinet
0720 Piccolo
0730 Flute
0740 Recorder
0750 Pan Flute
0760 Blown bottle
0770 Shakuhachi
0780 Whistle
0790 Ocarina
0800 Lead 1 (square)
0810 Lead 2 (sawtooth)
0820 Lead 3 (calliope)
0830 Lead 4 (chiff)
0840 Lead 5 (charang)
0850 Lead 6 (voice)
0860 Lead 7 (fifths)
0870 Lead 8 (bass + lead)
0880 Pad 1 (new age)
0890 Pad 2 (warm)
0900 Pad 3 (polysynth)
0910 Pad 4 (choir)
0920 Pad 5 (bowed)
0930 Pad 6 (metallic)
0940 Pad 7 (halo)
0950 Pad 8 (sweep)
0960 FX 1 (rain)
0970 FX 2 (soundtrack)
0980 FX 3 (crystal)
0990 FX 4 (atmosphere)
1000 FX 5 (brightness)
1010 FX 6 (goblins)
1020 FX 7 (echoes)
1030 FX 8 (sci-fi)
1040 Sitar
1050 Banjo
1060 Shamisen
1070 Koto
1080 Kalimba
1090 Bagpipe
1100 Fiddle
1110 Shanai
1120 Tinkle Bell
1130 Agogo
1140 Steel Drums
1150 Woodblock
1160 Taiko Drum
1170 Melodic Tom
1180 Synth Drum
1190 Reverse Cymbal
1200 Guitar Fret Noise
1210 Breath Noise
1220 Seashore
1230 Bird Tweet
1240 Telephone Ring
1250 Helicopter
1260 Applause
1270 Gunshot`;

/**
 * 楽器名からキーへのマッピングを構築（静的データから生成、外部fetchなし）
 */
export async function buildNameToKeyMapping(): Promise<Record<string, string>> {
	const nameToKey: Record<string, string> = {};
	for (const line of FONT_NAME_SURIKOV.trim().split("\n")) {
		const spaceIdx = line.indexOf(" ");
		if (spaceIdx === -1) continue;
		const key = line.slice(0, spaceIdx);
		const name = line.slice(spaceIdx + 1);
		nameToKey[name] = key;
	}
	return nameToKey;
}
