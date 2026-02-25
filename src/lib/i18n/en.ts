export const en: Record<string, string> = {
	// Sidebar
	'sidebar.deleteConfirm': 'Delete connection "{name}"?',
	'sidebar.browseDetected': 'Browse detected bucket: {name}',
	'sidebar.addConnection': 'Add connection',
	'sidebar.edit': 'Edit',
	'sidebar.delete': 'Delete',

	// Connection Dialog
	'connection.editTitle': 'Edit Connection',
	'connection.newTitle': 'New Connection',
	'connection.editDescription': 'Update the connection settings below.',
	'connection.newDescription': 'Configure a new cloud storage connection.',
	'connection.name': 'Name',
	'connection.provider': 'Provider',
	'connection.bucket': 'Bucket',
	'connection.container': 'Container',
	'connection.bucketPlaceholder': 'my-bucket or s3://bucket or https://endpoint/bucket',
	'connection.containerPlaceholder': 'my-container',
	'connection.clickToApply': '— click to apply',
	'connection.azureBucketHelper': 'Azure Blob container name.',
	'connection.s3BucketHelper': 'Paste an S3 URL or bucket name. URLs are auto-detected.',
	'connection.region': 'Region',
	'connection.endpoint': 'Endpoint',
	'connection.azureEndpointHelper':
		'Azure Blob Storage endpoint, e.g. https://myaccount.blob.core.windows.net',
	'connection.storjEndpointHelper':
		'Storj S3 gateway. Use gateway.us1/eu1/ap1.storjshare.io for a specific region.',
	'connection.endpointHelper':
		'Leave empty for default AWS endpoint. Required for MinIO, R2, and other S3-compatible services.',
	'connection.anonymous': 'Anonymous Access',
	'connection.sasToken': 'SAS Token',
	'connection.sasTokenHelper': 'Shared Access Signature token for Azure Blob Storage.',
	'connection.accessKey': 'Access Key',
	'connection.secretKey': 'Secret Key',
	'connection.credentialNotice':
		"Your credentials are stored only in your browser's password manager if you choose to save them. They are never sent to any external server or stored in local storage.",
	'connection.testSuccess': 'Connection successful',
	'connection.testFail': 'Connection failed. Check your settings and try again.',
	'connection.testButton': 'Test Connection',
	'connection.testing': 'Testing...',
	'connection.cancel': 'Cancel',
	'connection.update': 'Update',
	'connection.create': 'Create',
	'connection.saving': 'Saving...',

	// Theme
	'theme.light': 'Light',
	'theme.dark': 'Dark',
	'theme.system': 'System',
	'theme.tooltip': '{mode} mode',

	// Safe Lock
	'safeLock.enabledAria': 'Safe lock enabled (read-only)',
	'safeLock.disabledAria': 'Safe lock disabled (writes allowed)',
	'safeLock.enabledTooltip': 'Safe lock ON — write operations disabled',
	'safeLock.disabledTooltip': 'Safe lock OFF — write operations enabled',

	// Status Bar
	'statusBar.item': 'item',
	'statusBar.items': 'items',
	'statusBar.web': 'Web',

	// Tab Bar
	'tabBar.closeTab': 'Close tab {name}',
	'tabBar.copyHttps': 'Copy HTTPS link',
	'tabBar.copyStorage': 'Copy S3 link',
	'tabBar.copied': 'Copied!',
	'tabBar.closeOtherTabs': 'Close other tabs',

	// File Tree Sidebar
	'fileTree.refresh': 'Refresh',
	'fileTree.filterPlaceholder': 'Filter files...',
	'fileTree.noMatch': 'No matching files',
	'fileTree.emptyBucket': 'Empty bucket',
	'fileTree.expandDir': 'Expand directory',

	// File Row
	'fileRow.rename': 'Rename {name}',
	'fileRow.delete': 'Delete {name}',

	// Upload
	'upload.uploading': 'Uploading',
	'upload.upload': 'Upload',

	// Create Folder
	'createFolder.title': 'New Folder',
	'createFolder.description': 'Create a new folder in the current directory.',
	'createFolder.placeholder': 'Folder name',
	'createFolder.cancel': 'Cancel',
	'createFolder.creating': 'Creating...',
	'createFolder.create': 'Create',

	// Breadcrumb
	'breadcrumb.root': 'Navigate to root',

	// Drop Zone
	'dropZone.message': 'Drop files to upload',

	// File Browser
	'fileBrowser.newFolder': 'New Folder',
	'fileBrowser.name': 'Name',
	'fileBrowser.size': 'Size',
	'fileBrowser.modified': 'Modified',
	'fileBrowser.noMatch': 'No files matching "{query}"',
	'fileBrowser.empty': 'This folder is empty',

	// Search Bar
	'searchBar.label': 'Filter files',
	'searchBar.placeholder': 'Filter files...',
	'searchBar.clear': 'Clear search',

	// Delete Confirm
	'deleteConfirm.title': 'Confirm Delete',
	'deleteConfirm.description': 'This action cannot be undone.',
	'deleteConfirm.message': 'Are you sure you want to delete',
	'deleteConfirm.andContents': 'and all its contents',
	'deleteConfirm.cancel': 'Cancel',
	'deleteConfirm.delete': 'Delete',
	'deleteConfirm.deleting': 'Deleting...',

	// Rename Dialog
	'rename.title': 'Rename',
	'rename.description': 'Enter a new name for',
	'rename.placeholder': 'New name',
	'rename.cancel': 'Cancel',
	'rename.rename': 'Rename',
	'rename.renaming': 'Renaming...',

	// Table Viewer
	'table.queryCancelled': 'Query cancelled',
	'table.preparingQuery': 'Preparing query...',
	'table.initEngine': 'Initializing query engine...',
	'table.loadingSchema': 'Loading schema...',
	'table.runningQuery': 'Running query...',
	'table.runningCustomQuery': 'Running custom query...',
	'table.countingRows': 'Counting total rows...',
	'table.run': 'Run',
	'table.running': 'Running...',
	'table.format': 'Format',
	'table.loading': 'Loading...',
	'table.cancel': 'Cancel',
	'table.readingMetadata': 'Reading file metadata...',
	'table.bootingEngine': 'Booting DuckDB-WASM...',
	'table.enterSql': 'Enter SQL query... (Cmd+Enter to run)',

	// Load Progress labels
	'progress.format': 'Format',
	'progress.source': 'Source',
	'progress.columns': 'Columns',
	'progress.rows': 'Rows',
	'progress.geometry': 'Geometry',
	'progress.crs': 'CRS',
	'progress.bounds': 'Bounds',
	'progress.encoding': 'Encoding',
	'progress.compression': 'Compress.',
	'progress.rowGroups': 'Row Groups',
	'progress.createdBy': 'Created By',
	'progress.rangeRequest': 'Range request (hyparquet)',
	'progress.duckdbFallback': 'DuckDB-WASM',
	'progress.stacDetected': 'STAC catalog detected',

	// File Info view
	'fileInfo.fileMetadata': 'File Metadata',
	'fileInfo.geometry': 'Geometry',
	'fileInfo.schema': 'Schema',
	'fileInfo.column': 'Column',
	'fileInfo.type': 'Type',
	'fileInfo.noMetadata': 'No metadata available',
	'fileInfo.parquetExplorer': 'Parquet Table Explorer',

	// Table Toolbar
	'toolbar.copied': 'Copied!',
	'toolbar.https': 'HTTPS',
	'toolbar.s3': 'S3',
	'toolbar.copyHttps': 'Copy HTTPS link',
	'toolbar.copyS3': 'Copy S3 link',
	'toolbar.copyUrl': 'Copy URL',
	'toolbar.copyHttpsLink': 'HTTPS link',
	'toolbar.copyProviderLink': '{provider} link',
	'toolbar.map': 'Map',
	'toolbar.table': 'Table',
	'toolbar.stacMap': 'STAC Map',
	'toolbar.switchToMap': 'Switch to Map',
	'toolbar.switchToTable': 'Switch to Table',
	'toolbar.history': 'History',
	'toolbar.showHistory': 'Show History',
	'toolbar.hideHistory': 'Hide History',
	'toolbar.info': 'Info',
	'toolbar.pageSize': 'Page size',
	'toolbar.rows': 'rows',
	'toolbar.firstPage': 'First page',
	'toolbar.prev': 'Prev',
	'toolbar.next': 'Next',
	'toolbar.lastPage': 'Last page',
	'toolbar.jumpToPage': 'Click to jump to page',

	// Database Viewer
	'database.badge': 'Database',
	'database.tables': 'tables',
	'database.sql': 'SQL',
	'database.loading': 'Loading database...',
	'database.tablesHeader': 'Tables',
	'database.loadingTable': 'Loading table...',
	'database.selectTable': 'Select a table to browse',

	// PDF Viewer
	'pdf.badge': 'PDF',
	'pdf.loading': 'Loading PDF...',
	'pdf.prev': 'Prev',
	'pdf.next': 'Next',
	'pdf.zoomIn': 'Zoom in',
	'pdf.zoomOut': 'Zoom out',
	'pdf.zoom': 'Zoom',

	// Image Viewer
	'image.loading': 'Loading image...',
	'image.zoomIn': 'Zoom in',
	'image.zoomOut': 'Zoom out',
	'image.fit': 'Fit',
	'image.rotate': 'Rotate',
	'image.fullscreen': 'Fullscreen',

	// 3D Model Viewer
	'model.badge': '3D',
	'model.meshes': 'meshes',
	'model.vertices': 'vertices',
	'model.wireframe': 'Wireframe',
	'model.reset': 'Reset',
	'model.fullscreen': 'Fullscreen',
	'model.loading': 'Loading 3D model...',

	// Markdown Viewer
	'markdown.badge': 'Markdown',
	'markdown.evidence': 'Evidence',
	'markdown.edit': 'Edit',
	'markdown.view': 'View',

	// Zarr Viewer
	'zarr.badge': 'Zarr',
	'zarr.variables': 'variables',
	'zarr.inspect': 'Inspect',
	'zarr.map': 'Map',
	'zarr.loading': 'Loading Zarr metadata...',

	// Archive Viewer
	'archive.badge': 'Archive',
	'archive.entries': 'entries',
	'archive.streamed': 'Streamed',
	'archive.fullDownload': 'Full Download',
	'archive.loading': 'Loading archive...',
	'archive.scanning': 'Scanning...',
	'archive.scanningProgress': 'Scanning archive... {count} entries found',
	'archive.empty': 'Empty directory',
	'archive.unsupported': 'Unsupported archive format',

	// Raw Viewer
	'raw.loading': 'Loading hex dump...',
	'raw.showingFirst': 'showing first {size}',

	// Code Viewer
	'code.maplibreStyle': 'MapLibre Style',
	'code.editStyle': 'Edit Style',
	'code.tileJson': 'TileJSON',
	'code.noWrap': 'No Wrap',
	'code.wrap': 'Wrap',
	'code.copied': 'Copied!',
	'code.copy': 'Copy',
	'code.format': 'Format',
	'code.raw': 'Raw',
	'code.loading': 'Loading...',
	'code.stacCatalog': 'STAC Catalog',
	'code.stacCollection': 'STAC Collection',
	'code.stacItem': 'STAC Item',
	'code.browseStac': 'Browse',
	'code.keplerGl': 'Kepler.gl',
	'code.openKepler': 'Open Map',
	'code.code': 'Code',

	// Table Status Bar
	'statusBar.runningQuery': 'Running query...',
	'statusBar.rowsLabel': 'rows',
	'statusBar.inTime': 'in {time}ms',
	'statusBar.noResults': 'No results',
	'statusBar.export': 'Export',
	'statusBar.exportCsv': 'Export as CSV',
	'statusBar.exportJson': 'Export as JSON',

	// Query History
	'queryHistory.title': 'Query History',
	'queryHistory.clearAll': 'Clear all',
	'queryHistory.searchPlaceholder': 'Search queries...',
	'queryHistory.justNow': 'just now',
	'queryHistory.minsAgo': '{n}m ago',
	'queryHistory.hoursAgo': '{n}h ago',
	'queryHistory.daysAgo': '{n}d ago',

	// Map Viewers
	'map.loadingData': 'Loading map data...',
	'map.loadingGeometry': 'Loading geometry data...',
	'map.loadingPmtiles': 'Loading PMTiles...',
	'map.loadingFgb': 'Loading FlatGeobuf...',
	'map.loadingCog': 'Loading COG...',
	'map.loadingZarr': 'Loading Zarr data...',
	'map.features': 'features',
	'map.limit': '(limit)',
	'map.of': 'of',
	'map.attributes': 'Attributes',
	'map.flyToFirst': 'Fly to first feature',
	'map.info': 'Info',
	'map.archiveInfo': 'Archive Info',
	'map.flatgeobufInfo': 'FlatGeobuf Info',
	'map.cogInfo': 'COG Info',
	'map.cogCorsError':
		'Cannot load COG: the server does not allow cross-origin requests (CORS). The file must be hosted with CORS headers enabled.',
	'map.cogUnsupportedFormat':
		'This COG uses {{type}} format which is not supported for map rendering. Only RGB COGs can be displayed.',
	'map.noGeoColumn': 'No geometry column detected in schema',
	'map.noData': 'No data available for map view',
	'map.noFeatures': 'No features found in FlatGeobuf file',
	'map.layers': 'layer',
	'map.layersPlural': 'layers',
	'map.tiles': 'tiles',
	'map.variable': 'Variable:',

	// Map info panel labels
	'mapInfo.name': 'Name',
	'mapInfo.description': 'Description',
	'mapInfo.specVersion': 'Spec Version',
	'mapInfo.tileFormat': 'Tile Format',
	'mapInfo.zoomRange': 'Zoom Range',
	'mapInfo.tileCompression': 'Tile Compression',
	'mapInfo.internalCompression': 'Internal Compression',
	'mapInfo.clustered': 'Clustered',
	'mapInfo.yes': 'Yes',
	'mapInfo.no': 'No',
	'mapInfo.addressedTiles': 'Addressed Tiles',
	'mapInfo.tileEntries': 'Tile Entries',
	'mapInfo.uniqueContents': 'Unique Contents',
	'mapInfo.bounds': 'Bounds',
	'mapInfo.center': 'Center',
	'mapInfo.layers': 'Layers',
	'mapInfo.attribution': 'Attribution',
	'mapInfo.dataVersion': 'Data Version',
	'mapInfo.title': 'Title',
	'mapInfo.geometryType': 'Geometry Type',
	'mapInfo.totalFeatures': 'Total Features',
	'mapInfo.spatialIndex': 'Spatial Index',
	'mapInfo.yesRTree': 'Yes (packed R-tree)',
	'mapInfo.crs': 'CRS',
	'mapInfo.columns': 'Columns',
	'mapInfo.size': 'Size',
	'mapInfo.bands': 'Bands',

	// Page
	'page.selectFile': 'Pick something',
	'page.selectFileDescription': 'Browse the file tree and click a file to peek inside.',
	'page.noFileOpen': 'Nothing here yet',
	'page.noFileDescription': 'Add a bucket from the sidebar to start exploring.',
	'page.supportsFormats':
		'Parquet · Cloud Optimized GeoTIFF · FlatGeobuf · PMTiles · CSV · PDF · 3D and more',
	'page.addConnection': 'Add connection',
	'page.tryExample': 'Try an example',

	// Mobile
	'mobile.openSidebar': 'Open file browser',
	'mobile.fileExplorer': 'File Explorer',

	// Locale
	'locale.toggle': 'Language'
};
