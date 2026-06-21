const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const { execFile } = require('child_process');
const chokidar = require('chokidar');
const tar = require('tar');
const { Readable } = require('stream');

const COMPRESSIBLE_EXTS = new Set([
  '.txt', '.docx', '.xlsx', '.csv', '.json',
  '.html', '.md', '.log', '.pdf', '.jpg', '.png'
]);
const MAX_COMPRESS_BYTES = 2 * 1024 * 1024 * 1024;
const USB_POLL_MS = 5000;

let mainWindow = null;
let activeStreams = new Set();
let folderConfigs = [];
let isWatching = false;
let usbPollInterval = null;
let savedUsbSignatures = [];
let lastPromptedDrive = null;
let promptDebounceTimer = null;
let lastUsbMatchedDrives = [];

function getConfigForSource(sourcePath) {
  if (!sourcePath) return null;
  return folderConfigs.find(c => path.resolve(c.source) === path.resolve(sourcePath));
}

function deriveKey(password) {
  return crypto.createHash('sha256').update(password).digest();
}

function encryptBuffer(buffer, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return { iv, encrypted, compressed: false };
}

function encryptBufferCompressed(buffer, key) {
  const compressed = zlib.gzipSync(buffer);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return { iv, encrypted, compressed: true };
}

function decryptVaultToBuffer(filePath, key) {
  const data = fs.readFileSync(filePath);
  if (data.length < 17) throw new Error('Invalid vault file: too small');
  const iv = data.subarray(0, 16);
  const flags = data.readUInt8(16);
  const ciphertext = data.subarray(17);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const isCompressed = (flags & 0x01) !== 0;
  if (isCompressed) decrypted = zlib.gunzipSync(decrypted);
  const isTar = (flags & 0x02) !== 0;
  return { buffer: decrypted, isTar };
}

function sendLog(level, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', { level, message, timestamp: new Date().toISOString() });
  }
}

function sendUsbEvent(event) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('usb-event', event);
  }
}

// ====== TAR-BASED FOLDER VAULT ======

async function createTarGzBuffer(srcDir) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const packStream = tar.c({ gzip: true, cwd: srcDir }, ['.']);
    packStream.on('data', c => chunks.push(c));
    packStream.on('end', () => resolve(Buffer.concat(chunks)));
    packStream.on('error', reject);
  });
}

async function extractTarGzBuffer(buffer, outputDir) {
  return new Promise((resolve, reject) => {
    const readStream = Readable.from(buffer);
    const extractStream = tar.x({ cwd: outputDir });
    readStream.pipe(extractStream);
    extractStream.on('finish', resolve);
    extractStream.on('error', reject);
  });
}

async function packFolderToVault(srcDir, key) {
  sendLog('info', 'Packing folder into archive...');
  const tarGzBuffer = await createTarGzBuffer(srcDir);
  sendLog('info', `Archive created (${formatBytes(tarGzBuffer.length)}), encrypting...`);
  const result = encryptBufferCompressed(tarGzBuffer, key);
  return { iv: result.iv, encrypted: result.encrypted, compressed: result.compressed };
}

async function unpackVaultToFolder(vaultPath, key, outputDir) {
  const { buffer, isTar } = decryptVaultToBuffer(vaultPath, key);
  const baseName = path.basename(vaultPath, '.vault');
  if (isTar) {
    sendLog('info', `Decrypted ${path.basename(vaultPath)}, extracting folder...`);
    const finalDir = path.join(outputDir, baseName);
    if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });
    await extractTarGzBuffer(buffer, finalDir);
  } else {
    sendLog('info', `Decrypted ${path.basename(vaultPath)}, writing file...`);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, baseName), buffer);
  }
}

// ====== SYNC MANIFEST ======

function getManifestPath(sourcePath) {
  const cfg = getConfigForSource(sourcePath);
  if (!cfg || !cfg.targetDir) return null;
  const name = path.basename(sourcePath || 'backup');
  return path.join(cfg.targetDir, `${name}.manifest.json`);
}

function loadManifest(sourcePath) {
  const mPath = getManifestPath(sourcePath);
  if (!mPath) return null;
  try {
    if (fs.existsSync(mPath)) {
      return JSON.parse(fs.readFileSync(mPath, 'utf-8'));
    }
  } catch (_) {}
  return null;
}

function saveManifest(sourcePath, fileCount, totalSize, fileEntries) {
  const mPath = getManifestPath(sourcePath);
  if (!mPath) return;
  const cfg = getConfigForSource(sourcePath);
  const name = path.basename(sourcePath || 'backup');
  const manifest = {
    lastSync: new Date().toISOString(),
    sourceDirName: name,
    fileCount,
    totalSize,
    files: fileEntries
  };
  try {
    const dir = path.dirname(mPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2));
  } catch (_) {}
}

function getVaultFilePath(sourcePath) {
  const cfg = getConfigForSource(sourcePath);
  if (!cfg || !cfg.targetDir) return null;
  const name = path.basename(sourcePath);
  return path.join(cfg.targetDir, `${name}.vault`);
}

function checkChangesForSource(sourcePath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return { hasChanges: false, changedFiles: [], fileCount: 0 };
  const manifest = loadManifest(sourcePath);
  const changedFiles = [];
  let totalCount = 0;
  let isDir;
  try { isDir = fs.statSync(sourcePath).isDirectory(); }
  catch { return { hasChanges: false, changedFiles: [], fileCount: 0 }; }

  if (isDir) {
    function walkDir(dir, relPrefix) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { return; }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fullPath = path.join(dir, entry.name);
        const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) { walkDir(fullPath, relPath); }
        else if (entry.isFile()) {
          totalCount++;
          const stat = fs.statSync(fullPath);
          const me = manifest && manifest.files ? manifest.files[relPath] : null;
          if (!me || me.mtime !== stat.mtimeMs || me.size !== stat.size) changedFiles.push(relPath);
        }
      }
    }
    walkDir(sourcePath, '');
  } else {
    totalCount = 1;
    const fname = path.basename(sourcePath);
    const stat = fs.statSync(sourcePath);
    const me = manifest && manifest.files ? manifest.files[fname] : null;
    if (!me || me.mtime !== stat.mtimeMs || me.size !== stat.size) changedFiles.push(fname);
  }
  return { hasChanges: changedFiles.length > 0, changedFiles, fileCount: totalCount };
}

async function syncSource(sourcePath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) { sendLog('warn', `Source path does not exist: ${sourcePath}`); return; }
  const cfg = getConfigForSource(sourcePath);
  if (!cfg) return;
  const targetDir = cfg.targetDir;
  const enableEncryption = cfg.enableEncryption;
  const enableCompression = cfg.enableCompression;

  if (!targetDir || !fs.existsSync(targetDir)) { sendLog('error', `Target directory does not exist for ${sourcePath}`); return; }

  const isDir = fs.statSync(sourcePath).isDirectory();
  const srcName = path.basename(sourcePath);

  if (enableEncryption) {
    if (!cfg.password || cfg.password.trim().length === 0) { 
      sendLog('error', `Password is required for encrypted backup of ${srcName}. Skipping...`); 
      return; 
    }
    const folderKey = deriveKey(cfg.password);
    sendLog('info', `Encrypting ${isDir ? 'folder' : 'file'}: ${srcName}`);

    const vaultPath = getVaultFilePath(sourcePath);
    let fileCount = 0, totalSize = 0;
    const fileEntries = {};

    if (isDir) {
      function walkDir(dir, rp) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const e of entries) {
          if (e.name.startsWith('.') || e.name === 'node_modules') continue;
          const fp = path.join(dir, e.name);
          const r = rp ? `${rp}/${e.name}` : e.name;
          if (e.isDirectory()) { walkDir(fp, r); }
          else if (e.isFile()) {
            fileCount++;
            const s = fs.statSync(fp);
            totalSize += s.size;
            fileEntries[r] = { mtime: s.mtimeMs, size: s.size };
          }
        }
      }
      walkDir(sourcePath, '');
      const { iv, encrypted } = await packFolderToVault(sourcePath, folderKey);
      const vc = Buffer.concat([iv, Buffer.from([0x03]), encrypted]);
      const d = path.dirname(vaultPath);
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(vaultPath, vc);
      saveManifest(sourcePath, fileCount, totalSize, fileEntries);
      sendLog('success', `Vault written: ${path.basename(vaultPath)} (${formatBytes(vc.length)})`);
    } else {
      fileCount = 1;
      const s = fs.statSync(sourcePath);
      totalSize = s.size;
      const fname = path.basename(sourcePath);
      fileEntries[fname] = { mtime: s.mtimeMs, size: s.size };
      const buf = fs.readFileSync(sourcePath);
      const ext = path.extname(sourcePath).toLowerCase();
      let result;
      if (COMPRESSIBLE_EXTS.has(ext) && buf.length < MAX_COMPRESS_BYTES) {
        result = encryptBufferCompressed(buf, folderKey); result.flags = 0x01;
      } else {
        result = encryptBuffer(buf, folderKey); result.flags = 0x00;
      }
      const vc = Buffer.concat([result.iv, Buffer.from([result.flags]), result.encrypted]);
      const d = path.dirname(vaultPath);
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(vaultPath, vc);
      saveManifest(sourcePath, 1, totalSize, fileEntries);
      sendLog('success', `Vault written: ${path.basename(vaultPath)} (${formatBytes(vc.length)})`);
    }
  } else if (!enableEncryption && enableCompression) {
    if (isDir) {
      sendLog('info', `Compressing folder: ${srcName}`);
      const tarGz = await createTarGzBuffer(sourcePath);
      const outPath = path.join(targetDir, srcName + '.tar.gz');
      const d = path.dirname(outPath);
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(outPath, tarGz);
      sendLog('success', `Archive: ${path.basename(outPath)} (${formatBytes(tarGz.length)})`);
    } else {
      sendLog('info', `Compressing file: ${srcName}`);
      const buf = fs.readFileSync(sourcePath);
      const compressed = zlib.gzipSync(buf);
      const outPath = path.join(targetDir, srcName + '.gz');
      const d = path.dirname(outPath);
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(outPath, compressed);
      sendLog('success', `Compressed: ${path.basename(outPath)} (${formatBytes(compressed.length)})`);
    }
  } else {
    if (isDir) {
      sendLog('info', `Copying folder: ${srcName}`);
      let count = 0;
      function walkDir(dir) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const e of entries) {
          if (e.name.startsWith('.') || e.name === 'node_modules') continue;
          const fp = path.join(dir, e.name);
          if (e.isDirectory()) { walkDir(fp); }
          else if (e.isFile()) {
            const rp = path.relative(sourcePath, fp);
            const dest = path.join(targetDir, srcName, rp);
            const d = path.dirname(dest);
            if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
            fs.copyFileSync(fp, dest);
            count++;
          }
        }
      }
      walkDir(sourcePath);
      sendLog('success', `Copied ${count} files to ${srcName}/`);
    } else {
      sendLog('info', `Copying file: ${srcName}`);
      const dest = path.join(targetDir, srcName);
      const d = path.dirname(dest);
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      fs.copyFileSync(sourcePath, dest);
      sendLog('success', `Copied: ${srcName}`);
    }
  }
}

async function checkForChanges(foldersToCheck = folderConfigs) {
  if (foldersToCheck.length === 0) return { hasChanges: false, changedFiles: [], fileCount: 0 };
  let allChanged = [], allCount = 0;
  for (const cfg of foldersToCheck) {
    const r = checkChangesForSource(cfg.source);
    allChanged = allChanged.concat(r.changedFiles);
    allCount += r.fileCount;
  }
  return { hasChanges: allChanged.length > 0, changedFiles: allChanged, fileCount: allCount };
}

async function runFullSync(foldersToSync = folderConfigs) {
  if (foldersToSync.length === 0) return;
  for (const cfg of foldersToSync) {
    if (cfg.isActive) {
      await syncSource(cfg.source);
    }
  }
}

// ====== USB DETECTION (Windows) ======

function detectUsbDrives() {
  return new Promise((resolve) => {
    const script = [
      '$drives = Get-CimInstance Win32_DiskDrive | Where-Object { $_.InterfaceType -eq \'USB\' -or $_.PNPDeviceId -like \'*USB*\' }',
      '$result = @()',
      'foreach ($disk in $drives) {',
      '  $pnpId = $disk.PNPDeviceId',
      '  $parts = $pnpId -split \'\\\\\'',
      '  $serial = if ($parts.Count -ge 3) { $parts[-1] } else { \'\' }',
      '  $cleanSerial = $serial -replace \'&\\d+$\', \'\'',
      '  $usbVid = \'\'; $usbPid = \'\'',
      '  $parentDevices = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPDeviceID -like \'USB\\VID_*\' -and $_.PNPDeviceID -like "*$cleanSerial*" })',
      '  if ($parentDevices.Count -gt 0) {',
      '    $parentPnpId = $parentDevices[0].PNPDeviceID',
      '    $parentIdPart = ($parentPnpId -split \'\\\\\')[1]',
      '    if ($parentIdPart -match \'VID_([0-9A-Fa-f]+)\') { $usbVid = $matches[1] }',
      '    if ($parentIdPart -match \'PID_([0-9A-Fa-f]+)\') { $usbPid = $matches[1] }',
      '  }',
      '  $letters = @()',
      '  $partsAssoc = @(Get-CimAssociatedInstance -InputObject $disk -ResultClassName Win32_DiskPartition -ErrorAction SilentlyContinue)',
      '  foreach ($part in $partsAssoc) {',
      '    $ldAssoc = @(Get-CimAssociatedInstance -InputObject $part -ResultClassName Win32_LogicalDisk -ErrorAction SilentlyContinue)',
      '    foreach ($ld in $ldAssoc) { $letters += $ld.DeviceID }',
      '  }',
      '  $result += [PSCustomObject]@{',
      '    Model=$disk.Model; Serial=$cleanSerial; VID=$usbVid; PID=$usbPid',
      '    DriveLetters=($letters | Select-Object -Unique) -join \',\'',
      '    Size=$disk.Size',
      '  }',
      '}',
      'if ($result.Count -eq 0) {',
      '  $remDrives = Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 2 }',
      '  foreach ($rem in $remDrives) {',
      '    $result += [PSCustomObject]@{ Model="Removable Drive"; Serial=""; VID=""; PID=""; DriveLetters=$rem.DeviceID; Size=$rem.Size }',
      '  }',
      '}',
      'if ($result.Count -eq 0) { Write-Output \'[]\'; return }',
      '$json = $result | ConvertTo-Json -Compress',
      'Write-Output $json'
    ].join('\n');
    execFile('powershell.exe', ['-NoProfile', '-Command', script], {
      timeout: 15000,
      windowsHide: true
    }, (err, stdout) => {
      if (err) { resolve([]); return; }
      try {
        const drives = JSON.parse(stdout.trim());
        resolve(Array.isArray(drives) ? drives : [drives]);
      } catch { resolve([]); }
    });
  });
}

async function findUsbDriveForPath(targetPath) {
  const resolved = path.resolve(targetPath);
  const parsed = path.parse(resolved);
  const driveLetter = parsed.root.replace(/\\/g, '');
  if (!driveLetter) return null;

  return new Promise((resolve) => {
    const driveLetterDecl = `$driveLetter = '${driveLetter}'`;
    const script = [
      driveLetterDecl,
      'try {',
      '  $ld = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID=\'$driveLetter\'" -ErrorAction Stop',
      '  if (!$ld) { Write-Output \'null\'; return }',
      '  $parts = @(Get-CimAssociatedInstance -InputObject $ld -ResultClassName Win32_DiskPartition -ErrorAction SilentlyContinue)',
      '  if ($parts.Count -eq 0) {',
      '    if ($ld.DriveType -eq 2) {',
      '      $result = [PSCustomObject]@{ Model="Removable Drive"; Serial=""; VID=""; PID=""; DriveLetters=$driveLetter; Size=$ld.Size }',
      '      Write-Output ($result | ConvertTo-Json -Compress)',
      '      return',
      '    }',
      '    Write-Output \'null\'; return',
      '  }',
      '  $disk = @(Get-CimAssociatedInstance -InputObject $parts[0] -ResultClassName Win32_DiskDrive -ErrorAction SilentlyContinue)[0]',
      '  if (!$disk) {',
      '    if ($ld.DriveType -eq 2) {',
      '      $result = [PSCustomObject]@{ Model="Removable Drive"; Serial=""; VID=""; PID=""; DriveLetters=$driveLetter; Size=$ld.Size }',
      '      Write-Output ($result | ConvertTo-Json -Compress)',
      '      return',
      '    }',
      '    Write-Output \'null\'; return',
      '  }',
      '  $isUsb = ($disk.InterfaceType -eq \'USB\') -or ($disk.PNPDeviceId -like \'*USB*\') -or ($ld.DriveType -eq 2)',
      '  if (!$isUsb) { Write-Output \'null\'; return }',
      '  $pnpId = $disk.PNPDeviceId',
      '  $partsPNP = $pnpId -split \'\\\\\'',
      '  $serial = if ($partsPNP.Count -ge 3) { $partsPNP[-1] } else { \'\' }',
      '  $cleanSerial = $serial -replace \'&\\d+$\', \'\'',
      '  $usbVid = \'\'; $usbPid = \'\'',
      '  $parentDevices = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPDeviceID -like \'USB\\VID_*\' -and $_.PNPDeviceID -like "*$cleanSerial*" })',
      '  if ($parentDevices.Count -gt 0) {',
      '    $parentPnpId = $parentDevices[0].PNPDeviceID',
      '    $parentIdPart = ($parentPnpId -split \'\\\\\')[1]',
      '    if ($parentIdPart -match \'VID_([0-9A-Fa-f]+)\') { $usbVid = $matches[1] }',
      '    if ($parentIdPart -match \'PID_([0-9A-Fa-f]+)\') { $usbPid = $matches[1] }',
      '  }',
      '  $result = [PSCustomObject]@{ Model=$disk.Model; Serial=$cleanSerial; VID=$usbVid; PID=$usbPid; DriveLetters=$driveLetter; Size=if ($disk.Size) { $disk.Size } else { $ld.Size } }',
      '  Write-Output ($result | ConvertTo-Json -Compress)',
      '} catch { Write-Output \'null\' }'
    ].join('\n');
    execFile('powershell.exe', ['-NoProfile', '-Command', script], {
      timeout: 15000,
      windowsHide: true
    }, (err, stdout) => {
      if (err) { resolve(null); return; }
      try {
        const trimmed = stdout.trim();
        if (trimmed === 'null' || !trimmed) { resolve(null); return; }
        resolve(JSON.parse(trimmed));
      } catch { resolve(null); }
    });
  });
}

function getAppConfigPath() {
  return path.join(app.getPath('userData'), 'app-config.json');
}

function loadAppConfig() {
  const configPath = getAppConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (cfg.sources !== undefined || cfg.targetDir !== undefined) {
        const sources = cfg.sources || [];
        cfg.folders = sources.filter(s => s).map(s => ({
          source: s,
          targetDir: cfg.targetDir || '',
          enableCompression: cfg.enableCompression !== undefined ? cfg.enableCompression : true,
          enableEncryption: cfg.enableEncryption !== undefined ? cfg.enableEncryption : true,
          autoBackup: cfg.autoBackup !== undefined ? cfg.autoBackup : true
        }));
        delete cfg.sources;
        delete cfg.targetDir;
        delete cfg.enableCompression;
        delete cfg.enableEncryption;
        delete cfg.autoBackup;
        delete cfg.sourceDir;
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
      }
      return cfg;
    }
  } catch (_) {}
  return { folders: [] };
}

function saveAppConfig(config) {
  const configPath = getAppConfigPath();
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const existing = loadAppConfig();
    const merged = { ...existing, ...config };
    if (merged.sourceDir !== undefined) { delete merged.sourceDir; }
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
    if (merged.folders) folderConfigs = merged.folders;
    return true;
  } catch (_) { return false; }
}

// ====== USB SIGNATURE STORAGE & TOKEN VERIFICATION ======

function getUsbSignaturePath() {
  return path.join(app.getPath('userData'), 'usb-signature.json');
}

function loadUsbSignature() {
  const sigPath = getUsbSignaturePath();
  try {
    if (fs.existsSync(sigPath)) {
      const data = JSON.parse(fs.readFileSync(sigPath, 'utf-8'));
      if (Array.isArray(data)) savedUsbSignatures = data;
      else savedUsbSignatures = [data];
      return savedUsbSignatures;
    }
  } catch (_) {}
  savedUsbSignatures = [];
  return savedUsbSignatures;
}

function saveUsbSignature(sig) {
  const sigPath = getUsbSignaturePath();
  try {
    const dir = path.dirname(sigPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const idx = savedUsbSignatures.findIndex(s => s.Serial === sig.Serial);
    if (idx >= 0) savedUsbSignatures[idx] = sig;
    else savedUsbSignatures.push(sig);
    fs.writeFileSync(sigPath, JSON.stringify(savedUsbSignatures, null, 2));
    return true;
  } catch (_) { return false; }
}

function generateVaultToken() {
  return 'zephon_vault_key_' + crypto.randomBytes(32).toString('hex');
}

function getDriveRoot(letters) {
  const first = letters.split(',')[0].trim().replace(':', '');
  return first + ':\\';
}

function writeUsbTokenFile(driveRoot, token) {
  const filePath = path.join(driveRoot, '.zephon_id');
  fs.writeFileSync(filePath, token + '\n', 'utf-8');
  try {
    execFile('attrib', ['+H', filePath], { timeout: 3000, windowsHide: true });
  } catch (_) {}
}

function readUsbTokenFile(driveRoot) {
  const filePath = path.join(driveRoot, '.zephon_id');
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8').trim();
}

function deleteUsbTokenFile(driveRoot) {
  const filePath = path.join(driveRoot, '.zephon_id');
  if (fs.existsSync(filePath)) {
    try {
      execFile('attrib', ['-H', filePath], { timeout: 3000, windowsHide: true });
    } catch (_) {}
    try { fs.unlinkSync(filePath); } catch (_) {}
  }
}

async function checkUsbMatch() {
  if (savedUsbSignatures.length === 0) return [];
  const drives = await detectUsbDrives();
  const matchedDrives = [];
  for (const drive of drives) {
    const sig = savedUsbSignatures.find(s => s.Serial === drive.Serial && s.VID === drive.VID && s.PID === drive.PID);
    if (!sig || !drive.DriveLetters) continue;

    const driveRoot = getDriveRoot(drive.DriveLetters);
    const tokenOnDrive = readUsbTokenFile(driveRoot);
    if (!tokenOnDrive || tokenOnDrive !== sig.token) continue;

    matchedDrives.push(drive);
  }
  return matchedDrives;
}

// ====== USB POLLING & SYNC PROMPT ======

function startUsbPolling() {
  stopUsbPolling();
  usbPollInterval = setInterval(async () => {
    if (savedUsbSignatures.length === 0) { lastUsbMatchedDrives = []; return; }
    const matches = await checkUsbMatch();

    for (const match of matches) {
      const driveRoot = getDriveRoot(match.DriveLetters);
      
      const wasMatched = lastUsbMatchedDrives.some(d => d.Serial === match.Serial);
      if (!wasMatched) {
        sendUsbEvent({ type: 'matched', drive: match });

        const targetFolders = folderConfigs.filter(cfg => {
          if (!cfg.targetDir) return false;
          const parsed = path.parse(cfg.targetDir);
          return parsed.root && parsed.root.toUpperCase().replace(/\\/g, '') === driveRoot.toUpperCase().replace(/\\/g, '');
        });

        if (targetFolders.length > 0) {
          if (promptDebounceTimer) clearTimeout(promptDebounceTimer);
          promptDebounceTimer = setTimeout(async () => {
            const changes = await checkForChanges(targetFolders);
            lastPromptedDrive = match;

            const anyAutoBackup = targetFolders.some(f => f.autoBackup);

            if (anyAutoBackup) {
              if (!changes.hasChanges) {
                sendLog('info', `USB verified. Backup is already up to date.`);
                sendUsbEvent({ type: 'auto-backup-up-to-date', drive: match });
              } else {
                const needsPwd = targetFolders.some(f => f.enableEncryption && f.autoBackup && (!f.password || f.password.trim().length === 0));
                if (needsPwd) {
                  sendLog('warn', 'Auto-backup: Password is required for one or more encrypted folders.');
                  sendUsbEvent({ type: 'auto-backup-skipped', drive: match, reason: 'no-password' });
                } else {
                  sendLog('info', `USB verified. Starting automatic backup...`);
                  try {
                    await runFullSync(targetFolders.filter(f => f.autoBackup));
                    sendUsbEvent({ type: 'auto-backup-success', drive: match });
                  } catch (err) {
                    sendLog('error', `Automatic backup failed: ${err.message}`);
                    sendUsbEvent({ type: 'auto-backup-failed', drive: match, error: err.message });
                  }
                }
              }
            } else {
              sendUsbEvent({
                type: 'prompt',
                drive: match,
                changedFiles: changes.changedFiles,
                fileCount: changes.fileCount,
                hasChanges: changes.hasChanges
              });
            }
          }, 1000);
        }
      }
    }

    for (const lastDrive of lastUsbMatchedDrives) {
      if (!matches.some(m => m.Serial === lastDrive.Serial)) {
        sendUsbEvent({ type: 'unmatched', drive: lastDrive });
      }
    }
    
    lastUsbMatchedDrives = matches;
  }, USB_POLL_MS);
}

function stopUsbPolling() {
  if (usbPollInterval) { clearInterval(usbPollInterval); usbPollInterval = null; }
}

// ====== WATCHER ======

const watchers = new Map();

function startWatching(folders) {
  folderConfigs = folders;
  const activeSources = new Set(folders.filter(f => f.isActive).map(f => path.resolve(f.source)));

  for (const [src, state] of watchers) {
    if (!activeSources.has(src)) {
      state.watcher.close();
      watchers.delete(src);
      sendLog('info', `Shield deactivated for: ${path.basename(src)}`);
    }
  }

  for (const cfg of folderConfigs) {
    if (!cfg.isActive) continue;
    
    const src = path.resolve(cfg.source);
    if (watchers.has(src)) continue;

    const tgt = path.resolve(cfg.targetDir);

    if (!fs.existsSync(tgt)) {
      try { fs.mkdirSync(tgt, { recursive: true }); }
      catch (e) { sendLog('error', `Failed to create target: ${tgt}`); continue; }
    }
    if (!fs.existsSync(src)) {
      const parsed = path.parse(src);
      if (parsed.ext) {
        const parent = parsed.dir;
        if (!fs.existsSync(parent)) { sendLog('error', `Parent directory does not exist: ${parent}`); continue; }
      } else {
        fs.mkdirSync(src, { recursive: true });
      }
    }

    const srcStat = fs.statSync(src);
    const srcIsDir = srcStat.isDirectory();

    const w = chokidar.watch(src, {
      ignored: !srcIsDir ? undefined : /(^|[\/\\])\.|node_modules/,
      persistent: true,
      ignoreInitial: false,
      depth: srcIsDir ? 99 : 0,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
    });

    const state = {
      watcher: w,
      debounceTimers: new Map(),
      isReady: false,
      syncDebounceTimer: null
    };
    watchers.set(src, state);

    function triggerAutoSync() {
      if (!state.isReady) return;
      if (state.syncDebounceTimer) clearTimeout(state.syncDebounceTimer);
      state.syncDebounceTimer = setTimeout(async () => {
        try {
          sendLog('info', `Executing automatic sync for detected changes in ${path.basename(src)}...`);
          await syncSource(src, tgt);
        } catch (err) {
          sendLog('error', `Auto-sync failed: ${err.message}`);
        }
      }, 2000);
    }

    w.on('add', (filePath) => {
      try {
        if (fs.statSync(filePath).isFile()) {
          const t = state.debounceTimers.get(filePath);
          if (t) clearTimeout(t);
          state.debounceTimers.set(filePath, setTimeout(() => {
            state.debounceTimers.delete(filePath);
            if (state.isReady) {
              sendLog('info', `Change detected (New): ${path.relative(src, filePath)}`);
              triggerAutoSync();
            }
          }, 500));
        }
      } catch (_) {}
    });

    w.on('change', (filePath) => {
      try {
        if (fs.statSync(filePath).isFile()) {
          const t = state.debounceTimers.get(filePath);
          if (t) clearTimeout(t);
          state.debounceTimers.set(filePath, setTimeout(() => {
            state.debounceTimers.delete(filePath);
            if (state.isReady) {
              sendLog('info', `Change detected (Modified): ${path.relative(src, filePath)}`);
              triggerAutoSync();
            }
          }, 500));
        }
      } catch (_) {}
    });

    w.on('unlink', (filePath) => {
      if (state.isReady) {
        sendLog('info', `Change detected (Deleted): ${path.relative(src, filePath)}`);
        triggerAutoSync();
      }
    });

    w.on('error', (err) => sendLog('error', `Watcher error (${src}): ${err.message}`));

    w.on('ready', () => {
      state.isReady = true;
      sendLog('info', `Monitoring activated: ${src}`);
    });
  }

  isWatching = watchers.size > 0;
}

function stopWatching() {
  if (!isWatching) return;
  activeStreams.forEach((s) => { try { s.destroy(); } catch (_) {} });
  activeStreams.clear();
  for (const [src, state] of watchers) {
    state.watcher.close();
  }
  watchers.clear();
  isWatching = false;
  sendLog('info', 'Shield deactivated');
}

// ====== IPC HANDLERS ======

ipcMain.handle('start-monitoring', async (event, { folders }) => {
  startWatching(folders);
  await runFullSync();
  return { success: true };
});

ipcMain.handle('stop-monitoring', async () => {
  stopWatching();
  return { success: true };
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('select-file-or-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('save-file-dialog', async (event, opts) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: opts && opts.defaultPath ? opts.defaultPath : undefined,
    filters: opts && opts.filters ? opts.filters : undefined
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('get-status', async () => {
  return { isWatching, folderConfigs };
});

ipcMain.handle('set-backup-paths', async (event, { folders }) => {
  if (folders) folderConfigs = folders;
  return { success: true };
});

ipcMain.handle('detect-usb-drives', async () => await detectUsbDrives());
ipcMain.handle('find-usb-drive-for-path', async (event, targetPath) => await findUsbDriveForPath(targetPath));

ipcMain.handle('register-usb', async (event, { targetPath, drive }) => {
  try {
    const driveRoot = getDriveRoot(drive.DriveLetters);
    const token = generateVaultToken();
    writeUsbTokenFile(driveRoot, token);

    const sig = {
      VID: drive.VID,
      PID: drive.PID,
      Serial: drive.Serial,
      Model: drive.Model,
      DriveLetters: drive.DriveLetters,
      token: token
    };

    if (!saveUsbSignature(sig)) {
      deleteUsbTokenFile(driveRoot);
      return { success: false, error: 'Failed to save registration' };
    }

    startUsbPolling();
    return { success: true, token };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('unregister-usb', async () => {
  try {
    for (const sig of savedUsbSignatures) {
      if (sig.DriveLetters) {
        const driveRoot = getDriveRoot(sig.DriveLetters);
        deleteUsbTokenFile(driveRoot);
      }
    }
    savedUsbSignatures = [];
    const sigPath = getUsbSignaturePath();
    if (fs.existsSync(sigPath)) fs.unlinkSync(sigPath);
    stopUsbPolling();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-usb-signature', async () => loadUsbSignature());
ipcMain.handle('get-app-config', async () => loadAppConfig());
ipcMain.handle('save-app-config', async (event, config) => saveAppConfig(config));

ipcMain.handle('verify-usb-registration', async (event, targetPath) => {
  if (savedUsbSignatures.length === 0) return { registered: false };
  const drives = await detectUsbDrives();
  if (drives.length === 0) return { registered: savedUsbSignatures.length > 0, connected: false };
  
  if (targetPath) {
    const parsed = path.parse(targetPath);
    const targetRoot = parsed.root ? parsed.root.toUpperCase().replace(/\\/g, '') : null;
    if (targetRoot) {
      for (const drive of drives) {
        if (!drive.DriveLetters) continue;
        const driveRoot = getDriveRoot(drive.DriveLetters).replace(':\\', '');
        if (driveRoot === targetRoot) {
          const sig = savedUsbSignatures.find(s => s.Serial === drive.Serial && s.VID === drive.VID && s.PID === drive.PID);
          if (sig) {
            const tokenOnDrive = readUsbTokenFile(driveRoot + ':\\');
            const tokenMatch = tokenOnDrive === sig.token;
            return { registered: true, connected: tokenMatch, drive, signature: sig };
          }
          return { registered: false, connected: false, otherDrive: drive };
        }
      }
    }
  }
  return { registered: savedUsbSignatures.length > 0, connected: false };
});

ipcMain.handle('confirm-sync', async () => {
  try {
    await runFullSync();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('check-for-changes', async () => {
  return await checkForChanges();
});

ipcMain.handle('decrypt-vault-to-folder', async (event, { vaultPath, password, outputDir }) => {
  const key = deriveKey(password);
  try {
    await unpackVaultToFolder(vaultPath, key, outputDir);
    return { success: true, outputPath: outputDir };
  } catch (err) {
    if (err.message.includes('bad decrypt') || err.message.includes('padding')) {
      return { success: false, error: 'Incorrect password or corrupted vault file' };
    }
    return { success: false, error: err.message };
  }
});

ipcMain.handle('decompress-gz', async (event, { gzPath, outputDir }) => {
  try {
    const baseName = path.basename(gzPath);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    if (baseName.endsWith('.tar.gz')) {
      const extractDir = path.join(outputDir, baseName.replace(/\.tar\.gz$/, ''));
      if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir, { recursive: true });
      const readStream = fs.createReadStream(gzPath);
      const extractStream = tar.x({ cwd: extractDir });
      await new Promise((resolve, reject) => {
        readStream.pipe(extractStream);
        extractStream.on('finish', resolve);
        extractStream.on('error', reject);
      });
      return { success: true, outputPath: extractDir };
    }

    const buf = fs.readFileSync(gzPath);
    const decompressed = zlib.gunzipSync(buf);
    const outName = baseName.replace(/\.gz$/, '');
    const outPath = path.join(outputDir, outName);
    fs.writeFileSync(outPath, decompressed);
    return { success: true, outputPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('encrypt-file-standalone', async (event, { sourcePath, password, outputDir }) => {
  if (!sourcePath || !password) return { success: false, error: 'Source file and password required' };
  const key = deriveKey(password);
  if (!fs.existsSync(sourcePath)) return { success: false, error: 'Source path does not exist' };

  const stat = fs.statSync(sourcePath);
  const sourceName = path.basename(sourcePath);
  const outDir = outputDir || path.dirname(sourcePath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  let result, outName;
  if (stat.isDirectory()) {
    sendLog('info', `Encrypting folder: ${sourceName}`);
    const tarGzBuffer = await createTarGzBuffer(sourcePath);
    result = encryptBufferCompressed(tarGzBuffer, key);
    outName = sourceName + '.vault';
    result.flags = 0x03;
  } else {
    let buffer;
    try { buffer = fs.readFileSync(sourcePath); }
    catch (err) { return { success: false, error: `Cannot read source: ${err.message}` }; }
    const ext = path.extname(sourcePath).toLowerCase();
    if (COMPRESSIBLE_EXTS.has(ext) && buffer.length < MAX_COMPRESS_BYTES) {
      result = encryptBufferCompressed(buffer, key);
    } else {
      result = encryptBuffer(buffer, key);
    }
    outName = sourceName + '.vault';
    result.flags = result.compressed ? 0x01 : 0x00;
  }

  const vaultContent = Buffer.concat([result.iv, Buffer.from([result.flags]), result.encrypted]);
  const outPath = path.join(outDir, outName);
  try {
    fs.writeFileSync(outPath, vaultContent);
    return { success: true, outputPath: outPath };
  } catch (err) { return { success: false, error: `Failed to write: ${err.message}` }; }
});

ipcMain.handle('compress-file-standalone', async (event, { sourcePath, outputDir }) => {
  if (!sourcePath) return { success: false, error: 'Source path required' };
  if (!fs.existsSync(sourcePath)) return { success: false, error: 'Source path does not exist' };

  const stat = fs.statSync(sourcePath);
  const sourceName = path.basename(sourcePath);
  const outDir = outputDir || path.dirname(sourcePath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  let compressed, outName;
  if (stat.isDirectory()) {
    sendLog('info', `Compressing folder: ${sourceName}`);
    compressed = await createTarGzBuffer(sourcePath);
    outName = sourceName + '.tar.gz';
  } else {
    let buffer;
    try { buffer = fs.readFileSync(sourcePath); }
    catch (err) { return { success: false, error: `Cannot read source: ${err.message}` }; }
    compressed = zlib.gzipSync(buffer);
    outName = sourceName + '.gz';
  }

  const outPath = path.join(outDir, outName);
  try {
    fs.writeFileSync(outPath, compressed);
    return { success: true, outputPath: outPath };
  } catch (err) { return { success: false, error: `Failed to write: ${err.message}` }; }
});

// ====== WINDOW ======

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, 'icon.ico'),
    title: 'Zephon',
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('closed', () => {
    stopUsbPolling();
    stopWatching();
    mainWindow = null;
  });

  const config = loadAppConfig();
  if (config.folders) folderConfigs = config.folders;

  loadUsbSignature();
  if (savedUsbSignatures.length > 0) startUsbPolling();
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let size = Number(bytes);
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(1)} ${units[i]}`;
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
