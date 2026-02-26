declare module 'notebookjs' {
	interface Notebook {
		render(): HTMLElement;
	}
	const nb: {
		prefix: string;
		markdown: (md: string) => string;
		ansi: (text: string) => string;
		highlighter: (code: string, lang: string) => string;
		sanitizer: (html: string) => string;
		parse(json: unknown): Notebook;
	};
	export default nb;
}
