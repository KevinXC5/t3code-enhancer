/**
 * 零依赖 ASAR 读写、完整性校验与 Info.plist 更新引擎
 * 仅依赖 Node.js 标准库（兼容 ELECTRON_RUN_AS_NODE=1）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const DEFAULT_BLOCK_SIZE = 4 * 1024 * 1024; // 4 MiB，与 @electron/asar 默认分块一致

/**
 * 计算单个文件内容对应的 Electron ASAR integrity 对象
 * @param {Buffer} buf
 * @param {number} [blockSize]
 */
export function computeFileIntegrity(buf, blockSize = DEFAULT_BLOCK_SIZE) {
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const blocks = [];
  if (buf.length === 0) {
    // Electron ASAR 对 0 字节文件也会保留 1 个空数据的 SHA-256 块
    blocks.push(hash);
  } else {
    for (let offset = 0; offset < buf.length; offset += blockSize) {
      const end = Math.min(offset + blockSize, buf.length);
      const blockHash = crypto.createHash('sha256').update(buf.subarray(offset, end)).digest('hex');
      blocks.push(blockHash);
    }
  }
  return {
    algorithm: 'SHA256',
    hash,
    blockSize,
    blocks,
  };
}

/**
 * 严格按 Chromium Pickle 格式编码 ASAR Header
 * 布局：
 *   [0..3]   uint32LE = 4 (外层 sizePickle payload 大小)
 *   [4..7]   uint32LE = headerPickleSize (内层 headerPickle 总字节数，4 字节对齐)
 *   [8..11]  uint32LE = headerPayloadSize (= 4 + headerStringByteLen)
 *   [12..15] uint32LE = headerStringByteLen
 *   [16..]   headerString UTF-8 字节 + (0..3 字节 0x00 对齐填充)
 *
 * @param {object} headerObj
 */
export function createAsarHeaderPickle(headerObj) {
  const headerString = JSON.stringify(headerObj);
  const strBuf = Buffer.from(headerString, 'utf8');
  const strLen = strBuf.length;
  // Chromium Pickle 写入 string 后按 4 字节边界补零
  const alignedStrLen = (strLen + 3) & ~3;
  const headerPayloadSize = 4 + strLen;
  const headerPickleSize = 4 + 4 + alignedStrLen; // payloadSize(4) + strLen(4) + alignedStr

  const prefixBuf = Buffer.alloc(8 + headerPickleSize, 0);
  prefixBuf.writeUInt32LE(4, 0);
  prefixBuf.writeUInt32LE(headerPickleSize, 4);
  prefixBuf.writeUInt32LE(headerPayloadSize, 8);
  prefixBuf.writeUInt32LE(strLen, 12);
  strBuf.copy(prefixBuf, 16);

  const headerHash = crypto.createHash('sha256').update(headerString, 'utf8').digest('hex');
  return {
    prefixBuf,
    headerString,
    headerHash,
    headerPickleSize,
    dataOffset: prefixBuf.length,
  };
}

/**
 * 解析 ASAR 文件头（只读，不加载文件体）
 * @param {string} asarPath
 */
export function parseAsarHeader(asarPath) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const prefix = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, prefix, 0, 16, 0);
    if (bytesRead < 16) {
      throw new Error(`无效的 ASAR 文件（文件头不足 16 字节）：${asarPath}`);
    }
    const sizePicklePayload = prefix.readUInt32LE(0);
    const headerPickleSize = prefix.readUInt32LE(4);
    const headerPayloadSize = prefix.readUInt32LE(8);
    const headerStringLen = prefix.readUInt32LE(12);

    if (sizePicklePayload !== 4 || headerStringLen === 0 || headerPickleSize < headerStringLen + 8) {
      throw new Error(
        `ASAR Pickle 头异常：sizePayload=${sizePicklePayload}, headerPickleSize=${headerPickleSize}, strLen=${headerStringLen}`
      );
    }

    const headerBuf = Buffer.alloc(headerStringLen);
    const readHeader = fs.readSync(fd, headerBuf, 0, headerStringLen, 16);
    if (readHeader !== headerStringLen) {
      throw new Error(`ASAR Header 读取不完整：期望 ${headerStringLen}，实际 ${readHeader}`);
    }

    const headerString = headerBuf.toString('utf8');
    const headerHash = crypto.createHash('sha256').update(headerString, 'utf8').digest('hex');
    const header = JSON.parse(headerString);
    const dataOffset = 8 + headerPickleSize;

    return {
      header,
      headerString,
      headerHash,
      headerPickleSize,
      headerPayloadSize,
      headerStringLen,
      dataOffset,
    };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 递归遍历 ASAR header 中的所有文件条目
 */
function walkHeaderTree(node, prefix = '', out = []) {
  if (!node || typeof node !== 'object' || !node.files) return out;
  for (const [name, child] of Object.entries(node.files)) {
    const relPath = prefix ? `${prefix}/${name}` : name;
    if (child && typeof child === 'object' && child.files) {
      walkHeaderTree(child, relPath, out);
    } else {
      out.push({ path: relPath, meta: child });
    }
  }
  return out;
}

/**
 * 按路径查找或创建 header 中的文件节点
 */
function getHeaderEntry(header, relPath) {
  const segments = relPath.replace(/^\/+/, '').split('/');
  let cur = header;
  for (const seg of segments) {
    if (!cur || !cur.files || !Object.prototype.hasOwnProperty.call(cur.files, seg)) {
      return null;
    }
    cur = cur.files[seg];
  }
  return cur;
}

/**
 * 流式从 srcFd 拷贝一段字节到 dstFd，避免大文件占满内存
 */
function copyFdRange(srcFd, srcPos, dstFd, length, copyBuf) {
  let remaining = length;
  let readPos = srcPos;
  while (remaining > 0) {
    const chunkLen = Math.min(remaining, copyBuf.length);
    const n = fs.readSync(srcFd, copyBuf, 0, chunkLen, readPos);
    if (n <= 0) {
      throw new Error(`ASAR 拷贝源数据提前到达 EOF（偏移=${readPos}，剩余=${remaining}）`);
    }
    let written = 0;
    while (written < n) {
      written += fs.writeSync(dstFd, copyBuf, written, n - written);
    }
    readPos += n;
    remaining -= n;
  }
}

/**
 * ASAR 存档封装类：支持只读检索与流式重打包
 */
export class AsarArchive {
  constructor(asarPath) {
    this.asarPath = asarPath;
    const parsed = parseAsarHeader(asarPath);
    this.header = parsed.header;
    this.headerString = parsed.headerString;
    this.headerHash = parsed.headerHash;
    this.dataOffset = parsed.dataOffset;
    this.entries = walkHeaderTree(this.header);
    this.entryMap = new Map(this.entries.map((item) => [item.path, item.meta]));
    this._fd = fs.openSync(asarPath, 'r');
  }

  close() {
    if (this._fd !== null) {
      fs.closeSync(this._fd);
      this._fd = null;
    }
  }

  listFiles() {
    return this.entries;
  }

  hasFile(relPath) {
    return this.entryMap.has(relPath.replace(/^\/+/, ''));
  }

  getMeta(relPath) {
    return this.entryMap.get(relPath.replace(/^\/+/, '')) ?? null;
  }

  findFiles(predicate) {
    return this.entries.filter(predicate);
  }

  readFile(relPath) {
    const normalized = relPath.replace(/^\/+/, '');
    const meta = this.entryMap.get(normalized);
    if (!meta) {
      throw new Error(`ASAR 中不存在文件：${normalized}`);
    }
    if (meta.unpacked) {
      const unpackedPath = path.join(`${this.asarPath}.unpacked`, normalized);
      return fs.readFileSync(unpackedPath);
    }
    if (meta.link) {
      throw new Error(`暂不支持直接读取符号链接条目：${normalized} -> ${meta.link}`);
    }
    const size = Number(meta.size ?? 0);
    const offset = Number(meta.offset ?? 0);
    const buf = Buffer.alloc(size);
    if (size > 0) {
      const bytesRead = fs.readSync(this._fd, buf, 0, size, this.dataOffset + offset);
      if (bytesRead !== size) {
        throw new Error(`读取 ASAR 条目 ${normalized} 长度异常：期望 ${size}，实际 ${bytesRead}`);
      }
    }
    return buf;
  }

  readText(relPath) {
    return this.readFile(relPath).toString('utf8');
  }

  /**
   * 应用补丁映射并流式写出新的 ASAR 文件（原子替换）
   * @param {string} outputPath 输出 ASAR 路径（允许与源路径相同）
   * @param {Map<string, Buffer|string>} replacements 相对路径 -> 新内容
   */
  writePatched(outputPath, replacements) {
    const normalizedMap = new Map();
    for (const [k, v] of replacements.entries()) {
      const rel = k.replace(/^\/+/, '');
      const buf = Buffer.isBuffer(v) ? v : Buffer.from(String(v), 'utf8');
      normalizedMap.set(rel, buf);
    }

    // 深拷贝 header，准备重新分配 offset 与更新修改条目的 integrity
    const newHeader = structuredClone(this.header);
    const writePlan = []; // 按写入顺序排列的打包数据计划
    let nextOffset = 0;

    const visit = (node, prefix = '') => {
      if (!node || !node.files) return;
      for (const [name, child] of Object.entries(node.files)) {
        const relPath = prefix ? `${prefix}/${name}` : name;
        if (child && typeof child === 'object' && child.files) {
          visit(child, relPath);
          continue;
        }
        if (child.link) {
          continue;
        }
        if (child.unpacked) {
          if (normalizedMap.has(relPath)) {
            throw new Error(`暂不支持通过 ASAR 替换 unpacked 文件：${relPath}`);
          }
          continue;
        }

        if (normalizedMap.has(relPath)) {
          const buf = normalizedMap.get(relPath);
          const blockSize = child.integrity?.blockSize ?? DEFAULT_BLOCK_SIZE;
          child.size = buf.length;
          child.offset = String(nextOffset);
          if (child.integrity) {
            child.integrity = computeFileIntegrity(buf, blockSize);
          }
          writePlan.push({ kind: 'buffer', path: relPath, buf });
          nextOffset += buf.length;
        } else {
          const origMeta = this.entryMap.get(relPath);
          const size = Number(origMeta.size ?? 0);
          const origOffset = Number(origMeta.offset ?? 0);
          child.offset = String(nextOffset);
          writePlan.push({ kind: 'copy', path: relPath, srcOffset: origOffset, size });
          nextOffset += size;
        }
      }
    };

    visit(newHeader);

    // 确认所有替换目标均存在于 ASAR 中（防止拼错路径静默失败）
    for (const relPath of normalizedMap.keys()) {
      if (!getHeaderEntry(newHeader, relPath)) {
        throw new Error(`替换目标不存在于 ASAR 中：${relPath}`);
      }
    }

    const { prefixBuf, headerHash, dataOffset } = createAsarHeaderPickle(newHeader);
    const tmpPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
    const dstFd = fs.openSync(tmpPath, 'w', 0o644);
    const copyBuf = Buffer.allocUnsafe(2 * 1024 * 1024); // 2 MiB 拷贝缓冲

    try {
      // 1. 写入 Pickle Header
      let headerWritten = 0;
      while (headerWritten < prefixBuf.length) {
        headerWritten += fs.writeSync(dstFd, prefixBuf, headerWritten, prefixBuf.length - headerWritten);
      }

      // 2. 按顺序写入文件体
      for (const item of writePlan) {
        if (item.kind === 'buffer') {
          let w = 0;
          while (w < item.buf.length) {
            w += fs.writeSync(dstFd, item.buf, w, item.buf.length - w);
          }
        } else if (item.size > 0) {
          copyFdRange(this._fd, this.dataOffset + item.srcOffset, dstFd, item.size, copyBuf);
        }
      }

      fs.fsyncSync(dstFd);
    } catch (err) {
      fs.closeSync(dstFd);
      try {
        fs.unlinkSync(tmpPath);
      } catch {}
      throw err;
    }

    fs.closeSync(dstFd);
    fs.renameSync(tmpPath, outputPath);

    return {
      headerHash,
      dataOffset,
      bytesWritten: dataOffset + nextOffset,
      modifiedFiles: [...normalizedMap.keys()],
      totalFiles: this.entries.length,
    };
  }
}

/**
 * 校验 ASAR 文件结构与完整性
 * @param {string} asarPath
 * @param {{ expectedHeaderHash?: string, verifyPaths?: string[] }} [options]
 */
export function verifyAsar(asarPath, options = {}) {
  const { expectedHeaderHash, verifyPaths = [] } = options;
  const stat = fs.statSync(asarPath);
  const archive = new AsarArchive(asarPath);
  try {
    if (expectedHeaderHash && archive.headerHash !== expectedHeaderHash) {
      throw new Error(
        `ASAR Header SHA-256 校验不匹配：期望 ${expectedHeaderHash}，实际 ${archive.headerHash}`
      );
    }

    let maxEnd = archive.dataOffset;
    for (const { path: relPath, meta } of archive.listFiles()) {
      if (meta.unpacked || meta.link) continue;
      const offset = Number(meta.offset ?? 0);
      const size = Number(meta.size ?? 0);
      const end = archive.dataOffset + offset + size;
      if (!Number.isFinite(offset) || !Number.isFinite(size) || end > stat.size) {
        throw new Error(`ASAR 条目越界：${relPath} (end=${end}, fileSize=${stat.size})`);
      }
      if (end > maxEnd) maxEnd = end;
    }

    const verifiedFiles = [];
    for (const relPath of verifyPaths) {
      const normalized = relPath.replace(/^\/+/, '');
      const meta = archive.getMeta(normalized);
      if (!meta) {
        throw new Error(`待校验条目缺失：${normalized}`);
      }
      const buf = archive.readFile(normalized);
      if (buf.length !== Number(meta.size)) {
        throw new Error(`条目长度不匹配：${normalized}`);
      }
      if (meta.integrity) {
        const actual = computeFileIntegrity(buf, meta.integrity.blockSize ?? DEFAULT_BLOCK_SIZE);
        if (actual.hash !== meta.integrity.hash) {
          throw new Error(`条目 SHA-256 校验失败：${normalized}`);
        }
        if (JSON.stringify(actual.blocks) !== JSON.stringify(meta.integrity.blocks)) {
          throw new Error(`条目分块 SHA-256 校验失败：${normalized}`);
        }
      }
      verifiedFiles.push(normalized);
    }

    return {
      ok: true,
      headerHash: archive.headerHash,
      fileSize: stat.size,
      totalFiles: archive.listFiles().length,
      verifiedFiles,
    };
  } finally {
    archive.close();
  }
}

/**
 * 读取 Info.plist 中的 ElectronAsarIntegrity -> Resources/app.asar -> hash
 */
export function readPlistAsarIntegrity(infoPlistPath) {
  try {
    const out = execFileSync(
      '/usr/libexec/PlistBuddy',
      ['-c', 'Print :ElectronAsarIntegrity:Resources/app.asar:hash', infoPlistPath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return out.trim();
  } catch {
    return null;
  }
}

/**
 * 更新 Info.plist 中的 ElectronAsarIntegrity -> Resources/app.asar -> hash
 */
export function updatePlistAsarIntegrity(infoPlistPath, newHeaderHash) {
  const existing = readPlistAsarIntegrity(infoPlistPath);
  if (!existing) {
    // 某些开发版未启用 ElectronAsarIntegrity，跳过但不报错
    return { updated: false, previousHash: null, newHash: newHeaderHash };
  }
  execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', `Set :ElectronAsarIntegrity:Resources/app.asar:hash ${newHeaderHash}`, infoPlistPath],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const after = readPlistAsarIntegrity(infoPlistPath);
  if (after !== newHeaderHash) {
    throw new Error(`Info.plist 哈希写入校验失败：期望 ${newHeaderHash}，实际 ${after}`);
  }
  return { updated: true, previousHash: existing, newHash: after };
}
