# Archive Browsing via HTTP Range Requests — Research

**Date:** 2026-02-24

---

## 1. ZIP Files

### 1.1 Feasibility: Excellent

ZIP is the ideal format for range-request browsing because the **Central Directory** is located at the **end** of the file. You can list all files with just 2-3 small HTTP requests, regardless of archive size.

### 1.2 How It Works (Byte-Level Algorithm)

```
ZIP file layout:
┌──────────────────────────┐
│  [Local File Header 1]   │  ← data interleaved with headers
│  [File Data 1]           │
│  [Local File Header 2]   │
│  [File Data 2]           │
│  ...                     │
├──────────────────────────┤
│  [Central Directory]     │  ← compact listing of ALL files
│   - filename, offset,    │
│     size, compression,   │
│     CRC, timestamps      │
├──────────────────────────┤
│  [EOCD Record]           │  ← 22 bytes min, at very end
└──────────────────────────┘
```

**Step 1: Fetch EOCD** — Request last ~65KB (max comment = 0xFFFF + 22 bytes = 65,557 bytes):
```
GET /archive.zip
Range: bytes=-65557
```

**Step 2: Scan for EOCD signature** — Search backwards for magic bytes `0x06054b50` (little-endian: `50 4B 05 06`). The EOCD contains:
- Offset 16: Central Directory offset (4 bytes, uint32 LE)
- Offset 12: Central Directory size (4 bytes, uint32 LE)
- Offset 10: Total number of entries (2 bytes, uint16 LE)

**Step 3: Fetch Central Directory** — Single range request:
```
GET /archive.zip
Range: bytes={cd_offset}-{cd_offset + cd_size - 1}
```

**Step 4: Parse Central Directory entries** — Each entry (46 bytes + variable name/extra/comment) contains:
- Filename, compressed/uncompressed size, compression method, CRC-32
- **Local header offset** — used to fetch individual file data later

**Step 5: Extract a single file** — Range request for Local File Header + data:
```
GET /archive.zip
Range: bytes={local_offset}-{local_offset + compressed_size + 30 + name_len}
```

**Total requests to browse:** 2 (EOCD + Central Directory)
**Total requests to extract one file:** 3 (EOCD + CD + file data)

### 1.3 Best JS Libraries

#### A. **unzipit** (Recommended for simplicity)

- **npm:** `unzipit`
- **Size:** <8KB gzipped (no workers), <13KB with workers
- **Performance:** 6x-25x faster than JSZip
- **Browser + Node.js support**
- **Built-in `HTTPRangeReader`** — automatic range-request optimization

```typescript
import { unzip, HTTPRangeReader } from 'unzipit';

// List files in a remote ZIP without downloading it
async function browseRemoteZip(url: string) {
  const reader = new HTTPRangeReader(url);
  const { zip, entries } = await unzip(reader);

  // `entries` is a Record<string, ZipEntry>
  for (const [name, entry] of Object.entries(entries)) {
    console.log(name, {
      size: entry.size,              // uncompressed size
      compressedSize: entry.compressedSize,
      isDirectory: entry.isDirectory,
      lastModDate: entry.lastModDate,
    });
  }

  // Extract a single file on-demand (only downloads that file's bytes)
  const blob = await entries['path/to/file.txt'].blob('text/plain');
  const arrayBuffer = await entries['data.bin'].arrayBuffer();
  const json = await entries['config.json'].json();

  // Non-UTF8 filenames
  // const { entriesArray } = await unzipRaw(reader);
  // const decoder = new TextDecoder('shift_jis');
  // entriesArray.forEach(e => { e.name = decoder.decode(e.nameBytes); });
}
```

**Custom Reader (for auth headers / signed URLs):**
```typescript
import { unzip } from 'unzipit';

class AuthenticatedRangeReader {
  private length: number = 0;

  constructor(private url: string, private headers: Record<string, string> = {}) {}

  async getLength(): Promise<number> {
    if (this.length === 0) {
      const res = await fetch(this.url, { method: 'HEAD', headers: this.headers });
      this.length = Number(res.headers.get('content-length'));
    }
    return this.length;
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    const res = await fetch(this.url, {
      headers: {
        ...this.headers,
        Range: `bytes=${offset}-${offset + length - 1}`,
      },
    });
    return new Uint8Array(await res.arrayBuffer());
  }
}

const reader = new AuthenticatedRangeReader(signedUrl, { Authorization: 'Bearer ...' });
const { entries } = await unzip(reader);
```

**Limitations:**
- No built-in support for CORS headers / credentials on `HTTPRangeReader`
- Read-only (no writing/creating ZIPs)
- No ZIP64 support noted in docs (max 4GB per file, 65535 entries)

---

#### B. **zip.js** (`@zip.js/zip.js`) (Full-featured, larger)

- **npm:** `@zip.js/zip.js` (also on JSR: `@zip-js/zip-js`)
- **Size:** ~45KB+ gzipped (much larger than unzipit)
- **Supports:** Read & write, encryption, ZIP64, split archives, web workers, streams
- **Built-in `HttpRangeReader`**

```typescript
import {
  configure,
  ZipReader,
  HttpRangeReader,
  TextWriter,
  BlobWriter,
  Uint8ArrayWriter,
  Entry,
} from '@zip.js/zip.js';

// Tune chunk size to reduce number of HTTP requests
configure({ chunkSize: 512 * 1024 }); // 512KB chunks

async function browseRemoteZip(url: string) {
  const reader = new ZipReader(new HttpRangeReader(url));
  const entries: Entry[] = await reader.getEntries();

  for (const entry of entries) {
    console.log(entry.filename, {
      uncompressedSize: entry.uncompressedSize,
      compressedSize: entry.compressedSize,
      directory: entry.directory,
      lastModDate: entry.lastModDate,
    });
  }

  // Extract a single file
  if (entries.length > 0 && !entries[0].directory) {
    const text = await entries[0].getData!(new TextWriter());
    console.log(text);
  }

  await reader.close();
}

// Async generator for large ZIPs (avoids loading all entries at once)
async function* streamEntries(url: string) {
  const reader = new ZipReader(new HttpRangeReader(url));
  for await (const entry of reader.getEntriesGenerator()) {
    yield entry;
  }
  await reader.close();
}
```

**With AbortController:**
```typescript
const controller = new AbortController();
const reader = new ZipReader(
  new HttpRangeReader(url, { signal: controller.signal })
);
// Cancel at any time:
// controller.abort();
```

**Key advantages over unzipit:**
- ZIP64 support (files >4GB, >65535 entries)
- Encrypted ZIP support (AES, ZipCrypto)
- `getEntriesGenerator()` for streaming/lazy iteration
- AbortController integration
- Read AND write support

---

#### C. Comparison Table

| Feature                  | unzipit             | zip.js              |
|--------------------------|---------------------|---------------------|
| Bundle size (gzip)       | ~8KB                | ~45KB+              |
| Range request reader     | `HTTPRangeReader`   | `HttpRangeReader`   |
| Custom reader support    | Yes (simple API)    | Yes                 |
| ZIP64                    | No (unconfirmed)    | Yes                 |
| Encryption               | No                  | Yes (AES+ZipCrypto) |
| Write support            | No                  | Yes                 |
| Web Workers              | Yes                 | Yes                 |
| Streaming/generator      | No                  | Yes (`getEntriesGenerator`) |
| AbortController          | No                  | Yes                 |
| Decompression speed      | 6-25x faster than JSZip | Comparable to JSZip |
| API style                | Functional          | Class-based         |

**Recommendation for objex:** Use **unzipit** for its minimal bundle size and simple API. The `HTTPRangeReader` covers the primary use case (browse + extract individual files). If ZIP64 or encrypted ZIPs become requirements, switch to zip.js.

### 1.4 Performance Characteristics

- **Browsing (listing files):** 2 HTTP requests, downloads ~65KB + Central Directory size
  - A 600K-file ZIP has ~55MB Central Directory (worst case)
  - Typical archives with hundreds of files: CD is a few KB to a few hundred KB
- **Extracting one file:** +1 HTTP request, downloads only that file's compressed bytes
- **Server requirement:** Must return `Accept-Ranges: bytes` header and support `206 Partial Content`
- **S3/Azure/GCS:** All support range requests natively

---

## 2. TAR Files (uncompressed `.tar`)

### 2.1 Feasibility: Possible but Expensive

TAR has **no central directory**. Metadata (512-byte headers) is interleaved with file data sequentially. To list all files, you must either:
1. Scan the entire file from start to end (defeats the purpose), or
2. Use an **external index** (COTAR approach), or
3. Use **incremental range-request scanning** (clever but request-heavy)

### 2.2 TAR Header Structure

```
TAR file layout:
┌───────────────────────┐  byte 0
│  Header (512 bytes)   │  ← filename, size, mode, timestamps
│  File Data            │  ← ceil(size / 512) * 512 bytes
├───────────────────────┤
│  Header (512 bytes)   │
│  File Data            │
├───────────────────────┤
│  ...                  │
├───────────────────────┤
│  Two 512-byte blocks  │  ← end-of-archive marker (all zeros)
│  of zero bytes        │
└───────────────────────┘
```

Each 512-byte header contains:
- Offset 0: Filename (100 bytes, null-terminated)
- Offset 100: File mode (8 bytes, octal ASCII)
- Offset 124: File size (12 bytes, octal ASCII)
- Offset 136: Last modification time (12 bytes, octal ASCII)
- Offset 148: Header checksum (8 bytes)
- Offset 156: Type flag (1 byte: '0'=file, '5'=directory, '2'=symlink, etc.)
- Offset 257: UStar magic "ustar\0" (6 bytes)
- Offset 345: Filename prefix (155 bytes, for paths >100 chars)

**Next header offset:** `current_offset + 512 + ceil(file_size / 512) * 512`

### 2.3 Approach A: Incremental Range-Request Scanning

Fetch headers one at a time, skipping over file data:

```typescript
interface TarEntry {
  name: string;
  size: number;
  type: 'file' | 'directory' | 'symlink' | 'other';
  mode: string;
  mtime: Date;
  offset: number;      // byte offset of header in the tar
  dataOffset: number;   // byte offset of file data
}

async function browseTar(url: string): Promise<TarEntry[]> {
  // Get total file size
  const head = await fetch(url, { method: 'HEAD' });
  const totalSize = Number(head.headers.get('content-length'));

  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset < totalSize) {
    // Fetch just the 512-byte header
    const res = await fetch(url, {
      headers: { Range: `bytes=${offset}-${offset + 511}` },
    });
    const headerBuf = new Uint8Array(await res.arrayBuffer());

    // Check for end-of-archive (two zero blocks)
    if (headerBuf.every((b) => b === 0)) break;

    const decoder = new TextDecoder('ascii');
    const name = decoder.decode(headerBuf.slice(0, 100)).replace(/\0+$/, '');
    const prefix = decoder.decode(headerBuf.slice(345, 500)).replace(/\0+$/, '');
    const fullName = prefix ? `${prefix}/${name}` : name;
    const sizeStr = decoder.decode(headerBuf.slice(124, 136)).replace(/\0+$/, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    const mtimeStr = decoder.decode(headerBuf.slice(136, 148)).replace(/\0+$/, '').trim();
    const mtime = new Date(parseInt(mtimeStr, 8) * 1000);
    const typeFlag = String.fromCharCode(headerBuf[156]);

    const type = typeFlag === '5' ? 'directory'
      : typeFlag === '2' ? 'symlink'
      : typeFlag === '0' || typeFlag === '\0' ? 'file'
      : 'other';

    entries.push({
      name: fullName,
      size,
      type,
      mode: decoder.decode(headerBuf.slice(100, 108)).replace(/\0+$/, ''),
      mtime,
      offset,
      dataOffset: offset + 512,
    });

    // Jump to next header: skip header (512) + data (padded to 512-byte boundary)
    const dataBlocks = Math.ceil(size / 512);
    offset += 512 + dataBlocks * 512;
  }

  return entries;
}

// Extract a single file using its recorded offset
async function extractTarFile(url: string, entry: TarEntry): Promise<ArrayBuffer> {
  const res = await fetch(url, {
    headers: {
      Range: `bytes=${entry.dataOffset}-${entry.dataOffset + entry.size - 1}`,
    },
  });
  return res.arrayBuffer();
}
```

**Performance:**
- **N files = N+1 HTTP requests just to list** (1 HEAD + N header fetches)
- Can batch with larger ranges (e.g., fetch 64KB chunks and parse multiple headers)
- Extraction of a single file: 1 additional request (efficient!)

**Batched scanning optimization:**
```typescript
async function browseTarBatched(url: string, chunkSize = 64 * 1024): Promise<TarEntry[]> {
  const head = await fetch(url, { method: 'HEAD' });
  const totalSize = Number(head.headers.get('content-length'));

  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset < totalSize) {
    // Fetch a larger chunk that may contain multiple headers
    const end = Math.min(offset + chunkSize - 1, totalSize - 1);
    const res = await fetch(url, {
      headers: { Range: `bytes=${offset}-${end}` },
    });
    const chunk = new Uint8Array(await res.arrayBuffer());

    let localOffset = 0;
    while (localOffset + 512 <= chunk.length) {
      const header = chunk.slice(localOffset, localOffset + 512);
      if (header.every((b) => b === 0)) { offset = totalSize; break; }

      const decoder = new TextDecoder('ascii');
      const name = decoder.decode(header.slice(0, 100)).replace(/\0+$/, '');
      const sizeStr = decoder.decode(header.slice(124, 136)).replace(/\0+$/, '').trim();
      const size = parseInt(sizeStr, 8) || 0;

      entries.push({
        name,
        size,
        type: 'file',
        mode: '',
        mtime: new Date(),
        offset: offset + localOffset,
        dataOffset: offset + localOffset + 512,
      });

      const dataBlocks = Math.ceil(size / 512);
      const entryTotalSize = 512 + dataBlocks * 512;
      localOffset += entryTotalSize;
    }

    // If we didn't finish parsing within this chunk, advance to where we left off
    offset += localOffset || chunkSize;
  }

  return entries;
}
```

### 2.4 Approach B: COTAR (Cloud Optimised TAR) — Pre-built Index

**npm:** `@cotar/core` + `@cotar/cli`
**Source:** [linz/cotar](https://github.com/linz/cotar)

COTAR appends a binary index to the TAR file (or stores it alongside), enabling **O(1) file lookup** via hash table.

```typescript
import { Cotar } from '@cotar/core';

// The COTAR reader needs a source that supports range reads
const source = {
  // Minimal interface: fetch a range of bytes
  async fetch(offset: number, length: number): Promise<ArrayBuffer> {
    const res = await fetch(url, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` },
    });
    return res.arrayBuffer();
  }
};

const cotar = await Cotar.fromTar(source);
const fileData = await cotar.get('path/to/file.pbf');
```

**Performance:**
- **1 request** to load the index header (8 bytes)
- **1 request** to look up a file in the index (~2KB)
- **1 request** to fetch the file data
- **Total: 3 requests for any random file** in a 100GB+ archive
- Latency: 60-150ms cold, 40-100ms warm (measured on AWS Lambda + S3)

**Limitations:**
- Requires **pre-processing** the TAR with `@cotar/cli` to build the index
- Max archive size: 2TB (uint32 block offsets)
- Max individual file: 4GB
- You cannot browse/list all files — only look up known filenames
- Not a standard format (proprietary index)

### 2.5 Approach C: DIY Index File

Store a sidecar `archive.tar.index.json` alongside the TAR:

```json
{
  "files": [
    { "name": "data/file1.csv", "offset": 512, "size": 104857600 },
    { "name": "data/file2.csv", "offset": 104858624, "size": 52428800 },
    ...
  ]
}
```

Then fetch the index first, display the listing, and use range requests to extract individual files. Simple and effective if you control the server/upload pipeline.

---

## 3. TAR.GZ Files (`.tar.gz` / `.tgz`)

### 3.1 Feasibility: Not Possible (for true random access)

**Gzip is a stream compression format.** The decompressor maintains state that depends on all preceding bytes. You **cannot** seek to an arbitrary position and start decompressing without processing everything before it.

This is a fundamental limitation of DEFLATE-based compression:
- No block boundaries you can seek to
- No index of compressed-to-uncompressed offsets
- The entire stream must be decompressed sequentially

### 3.2 Workarounds

#### A. Download and decompress the entire file (fallback)

```typescript
async function browseTarGz(url: string): Promise<TarEntry[]> {
  const res = await fetch(url);
  const ds = new DecompressionStream('gzip');
  const decompressed = res.body!.pipeThrough(ds);

  // Now parse the decompressed tar stream
  // ... (use a streaming tar parser like `tar-stream` or manual 512-byte parsing)
}
```

This defeats the purpose of range requests but is the only reliable approach for arbitrary .tar.gz files.

#### B. **BGZF** (Block GZip Format) — if you control the compression

BGZF (from htslib/samtools) compresses data in independent ~64KB blocks, each of which is a valid gzip stream. This enables random access by building an index of block boundaries.

- Used extensively in bioinformatics (BAM, CRAM, tabix)
- Each block can be decompressed independently
- An index maps uncompressed offsets to compressed block positions

**Not practical for general .tar.gz files** — only works if the file was originally compressed with bgzip.

#### C. **Indexed gzip** (build index on first pass)

Tools like [rapidgzip](https://github.com/mxmlnkn/rapidgzip) and [indexed_gzip](https://github.com/pauldmccarthy/indexed_gzip) create seek-point indices by memorizing the decompressor's internal state at regular intervals. On subsequent accesses, they can seek to the nearest checkpoint and decompress from there.

**Not practical in the browser** — these are C/Python libraries that require a full first-pass decompression to build the index. No JavaScript equivalent exists.

#### D. Alternative: Use `.tar.zst` (Zstandard) with seekable frames

Zstandard supports a [seekable format](https://github.com/facebook/zstd/blob/dev/contrib/seekable_format/zstd_seekable.h) where the archive is compressed as independent frames with a seek table at the end.

- Each frame can be decompressed independently
- The seek table maps frame boundaries
- Could theoretically enable range-request browsing

**Status:** No mature browser JS library supports seekable zstd frames yet. The `fzstd` library handles basic zstd in JS but not seekable format.

### 3.3 Summary for TAR.GZ

| Approach | Browser-feasible | Random access | Requires preprocessing |
|----------|-----------------|---------------|----------------------|
| Full download + decompress | Yes | No | No |
| BGZF | Theoretically | Yes | Yes (re-compress with bgzip) |
| Indexed gzip | No (C/Python only) | Yes | Yes (first-pass index) |
| `.tar.zst` seekable | Not yet | Yes | Yes (compress with seekable zstd) |

**Recommendation:** For .tar.gz, the only realistic browser approach is to download and decompress the entire file. If the files are large, consider converting to .zip or uncompressed .tar on the server side.

---

## 4. Overall Recommendations for objex

### Tier 1: ZIP (implement now)
- Use **unzipit** with `HTTPRangeReader`
- 2 HTTP requests to list all files, 1 more to extract any file
- Works with S3, Azure Blob, any server supporting range requests
- ~8KB bundle addition

### Tier 2: TAR (implement with caveats)
- Use **incremental range-request scanning** (batched 64KB chunks)
- Good for TARs with reasonable file counts (<1000 files)
- For TARs with many files, warn user about request count
- Extraction of individual files is always efficient (1 range request)

### Tier 3: TAR.GZ (limited support)
- **Cannot browse without full download**
- Show a clear message: "Compressed archives must be fully downloaded to browse"
- Use `DecompressionStream('gzip')` + streaming tar parser
- Consider offering to decompress to an in-memory tar, then browse that

### Architecture sketch for objex viewer

```
ArchiveViewer.svelte
  ├── detectFormat(url, contentType) → 'zip' | 'tar' | 'tar.gz'
  ├── ZipBrowser     → unzipit HTTPRangeReader → file tree + on-demand extract
  ├── TarBrowser     → incremental range scan → file tree + on-demand extract
  └── TarGzBrowser   → full download + DecompressionStream → file tree + extract
```

---

## Sources

- [Listing ZIP contents without downloading (rhardih.io)](https://rhardih.io/2021/04/listing-the-contents-of-a-remote-zip-archive-without-downloading-the-entire-file/)
- [unzipit — GitHub](https://github.com/greggman/unzipit)
- [unzipit — npm](https://www.npmjs.com/package/unzipit)
- [zip.js — GitHub](https://github.com/gildas-lormeau/zip.js)
- [zip.js HttpRangeReader discussion #505](https://github.com/gildas-lormeau/zip.js/discussions/505)
- [zip.js ZipReader API docs](https://gildas-lormeau.github.io/zip.js/api/classes/ZipReader.html)
- [COTAR — Cloud Optimised TAR (linz/cotar)](https://github.com/linz/cotar)
- [@cotar/core — npm](https://www.npmjs.com/package/@cotar/core)
- [ZIP file format — Wikipedia](https://en.wikipedia.org/wiki/ZIP_(file_format))
- [ZIP technical overview (vadeen.com)](https://www.vadeen.com/posts/the-zip-file-format/)
- [GNU tar format internals](https://www.gnu.org/software/tar/manual/html_chapter/Tar-Internals.html)
- [TAR format — OSDev Wiki](https://wiki.osdev.org/Tar)
- [rapidgzip — parallel gzip with random access](https://github.com/mxmlnkn/rapidgzip)
- [indexed_gzip — Python random access gzip](https://github.com/pauldmccarthy/indexed_gzip)
- [ratarmount — mount archives as filesystems](https://github.com/mxmlnkn/ratarmount)
- [PMTiles — cloud-optimized tile archives](https://docs.protomaps.com/pmtiles/)
- [HTTP Range Requests — MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests)
