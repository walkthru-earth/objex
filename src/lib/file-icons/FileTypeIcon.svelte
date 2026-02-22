<script lang="ts">
import ArchiveIcon from '@lucide/svelte/icons/archive';
import BookTextIcon from '@lucide/svelte/icons/book-text';
import BoxIcon from '@lucide/svelte/icons/box';
import BracesIcon from '@lucide/svelte/icons/braces';
import Columns3Icon from '@lucide/svelte/icons/columns-3';
import DatabaseIcon from '@lucide/svelte/icons/database';
import DatabaseZapIcon from '@lucide/svelte/icons/database-zap';
import FileIcon from '@lucide/svelte/icons/file';
import FileCodeIcon from '@lucide/svelte/icons/file-code';
import FileTextIcon from '@lucide/svelte/icons/file-text';
import FilmIcon from '@lucide/svelte/icons/film';
import FolderIcon from '@lucide/svelte/icons/folder';
import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
import GlobeIcon from '@lucide/svelte/icons/globe';
import ImageIcon from '@lucide/svelte/icons/image';
import LayersIcon from '@lucide/svelte/icons/layers';
import MapIcon from '@lucide/svelte/icons/map';
import MusicIcon from '@lucide/svelte/icons/music';
import PaintbrushIcon from '@lucide/svelte/icons/paintbrush';
import PaletteIcon from '@lucide/svelte/icons/palette';
import SettingsIcon from '@lucide/svelte/icons/settings';
import TableIcon from '@lucide/svelte/icons/table';
import TerminalIcon from '@lucide/svelte/icons/terminal';
import ZapIcon from '@lucide/svelte/icons/zap';
import { getFileTypeInfo } from './index.js';

let {
	extension = '',
	isDir = false,
	isOpen = false,
	class: className = 'size-4'
}: {
	extension?: string;
	isDir?: boolean;
	isOpen?: boolean;
	class?: string;
} = $props();

const info = $derived(getFileTypeInfo(extension, isDir));

const ICON_MAP: Record<string, any> = {
	Columns3: Columns3Icon,
	Table: TableIcon,
	Braces: BracesIcon,
	Globe: GlobeIcon,
	Zap: ZapIcon,
	FileCode: FileCodeIcon,
	FileText: FileTextIcon,
	Image: ImageIcon,
	Palette: PaletteIcon,
	Film: FilmIcon,
	Music: MusicIcon,
	Archive: ArchiveIcon,
	Map: MapIcon,
	Layers: LayersIcon,
	Database: DatabaseIcon,
	DatabaseZap: DatabaseZapIcon,
	Box: BoxIcon,
	Terminal: TerminalIcon,
	BookText: BookTextIcon,
	Settings: SettingsIcon,
	Paintbrush: PaintbrushIcon,
	Folder: FolderIcon,
	FolderOpen: FolderOpenIcon,
	File: FileIcon
};

const Icon = $derived(
	isDir ? (isOpen ? FolderOpenIcon : FolderIcon) : ICON_MAP[info.icon] || FileIcon
);
</script>

<Icon class="{info.color} {className}" />
