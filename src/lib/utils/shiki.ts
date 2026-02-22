import type { BundledLanguage, BundledTheme, HighlighterGeneric } from 'shiki';

let highlighterPromise: Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> | null = null;

const extToLang: Record<string, BundledLanguage> = {
	'.js': 'javascript',
	'.mjs': 'javascript',
	'.cjs': 'javascript',
	'.jsx': 'jsx',
	'.ts': 'typescript',
	'.tsx': 'tsx',
	'.py': 'python',
	'.rs': 'rust',
	'.go': 'go',
	'.java': 'java',
	'.c': 'c',
	'.cpp': 'cpp',
	'.h': 'c',
	'.hpp': 'cpp',
	'.rb': 'ruby',
	'.php': 'php',
	'.swift': 'swift',
	'.kt': 'kotlin',
	'.scala': 'scala',
	'.r': 'r',
	'.lua': 'lua',
	'.sql': 'sql',
	'.html': 'html',
	'.css': 'css',
	'.scss': 'scss',
	'.less': 'less',
	'.xml': 'xml',
	'.yaml': 'yaml',
	'.yml': 'yaml',
	'.toml': 'toml',
	'.json': 'json',
	'.jsonl': 'json',
	'.ndjson': 'json',
	'.sh': 'bash',
	'.bash': 'bash',
	'.zsh': 'bash',
	'.fish': 'fish',
	'.ps1': 'powershell',
	'.vim': 'viml',
	'.dockerfile': 'dockerfile',
	'.makefile': 'makefile',
	'.md': 'markdown',
	'.markdown': 'markdown',
	'.ini': 'ini',
	'.cfg': 'ini',
	'.conf': 'ini',
	'.env': 'dotenv',
	'.svelte': 'svelte',
	'.vue': 'vue',
	'.tf': 'hcl',
	'.graphql': 'graphql',
	'.gql': 'graphql',
	'.prisma': 'prisma',
	'.proto': 'proto'
};

export function extensionToShikiLang(ext: string): BundledLanguage | undefined {
	return extToLang[ext.toLowerCase()];
}

function isDarkMode(): boolean {
	if (typeof document === 'undefined') return false;
	return document.documentElement.classList.contains('dark');
}

export function getTheme(): BundledTheme {
	return isDarkMode() ? 'github-dark' : 'github-light';
}

async function getHighlighter(): Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> {
	if (!highlighterPromise) {
		highlighterPromise = import('shiki').then((mod) =>
			mod.createHighlighter({
				themes: ['github-dark', 'github-light'],
				langs: Object.values(extToLang).filter((v, i, a) => a.indexOf(v) === i)
			})
		);
	}
	return highlighterPromise;
}

export async function highlightCode(code: string, lang?: BundledLanguage): Promise<string> {
	const highlighter = await getHighlighter();
	const theme = getTheme();

	return highlighter.codeToHtml(code, {
		lang: lang ?? 'text',
		theme
	});
}
