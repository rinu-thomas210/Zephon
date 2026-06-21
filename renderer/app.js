const $ = (id) => document.getElementById(id);

// Module tabs
const moduleTabs = document.querySelectorAll('.module-tab');
const modulePanels = {
  backup: $('module-backup'),
  encrypt: $('module-encrypt'),
  compress: $('module-compress'),
  restore: $('module-restore')
};

// Backup module
const sourceList = $('source-list');
const targetDir = $('target-dir');
const password = $('password');
const btnTarget = $('btn-target');
const btnActivate = $('btn-activate');
const btnDeactivate = $('btn-deactivate');
const btnAddSource = $('btn-add-source');
const btnClearLog = $('btn-clear-log');
const logContainer = $('log-container');
const shieldStatus = $('shield-status');
const sourceDisplay = $('source-display');
const targetDisplay = $('target-display');
const usbDeviceDisplay = $('usb-device-display');
const toggleCompression = $('toggle-compression');
const toggleEncryption = $('toggle-encryption');
const btnRegisterUsb = $('btn-register-usb');
const btnUnregisterUsb = $('btn-unregister-usb');
const toggleAutobackup = $('toggle-autobackup');

// Encrypt module
const encryptFile = $('encrypt-file');
const encryptPassword = $('encrypt-password');
const encryptOutput = $('encrypt-output');
const btnEncryptSel = $('btn-encrypt-sel');
const btnEncryptOut = $('btn-encrypt-out');
const btnEncryptGo = $('btn-encrypt-go');
const encryptResult = $('encrypt-result');

// Compress module
const compressFile = $('compress-file');
const compressOutput = $('compress-output');
const btnCompressSel = $('btn-compress-sel');
const btnCompressOut = $('btn-compress-out');
const btnCompressGo = $('btn-compress-go');
const compressResult = $('compress-result');

// Sync modal
const syncModal = $('sync-modal');
const modalMessage = $('modal-message');
const modalChanges = $('modal-changes');
const modalBtnYes = $('modal-btn-yes');
const modalBtnNo = $('modal-btn-no');

// Restore (Decrypt & Decompress) module
const restoreFile = $('restore-file');
const btnRestoreSel = $('btn-restore-sel');
const restorePassword = $('restore-password');
const restorePwdGroup = $('restore-pwd-group');
const restoreOutput = $('restore-output');
const btnRestoreOut = $('btn-restore-out');
const btnRestoreGo = $('btn-restore-go');
const restoreResult = $('restore-result');

let folderConfigs = [];
let selectedFolderIndex = -1;
let isActive = false;
let isSyncing = false;
let currentUsbDrives = [];
let isUsbRegistered = false;

// Page title mapping
const pageTitles = {
  backup: 'Automated Backup',
  encrypt: 'Encryption',
  compress: 'Compression',
  restore: 'Decrypt & Restore'
};
const pageTitle = $('page-title');

// Password toggle
const btnTogglePwd = $('btn-toggle-pwd');
if (btnTogglePwd) {
  btnTogglePwd.addEventListener('click', () => {
    const isPassword = password.type === 'password';
    password.type = isPassword ? 'text' : 'password';
    btnTogglePwd.title = isPassword ? 'Hide password' : 'Show password';
  });
}

// ====== MODULE NAVIGATION ======
moduleTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    moduleTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    Object.keys(modulePanels).forEach(key => {
      modulePanels[key].classList.toggle('active', key === tab.dataset.module);
    });
    if (pageTitle && pageTitles[tab.dataset.module]) {
      pageTitle.textContent = pageTitles[tab.dataset.module];
    }
  });
});

// ====== SOURCE LIST MANAGEMENT ======

function renderFolderList() {
  const listUi = $('source-list');
  listUi.innerHTML = '';
  folderConfigs.forEach((cfg, index) => {
    const item = document.createElement('div');
    item.className = 'folder-item' + (index === selectedFolderIndex ? ' active' : '');
    let displayName = cfg.source.split('\\').pop().split('/').pop() || cfg.source;
    const dotIdx = displayName.lastIndexOf('.');
    if (dotIdx > 0) displayName = displayName.substring(0, dotIdx);
    item.innerHTML = `
      <div class="folder-item-info">
        <svg class="folder-item-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </svg>
        <div class="folder-item-name" title="${escapeHtml(cfg.source)}">${escapeHtml(displayName)}</div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button class="folder-item-remove" title="Delete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
        </svg>
      </button>
      </div>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.closest('.folder-item-remove')) return;
      selectFolder(index);
    });
    const removeBtn = item.querySelector('.folder-item-remove');
    removeBtn.addEventListener('click', () => {
      folderConfigs.splice(index, 1);
      if (selectedFolderIndex === index) {
        selectedFolderIndex = -1;
      } else if (selectedFolderIndex > index) {
        selectedFolderIndex--;
      }
      renderFolderList();
      selectFolder(selectedFolderIndex);
      saveConfig();
    });
    listUi.appendChild(item);
  });

  const count = folderConfigs.length;
  sourceDisplay.textContent = count > 0 ? `Folders (${count})` : 'Folders: 0';
  updateUI();
}

function selectFolder(index) {
  selectedFolderIndex = index;
  renderFolderList();

  const configArea = $('folder-config-area');
  const emptyState = $('empty-folder-state');

  if (index >= 0 && index < folderConfigs.length) {
    const cfg = folderConfigs[index];
    password.value = cfg.password || '';
    targetDir.value = cfg.targetDir || '';
    targetDisplay.textContent = cfg.targetDir ? `Target: ${cfg.targetDir}` : 'Target: —';
    toggleCompression.checked = cfg.enableCompression;
    toggleEncryption.checked = cfg.enableEncryption;
    toggleAutobackup.checked = cfg.autoBackup;

    configArea.style.display = 'flex';
    emptyState.style.display = 'none';

    if (cfg.targetDir) {
      detectUsbForTarget(cfg.targetDir);
    } else {
      usbDeviceDisplay.innerHTML = '<div class="usb-status">No target path set</div>';
      btnRegisterUsb.style.display = 'none';
      btnUnregisterUsb.style.display = 'none';
      currentUsbDrives = [];
    }
  } else {
    configArea.style.display = 'none';
    emptyState.style.display = 'block';
    targetDisplay.textContent = 'Target: —';
  }
}

async function saveConfig() {
  await window.zephon.saveAppConfig({ folders: folderConfigs });
  restartMonitoring();
}

async function restartMonitoring() {
  await window.zephon.startMonitoring({ folders: folderConfigs });
  updateUI();
}

targetDir.addEventListener('input', () => {
  if (selectedFolderIndex < 0) return;
  const val = targetDir.value.trim();
  folderConfigs[selectedFolderIndex].targetDir = val;
  folderConfigs[selectedFolderIndex].isActive = false;
  if (val) {
    targetDisplay.textContent = `Target: ${val}`;
    detectUsbForTarget(val);
  } else {
    targetDisplay.textContent = 'Target: —';
  }
  saveConfig();
});

password.addEventListener('input', () => {
  if (selectedFolderIndex < 0) return;
  folderConfigs[selectedFolderIndex].password = password.value;
  folderConfigs[selectedFolderIndex].isActive = false;
  saveConfig();
});

toggleEncryption.addEventListener('change', () => {
  if (selectedFolderIndex < 0) return;
  folderConfigs[selectedFolderIndex].enableEncryption = toggleEncryption.checked;
  folderConfigs[selectedFolderIndex].isActive = false;
  saveConfig();
});

toggleCompression.addEventListener('change', () => {
  if (selectedFolderIndex < 0) return;
  folderConfigs[selectedFolderIndex].enableCompression = toggleCompression.checked;
  folderConfigs[selectedFolderIndex].isActive = false;
  saveConfig();
});

toggleAutobackup.addEventListener('change', () => {
  if (selectedFolderIndex < 0) return;
  folderConfigs[selectedFolderIndex].autoBackup = toggleAutobackup.checked;
  saveConfig();
  addLog('info', `Auto-backup ${toggleAutobackup.checked ? 'enabled' : 'disabled'} for ${folderConfigs[selectedFolderIndex].source}`);
});


$('btn-add-source-folder').addEventListener('click', async () => {
  const dir = await window.zephon.selectDirectory();
  if (dir) {
    const existingIndex = folderConfigs.findIndex(f => f.source === dir);
    if (existingIndex !== -1) {
      selectFolder(existingIndex);
      return;
    }
    folderConfigs.unshift({
      source: dir,
      password: '',
      targetDir: '',
      enableCompression: true,
      enableEncryption: true,
      autoBackup: true,
      isActive: false
    });
    saveConfig();
    selectFolder(0);
  }
});

$('btn-add-source-file').addEventListener('click', async () => {
  const file = await window.zephon.selectFile();
  if (file) {
    const existingIndex = folderConfigs.findIndex(f => f.source === file);
    if (existingIndex !== -1) {
      selectFolder(existingIndex);
      return;
    }
    folderConfigs.unshift({
      source: file,
      password: '',
      targetDir: '',
      enableCompression: true,
      enableEncryption: true,
      autoBackup: true
    });
    saveConfig();
    selectFolder(0);
  }
});

// ====== BROWSE TARGET ======
btnTarget.addEventListener('click', async () => {
  if (selectedFolderIndex < 0) return;
  const dir = await window.zephon.selectDirectory();
  if (dir) {
    targetDir.value = dir;
    folderConfigs[selectedFolderIndex].targetDir = dir;
    folderConfigs[selectedFolderIndex].isActive = false;
    targetDisplay.textContent = `Target: ${dir}`;
    detectUsbForTarget(dir);
    saveConfig();
  }
});

// ====== USB DETECTION ======
async function detectUsbForTarget(targetPath) {
  usbDeviceDisplay.innerHTML = '<div class="usb-status">Scanning for USB device...</div>';
  try {
    const drive = await window.zephon.findUsbDriveForPath(targetPath);
    if (drive) {
      currentUsbDrives = [drive];
      const regStatus = await window.zephon.verifyUsbRegistration(targetPath);
      isUsbRegistered = regStatus.registered;
      if (isUsbRegistered) {
        showUsbRegistered(drive, regStatus.connected);
      } else {
        showUsbDetected(drive);
      }
    } else {
      usbDeviceDisplay.innerHTML = '<div class="usb-status">No USB device detected at target path</div>';
      currentUsbDrives = [];
      btnRegisterUsb.style.display = 'none';
      btnUnregisterUsb.style.display = 'none';
    }
  } catch {
    usbDeviceDisplay.innerHTML = '<div class="usb-status">Could not scan USB devices</div>';
  }
}

function showUsbDetected(drive) {
  usbDeviceDisplay.innerHTML = `
    <div class="usb-device-info">
      <span class="usb-model">${escapeHtml(drive.Model)}</span>
      <span class="usb-sig">VID: ${drive.VID} | PID: ${drive.PID} | SN: ${drive.Serial}</span>
      <span class="usb-sig">Drive: ${drive.DriveLetters} | Size: ${formatSize(drive.Size)}</span>
    </div>`;
  btnRegisterUsb.style.display = 'inline-block';
  btnUnregisterUsb.style.display = 'none';
}

function showUsbRegistered(drive, connected) {
  usbDeviceDisplay.innerHTML = `
    <div class="usb-device-info">
      <span class="usb-model">${escapeHtml(drive.Model)}</span>
      <span class="usb-sig usb-matched">&#x2713; Registered</span>
      <span class="usb-sig">VID: ${drive.VID} | PID: ${drive.PID} | SN: ${drive.Serial}</span>
      <span class="usb-sig">Drive: ${drive.DriveLetters} | Size: ${formatSize(drive.Size)}</span>
      <span class="usb-sig ${connected ? 'usb-matched' : ''}">${connected ? '&#x2713; Connected' : 'Not connected'}</span>
    </div>`;
  btnRegisterUsb.style.display = 'none';
  btnUnregisterUsb.style.display = 'inline-block';
}

btnRegisterUsb.addEventListener('click', async () => {
  if (currentUsbDrives.length === 0 || selectedFolderIndex < 0) return;
  const drive = currentUsbDrives[0];
  const targetPath = folderConfigs[selectedFolderIndex].targetDir;
  const result = await window.zephon.registerUsb({ targetPath, drive });
  if (result.success) {
    isUsbRegistered = true;
    addLog('success', `USB registered: ${drive.Model} (SN: ${drive.Serial})`);
    showUsbRegistered(drive, true);
  } else {
    addLog('error', `USB registration failed: ${result.error}`);
  }
});

btnUnregisterUsb.addEventListener('click', async () => {
  const result = await window.zephon.unregisterUsb();
  if (result.success) {
    isUsbRegistered = false;
    addLog('info', 'USB unregistered');
    if (currentUsbDrives.length > 0) {
      showUsbDetected(currentUsbDrives[0]);
    }
  } else {
    addLog('error', `Failed to unregister: ${result.error}`);
  }
});

// ====== ACTIVATE / DEACTIVATE ======
btnActivate.addEventListener('click', async () => {
  if (selectedFolderIndex < 0) return;
  const cfg = folderConfigs[selectedFolderIndex];
  if (!cfg.source || !cfg.targetDir) {
    addLog('warn', 'Please configure target directory first');
    return;
  }
  cfg.isActive = true;
  await saveConfig();
  addLog('info', `Activated monitoring for: ${cfg.source.split('\\').pop().split('/').pop()}`);
});

btnDeactivate.addEventListener('click', async () => {
  if (selectedFolderIndex < 0) return;
  const cfg = folderConfigs[selectedFolderIndex];
  cfg.isActive = false;
  await saveConfig();
  addLog('info', `Deactivated monitoring for: ${cfg.source.split('\\').pop().split('/').pop()}`);
});

// ====== ENCRYPT MODULE ======
$('btn-encrypt-sel-file').addEventListener('click', async () => {
  const f = await window.zephon.selectFile();
  if (f) encryptFile.value = f;
});

$('btn-encrypt-sel-dir').addEventListener('click', async () => {
  const f = await window.zephon.selectDirectory();
  if (f) encryptFile.value = f;
});

btnEncryptOut.addEventListener('click', async () => {
  const dir = await window.zephon.selectDirectory();
  if (dir) encryptOutput.value = dir;
});

btnEncryptGo.addEventListener('click', async () => {
  const src = encryptFile.value.trim();
  const pwd = encryptPassword.value.trim();
  const out = encryptOutput.value.trim() || undefined;
  if (!src) { encryptResult.textContent = 'Please select a source file or folder.'; encryptResult.className = 'result-msg error'; return; }
  if (!pwd) { encryptResult.textContent = 'Please enter an encryption password.'; encryptResult.className = 'result-msg error'; return; }
  encryptResult.textContent = 'Encrypting...'; encryptResult.className = 'result-msg';
  const result = await window.zephon.encryptFileStandalone({ sourcePath: src, password: pwd, outputDir: out });
  if (result.success) { encryptResult.textContent = `Encrypted: ${result.outputPath}`; encryptResult.className = 'result-msg success'; }
  else { encryptResult.textContent = `Error: ${result.error}`; encryptResult.className = 'result-msg error'; }
});

// ====== COMPRESS MODULE ======
$('btn-compress-sel-file').addEventListener('click', async () => {
  const f = await window.zephon.selectFile();
  if (f) compressFile.value = f;
});

$('btn-compress-sel-dir').addEventListener('click', async () => {
  const f = await window.zephon.selectDirectory();
  if (f) compressFile.value = f;
});

btnCompressOut.addEventListener('click', async () => {
  const dir = await window.zephon.selectDirectory();
  if (dir) compressOutput.value = dir;
});

btnCompressGo.addEventListener('click', async () => {
  const src = compressFile.value.trim();
  const out = compressOutput.value.trim() || undefined;
  if (!src) { compressResult.textContent = 'Please select a source file or folder.'; compressResult.className = 'result-msg error'; return; }
  compressResult.textContent = 'Compressing...'; compressResult.className = 'result-msg';
  const result = await window.zephon.compressFileStandalone({ sourcePath: src, outputDir: out });
  if (result.success) { compressResult.textContent = `Compressed: ${result.outputPath}`; compressResult.className = 'result-msg success'; }
  else { compressResult.textContent = `Error: ${result.error}`; compressResult.className = 'result-msg error'; }
});

// ====== RESTORE MODULE (Decrypt & Decompress) ======

restoreFile.addEventListener('input', () => {
  const val = restoreFile.value.trim().toLowerCase();
  restorePwdGroup.style.display = val.endsWith('.gz') ? 'none' : 'block';
});

btnRestoreSel.addEventListener('click', async () => {
  const f = await window.zephon.selectFile();
  if (f) {
    restoreFile.value = f;
    restorePwdGroup.style.display = f.toLowerCase().endsWith('.vault') ? 'block' : 'none';
  }
});

btnRestoreOut.addEventListener('click', async () => {
  const dir = await window.zephon.selectDirectory();
  if (dir) restoreOutput.value = dir;
});

btnRestoreGo.addEventListener('click', async () => {
  const filePath = restoreFile.value.trim();
  const outputDir = restoreOutput.value.trim();

  if (!filePath) { restoreResult.textContent = 'Select a source file'; restoreResult.className = 'result-msg error'; return; }
  if (!outputDir) { restoreResult.textContent = 'Select an output directory'; restoreResult.className = 'result-msg error'; return; }

  if (filePath.toLowerCase().endsWith('.vault')) {
    const pwd = restorePassword.value.trim();
    if (!pwd) { restoreResult.textContent = 'Enter the decryption password'; restoreResult.className = 'result-msg error'; return; }
    restoreResult.textContent = 'Decrypting...'; restoreResult.className = 'result-msg';
    const result = await window.zephon.decryptVaultToFolder({ vaultPath: filePath, password: pwd, outputDir });
    if (result.success) {
      restoreResult.textContent = `Decrypted to: ${outputDir}`; restoreResult.className = 'result-msg success';
    } else {
      restoreResult.textContent = `Error: ${result.error}`; restoreResult.className = 'result-msg error';
    }
  } else if (filePath.toLowerCase().endsWith('.gz')) {
    restoreResult.textContent = 'Decompressing...'; restoreResult.className = 'result-msg';
    const result = await window.zephon.decompressGz({ gzPath: filePath, outputDir });
    if (result.success) {
      restoreResult.textContent = `Decompressed to: ${result.outputPath}`; restoreResult.className = 'result-msg success';
    } else {
      restoreResult.textContent = `Error: ${result.error}`; restoreResult.className = 'result-msg error';
    }
  } else {
    restoreResult.textContent = 'Unsupported file. Select a .vault or .gz file.'; restoreResult.className = 'result-msg error';
  }
});

// ====== LOG & UI ======
btnClearLog.addEventListener('click', () => {
  logContainer.innerHTML = '<div class="log-empty"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg><p>No activity yet</p><p class="log-empty-sub">Configure and activate the shield to begin</p></div>';
});

function updateUI() {
  const cfg = selectedFolderIndex >= 0 ? folderConfigs[selectedFolderIndex] : null;
  const hasConfigs = folderConfigs.length > 0;

  // Update global shield dot based on whether ANY folder is active
  const anyActive = folderConfigs.some(f => f.isActive);
  const dot = shieldStatus.querySelector('.shield-dot');
  const label = shieldStatus.querySelector('span');
  if (dot) {
    dot.className = `shield-dot ${anyActive ? 'active' : 'inactive'}`;
  }
  if (label) {
    label.textContent = anyActive ? 'Shield Active' : 'Shield Inactive';
  }

  // Update Activate/Deactivate buttons for the SELECTED folder
  if (cfg) {
    const needsPassword = cfg.enableEncryption && (!cfg.password || cfg.password.trim().length === 0);
    btnActivate.disabled = cfg.isActive || needsPassword;
    btnDeactivate.disabled = !cfg.isActive;
  } else {
    btnActivate.disabled = true;
    btnDeactivate.disabled = true;
  }
}

function addLog(level, message) {
  const empty = logContainer.querySelector('.log-empty');
  if (empty) empty.remove();
  const entry = document.createElement('div');
  entry.className = `log-entry level-${level}`;
  const time = new Date().toLocaleTimeString();
  entry.innerHTML = `<span class="time">[${time}]</span>${escapeHtml(message)}`;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatSize(bytes) {
  if (!bytes) return 'Unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let size = Number(bytes);
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(1)} ${units[i]}`;
}

// ====== SYNC MODAL ======

function showSyncModal(drive, changedFiles, fileCount, hasChanges) {
  modalMessage.textContent = `${drive.Model} detected — run backup?`;
  if (hasChanges) {
    modalChanges.textContent = `${changedFiles.length} file(s) changed since last sync.`;
    modalBtnYes.textContent = 'Yes, Back Up';
  } else {
    modalChanges.textContent = fileCount > 0 ? `${fileCount} file(s) in backup. No changes detected.` : 'No files in backup.';
    modalBtnYes.textContent = 'Run Backup';
  }
  modalBtnYes.style.display = 'inline-block';
  syncModal.classList.remove('hidden');
}

function hideSyncModal() {
  syncModal.classList.add('hidden');
}

modalBtnYes.addEventListener('click', async () => {
  hideSyncModal();
  modalBtnYes.textContent = 'Start Syncing';
  addLog('info', 'Starting incremental sync...');
  const res = await window.zephon.confirmSync();
  if (res && res.success) {
    addLog('success', 'Sync complete');
  } else {
    addLog('error', `Sync failed: ${res ? res.error : 'Unknown error'}`);
  }
});

modalBtnNo.addEventListener('click', hideSyncModal);

// ====== EVENT LISTENERS ======
window.zephon.onLog((data) => addLog(data.level, data.message));

window.zephon.onUsbEvent((data) => {
  if (data.type === 'matched') {
    addLog('info', `USB inserted: ${data.drive.Model}`);
  }
  if (data.type === 'prompt') {
    showSyncModal(data.drive, data.changedFiles, data.fileCount, data.hasChanges);
  }
  if (data.type === 'unmatched') {
    addLog('info', 'Registered USB removed');
  }
  if (data.type === 'auto-backup-success') {
    addLog('success', 'Plug-and-play auto-backup complete!');
  }
  if (data.type === 'auto-backup-failed') {
    addLog('error', `Plug-and-play auto-backup failed: ${data.error}`);
  }
  if (data.type === 'auto-backup-up-to-date') {
    addLog('info', 'Plug-and-play auto-backup: Backup is already up to date.');
  }
  if (data.type === 'auto-backup-skipped') {
    addLog('warn', 'Plug-and-play auto-backup: Shield not active — activate the shield to enable auto-backup.');
  }
});

window.zephon.onTargetDirUpdated((path) => {
  if (selectedFolderIndex >= 0) {
    targetDir.value = path;
    folderConfigs[selectedFolderIndex].targetDir = path;
    targetDisplay.textContent = `Target: ${path}`;
    saveConfig();
  }
});

// Restore saved settings on load
(async function init() {
  const config = await window.zephon.getAppConfig();
  if (config) {
    if (config.folders && Array.isArray(config.folders)) {
      folderConfigs = config.folders;
    } else {
      const sources = config.sources || [];
      if (sources.length > 0) {
        folderConfigs = sources.filter(s => s).map(s => ({
          source: s,
          targetDir: config.targetDir || '',
          enableCompression: config.enableCompression !== undefined ? config.enableCompression : true,
          enableEncryption: config.enableEncryption !== undefined ? config.enableEncryption : true,
          autoBackup: config.autoBackup !== undefined ? config.autoBackup : true
        }));
      } else {
        folderConfigs = [];
      }
    }

    selectedFolderIndex = folderConfigs.length > 0 ? 0 : -1;
    renderFolderList();
    selectFolder(selectedFolderIndex);
  } else {
    renderFolderList();
    selectFolder(-1);
  }

  const sig = await window.zephon.getUsbSignature();
  if (sig) {
    isUsbRegistered = true;
    addLog('info', `USB registration loaded for ${sig.Model}`);
  }

  // Auto-start monitoring disabled per user request


  updateUI();
})();
