export const ar: Record<string, string> = {
	// Sidebar
	'sidebar.deleteConfirm': 'حذف الاتصال "{name}"؟',
	'sidebar.browseDetected': 'تصفح الحاوية المكتشفة: {name}',
	'sidebar.addConnection': 'إضافة اتصال',
	'sidebar.edit': 'تعديل',
	'sidebar.delete': 'حذف',

	// Connection Dialog
	'connection.editTitle': 'تعديل الاتصال',
	'connection.newTitle': 'اتصال جديد',
	'connection.editDescription': 'حدّث إعدادات الاتصال أدناه.',
	'connection.newDescription': 'أعدّ اتصالاً جديداً بالتخزين السحابي.',
	'connection.name': 'الاسم',
	'connection.provider': 'مزوّد الخدمة',
	'connection.bucket': 'الحاوية',
	'connection.container': 'الحاوية',
	'connection.bucketPlaceholder': 'my-bucket أو s3://bucket أو https://endpoint/bucket',
	'connection.containerPlaceholder': 'my-container',
	'connection.clickToApply': '— انقر للتطبيق',
	'connection.azureBucketHelper': 'اسم حاوية Azure Blob.',
	'connection.s3BucketHelper': 'الصق رابط S3 أو اسم الحاوية. يتم اكتشاف الروابط تلقائياً.',
	'connection.region': 'المنطقة',
	'connection.endpoint': 'نقطة النهاية',
	'connection.azureEndpointHelper':
		'نقطة نهاية Azure Blob Storage، مثال: https://myaccount.blob.core.windows.net',
	'connection.storjEndpointHelper':
		'بوابة Storj S3. استخدم gateway.us1/eu1/ap1.storjshare.io لمنطقة محددة.',
	'connection.endpointHelper':
		'اتركه فارغاً لنقطة نهاية AWS الافتراضية. مطلوب لـ MinIO وR2 والخدمات المتوافقة مع S3.',
	'connection.anonymous': 'وصول مجهول',
	'connection.sasToken': 'رمز SAS',
	'connection.sasTokenHelper': 'رمز توقيع الوصول المشترك لـ Azure Blob Storage.',
	'connection.accessKey': 'مفتاح الوصول',
	'connection.secretKey': 'المفتاح السري',
	'connection.credentialNotice':
		'يتم تخزين بيانات اعتمادك فقط في مدير كلمات المرور بمتصفحك إذا اخترت حفظها. لا تُرسل أبداً إلى أي خادم خارجي ولا تُخزّن في التخزين المحلي.',
	'connection.testSuccess': 'الاتصال ناجح',
	'connection.testFail': 'فشل الاتصال. تحقق من الإعدادات وحاول مرة أخرى.',
	'connection.testButton': 'اختبار الاتصال',
	'connection.testing': 'جارٍ الاختبار...',
	'connection.cancel': 'إلغاء',
	'connection.update': 'تحديث',
	'connection.create': 'إنشاء',
	'connection.saving': 'جارٍ الحفظ...',

	// Theme
	'theme.light': 'فاتح',
	'theme.dark': 'داكن',
	'theme.system': 'النظام',
	'theme.tooltip': 'وضع {mode}',

	// Safe Lock
	'safeLock.enabledAria': 'قفل الأمان مفعّل (قراءة فقط)',
	'safeLock.disabledAria': 'قفل الأمان معطّل (الكتابة مسموحة)',
	'safeLock.enabledTooltip': 'قفل الأمان مفعّل — عمليات الكتابة معطّلة',
	'safeLock.disabledTooltip': 'قفل الأمان معطّل — عمليات الكتابة مسموحة',

	// Status Bar
	'statusBar.item': 'عنصر',
	'statusBar.items': 'عناصر',
	'statusBar.web': 'ويب',

	// Tab Bar
	'tabBar.closeTab': 'إغلاق التبويب {name}',
	'tabBar.copyHttps': 'نسخ رابط HTTPS',
	'tabBar.copyStorage': 'نسخ رابط S3',
	'tabBar.copied': 'تم النسخ!',
	'tabBar.closeOtherTabs': 'إغلاق التبويبات الأخرى',

	// File Tree Sidebar
	'fileTree.refresh': 'تحديث',
	'fileTree.filterPlaceholder': 'تصفية الملفات...',
	'fileTree.noMatch': 'لا توجد ملفات مطابقة',
	'fileTree.emptyBucket': 'حاوية فارغة',
	'fileTree.expandDir': 'توسيع المجلد',

	// File Row
	'fileRow.rename': 'إعادة تسمية {name}',
	'fileRow.delete': 'حذف {name}',

	// Upload
	'upload.uploading': 'جارٍ الرفع',
	'upload.upload': 'رفع',

	// Create Folder
	'createFolder.title': 'مجلد جديد',
	'createFolder.description': 'إنشاء مجلد جديد في المجلد الحالي.',
	'createFolder.placeholder': 'اسم المجلد',
	'createFolder.cancel': 'إلغاء',
	'createFolder.creating': 'جارٍ الإنشاء...',
	'createFolder.create': 'إنشاء',

	// Breadcrumb
	'breadcrumb.root': 'الانتقال إلى الجذر',

	// Drop Zone
	'dropZone.message': 'أسقط الملفات للرفع',

	// File Browser
	'fileBrowser.newFolder': 'مجلد جديد',
	'fileBrowser.name': 'الاسم',
	'fileBrowser.size': 'الحجم',
	'fileBrowser.modified': 'التعديل',
	'fileBrowser.noMatch': 'لا توجد ملفات مطابقة لـ "{query}"',
	'fileBrowser.empty': 'هذا المجلد فارغ',

	// Search Bar
	'searchBar.label': 'تصفية الملفات',
	'searchBar.placeholder': 'تصفية الملفات...',
	'searchBar.clear': 'مسح البحث',

	// Delete Confirm
	'deleteConfirm.title': 'تأكيد الحذف',
	'deleteConfirm.description': 'لا يمكن التراجع عن هذا الإجراء.',
	'deleteConfirm.message': 'هل أنت متأكد من حذف',
	'deleteConfirm.andContents': 'وجميع محتوياته',
	'deleteConfirm.cancel': 'إلغاء',
	'deleteConfirm.delete': 'حذف',
	'deleteConfirm.deleting': 'جارٍ الحذف...',

	// Rename Dialog
	'rename.title': 'إعادة تسمية',
	'rename.description': 'أدخل اسماً جديداً لـ',
	'rename.placeholder': 'الاسم الجديد',
	'rename.cancel': 'إلغاء',
	'rename.rename': 'إعادة تسمية',
	'rename.renaming': 'جارٍ إعادة التسمية...',

	// Table Viewer
	'table.queryCancelled': 'تم إلغاء الاستعلام',
	'table.preparingQuery': 'جارٍ تحضير الاستعلام...',
	'table.initEngine': 'جارٍ تهيئة محرك الاستعلام...',
	'table.loadingSchema': 'جارٍ تحميل المخطط...',
	'table.runningQuery': 'جارٍ تنفيذ الاستعلام...',
	'table.runningCustomQuery': 'جارٍ تنفيذ الاستعلام المخصص...',
	'table.countingRows': 'جارٍ حساب إجمالي الصفوف...',
	'table.run': 'تنفيذ',
	'table.running': 'جارٍ التنفيذ...',
	'table.format': 'تنسيق',
	'table.loading': 'جارٍ التحميل...',
	'table.cancel': 'إلغاء',
	'table.enterSql': 'أدخل استعلام SQL... (Cmd+Enter للتنفيذ)',

	// Table Toolbar
	'toolbar.copied': 'تم النسخ!',
	'toolbar.https': 'HTTPS',
	'toolbar.s3': 'S3',
	'toolbar.copyHttps': 'نسخ رابط HTTPS',
	'toolbar.copyS3': 'نسخ رابط S3',
	'toolbar.map': 'خريطة',
	'toolbar.table': 'جدول',
	'toolbar.switchToMap': 'التبديل إلى الخريطة',
	'toolbar.switchToTable': 'التبديل إلى الجدول',
	'toolbar.history': 'السجل',
	'toolbar.showHistory': 'إظهار السجل',
	'toolbar.hideHistory': 'إخفاء السجل',
	'toolbar.schema': 'المخطط',
	'toolbar.showSchema': 'إظهار المخطط',
	'toolbar.hideSchema': 'إخفاء المخطط',
	'toolbar.pageSize': 'حجم الصفحة',
	'toolbar.rows': 'صفوف',
	'toolbar.firstPage': 'الصفحة الأولى',
	'toolbar.prev': 'السابق',
	'toolbar.next': 'التالي',
	'toolbar.lastPage': 'الصفحة الأخيرة',
	'toolbar.jumpToPage': 'انقر للانتقال إلى صفحة',

	// Database Viewer
	'database.badge': 'قاعدة بيانات',
	'database.tables': 'جداول',
	'database.sql': 'SQL',
	'database.loading': 'جارٍ تحميل قاعدة البيانات...',
	'database.tablesHeader': 'الجداول',
	'database.loadingTable': 'جارٍ تحميل الجدول...',
	'database.selectTable': 'اختر جدولاً للتصفح',

	// PDF Viewer
	'pdf.badge': 'PDF',
	'pdf.loading': 'جارٍ تحميل PDF...',
	'pdf.prev': 'السابق',
	'pdf.next': 'التالي',
	'pdf.zoomIn': 'تكبير',
	'pdf.zoomOut': 'تصغير',
	'pdf.zoom': 'التكبير',

	// Image Viewer
	'image.loading': 'جارٍ تحميل الصورة...',
	'image.zoomIn': 'تكبير',
	'image.zoomOut': 'تصغير',
	'image.fit': 'ملائمة',
	'image.rotate': 'تدوير',
	'image.fullscreen': 'ملء الشاشة',

	// 3D Model Viewer
	'model.badge': '3D',
	'model.meshes': 'شبكات',
	'model.vertices': 'رؤوس',
	'model.wireframe': 'إطار سلكي',
	'model.reset': 'إعادة تعيين',
	'model.fullscreen': 'ملء الشاشة',
	'model.loading': 'جارٍ تحميل النموذج ثلاثي الأبعاد...',

	// Markdown Viewer
	'markdown.badge': 'Markdown',
	'markdown.evidence': 'Evidence',
	'markdown.edit': 'تعديل',
	'markdown.view': 'عرض',

	// Zarr Viewer
	'zarr.badge': 'Zarr',
	'zarr.variables': 'متغيرات',
	'zarr.inspect': 'فحص',
	'zarr.map': 'خريطة',
	'zarr.loading': 'جارٍ تحميل بيانات Zarr...',

	// Archive Viewer
	'archive.badge': 'أرشيف',
	'archive.entries': 'عناصر',
	'archive.streamed': 'بث مباشر',
	'archive.loading': 'جارٍ تحميل الأرشيف...',
	'archive.extracting': 'جارٍ الاستخراج...',
	'archive.selectFile': 'اختر ملفاً للمعاينة',

	// Raw Viewer
	'raw.loading': 'جارٍ تحميل البيانات الخام...',
	'raw.showingFirst': 'عرض أول {size}',

	// Code Viewer
	'code.maplibreStyle': 'نمط MapLibre',
	'code.editStyle': 'تعديل النمط',
	'code.tileJson': 'TileJSON',
	'code.noWrap': 'بدون التفاف',
	'code.wrap': 'التفاف',
	'code.copied': 'تم النسخ!',
	'code.copy': 'نسخ',
	'code.loading': 'جارٍ التحميل...',

	// Table Status Bar
	'statusBar.runningQuery': 'جارٍ تنفيذ الاستعلام...',
	'statusBar.rowsLabel': 'صفوف',
	'statusBar.inTime': 'في {time} مللي ثانية',
	'statusBar.noResults': 'لا توجد نتائج',
	'statusBar.export': 'تصدير',
	'statusBar.exportCsv': 'تصدير كـ CSV',
	'statusBar.exportJson': 'تصدير كـ JSON',

	// Query History
	'queryHistory.title': 'سجل الاستعلامات',
	'queryHistory.clearAll': 'مسح الكل',
	'queryHistory.searchPlaceholder': 'بحث في الاستعلامات...',
	'queryHistory.justNow': 'الآن',
	'queryHistory.minsAgo': 'منذ {n} دقيقة',
	'queryHistory.hoursAgo': 'منذ {n} ساعة',
	'queryHistory.daysAgo': 'منذ {n} يوم',

	// Schema Panel
	'schema.title': 'المخطط ({count} أعمدة)',

	// Map Viewers
	'map.loadingData': 'جارٍ تحميل بيانات الخريطة...',
	'map.loadingGeometry': 'جارٍ تحميل البيانات الهندسية...',
	'map.loadingPmtiles': 'جارٍ تحميل PMTiles...',
	'map.loadingFgb': 'جارٍ تحميل FlatGeobuf...',
	'map.loadingCog': 'جارٍ تحميل COG...',
	'map.loadingZarr': 'جارٍ تحميل بيانات Zarr...',
	'map.features': 'معالم',
	'map.limit': '(الحد)',
	'map.of': 'من',
	'map.attributes': 'السمات',
	'map.info': 'معلومات',
	'map.archiveInfo': 'معلومات الأرشيف',
	'map.flatgeobufInfo': 'معلومات FlatGeobuf',
	'map.cogInfo': 'معلومات COG',
	'map.cogCorsError':
		'تعذّر تحميل COG: الخادم لا يسمح بطلبات عبر النطاقات (CORS). يجب استضافة الملف مع تفعيل ترويسات CORS.',
	'map.cogUnsupportedFormat':
		'يستخدم هذا الملف صيغة {{type}} غير مدعومة لعرض الخريطة. يمكن عرض ملفات COG بصيغة RGB فقط.',
	'map.noGeoColumn': 'لم يتم اكتشاف عمود هندسي في المخطط',
	'map.noData': 'لا تتوفر بيانات لعرض الخريطة',
	'map.noFeatures': 'لم يتم العثور على معالم في ملف FlatGeobuf',
	'map.layers': 'طبقة',
	'map.layersPlural': 'طبقات',
	'map.tiles': 'بلاطات',
	'map.variable': 'المتغير:',

	// Map info panel labels
	'mapInfo.name': 'الاسم',
	'mapInfo.description': 'الوصف',
	'mapInfo.specVersion': 'إصدار المواصفات',
	'mapInfo.tileFormat': 'تنسيق البلاطة',
	'mapInfo.zoomRange': 'نطاق التكبير',
	'mapInfo.tileCompression': 'ضغط البلاطة',
	'mapInfo.internalCompression': 'الضغط الداخلي',
	'mapInfo.clustered': 'مُجمّع',
	'mapInfo.yes': 'نعم',
	'mapInfo.no': 'لا',
	'mapInfo.addressedTiles': 'البلاطات المُعنونة',
	'mapInfo.tileEntries': 'إدخالات البلاطات',
	'mapInfo.uniqueContents': 'المحتويات الفريدة',
	'mapInfo.bounds': 'الحدود',
	'mapInfo.center': 'المركز',
	'mapInfo.layers': 'الطبقات',
	'mapInfo.attribution': 'الإسناد',
	'mapInfo.dataVersion': 'إصدار البيانات',
	'mapInfo.title': 'العنوان',
	'mapInfo.geometryType': 'نوع الشكل الهندسي',
	'mapInfo.totalFeatures': 'إجمالي المعالم',
	'mapInfo.spatialIndex': 'الفهرس المكاني',
	'mapInfo.yesRTree': 'نعم (شجرة R مضغوطة)',
	'mapInfo.crs': 'نظام الإحداثيات',
	'mapInfo.columns': 'الأعمدة',
	'mapInfo.size': 'الحجم',
	'mapInfo.bands': 'النطاقات',

	// Page
	'page.selectFile': 'اختر ملفاً',
	'page.selectFileDescription': 'تصفح شجرة الملفات على اليمين وانقر على ملف لفتحه.',
	'page.noFileOpen': 'لا يوجد ملف مفتوح',
	'page.noFileDescription':
		'افتح ملف Parquet من الشريط الجانبي، أضف اتصال تخزين سحابي، أو اسحب ملفاً وأفلته للبدء.',
	'page.supportsFormats': 'يدعم تنسيقات Parquet وCSV وArrow IPC',

	// Mobile
	'mobile.openSidebar': 'فتح متصفح الملفات',
	'mobile.fileExplorer': 'مستكشف الملفات',

	// Locale
	'locale.toggle': 'اللغة'
};
