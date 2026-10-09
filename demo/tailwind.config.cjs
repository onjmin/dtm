// demo/tailwind.css の生成元。index.html / bgm.html のクラスを変えたらリポジトリ直下で作り直す:
//   pnpm dlx tailwindcss@3.4.17 -c demo/tailwind.config.cjs -o demo/tailwind.css --minify
// 旧 Play CDN（v3）と同じ見た目にするため v3 のまま。クラス名は文字列連結で組み立てないこと（走査に載らない）。
/** @type {import('tailwindcss').Config} */
module.exports = {
	content: { relative: true, files: ["./index.html", "./bgm.html"] },
	theme: {
		extend: {
			fontFamily: { pixel: ["k8x12", "ui-monospace", "monospace"] },
			colors: {
				pico: {
					black: "#000000",
					navy: "#1d2b53",
					purple: "#7e2553",
					dkgrn: "#008751",
					brown: "#ab5236",
					gray: "#5f574f",
					silver: "#c2c3c7",
					white: "#fff1e8",
					red: "#ff004d",
					orange: "#ffa300",
					yellow: "#ffec27",
					green: "#00e436",
					cyan: "#29adff",
					lavend: "#83769c",
					pink: "#ff77a8",
					peach: "#ffccaa",
				},
			},
		},
	},
};
