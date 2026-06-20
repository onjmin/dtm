// assets/*.png は tsup（esbuild）の dataurl ローダーで base64 data URI 文字列として import される。
declare module "*.png" {
	const dataUri: string;
	export default dataUri;
}
