/**
 * @credits rpgen3 https://rpgen3.github.io/mylib/export/import.mjs (MIT)
 * getScript: src を append より先に設定することで Discord Activity の
 * script-src CSP（blob: のみ許可）と互換性を持たせている。
 */

export const importAll = (arr: string[]) =>
	Promise.all(arr.map((v) => import(v))).then((v) => Object.assign({}, ...v));

export const importAllSettled = (arr: string[]) =>
	Promise.allSettled(arr.map((v) => import(v))).then((v) =>
		Object.assign(
			{},
			...v.flatMap((r) => (r.status === "fulfilled" ? r.value : {})),
		),
	);

export const getScript = (url: string): Promise<HTMLScriptElement> =>
	new Promise((resolve, reject) => {
		const e = document.createElement("script");
		e.onload = () => {
			resolve(e);
			e.remove();
		};
		e.onerror = reject;
		e.src = url; // src を先に設定
		document.head.append(e); // append は後
	});
