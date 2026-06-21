const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zephon', {
  startMonitoring: (config) => ipcRenderer.invoke('start-monitoring', config),
  stopMonitoring: () => ipcRenderer.invoke('stop-monitoring'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  selectFile: () => ipcRenderer.invoke('select-file'),
  selectFileOrFolder: () => ipcRenderer.invoke('select-file-or-folder'),
  saveFileDialog: (opts) => ipcRenderer.invoke('save-file-dialog', opts),
  getStatus: () => ipcRenderer.invoke('get-status'),
  detectUsbDrives: () => ipcRenderer.invoke('detect-usb-drives'),
  getUsbSignature: () => ipcRenderer.invoke('get-usb-signature'),
  encryptFileStandalone: (cfg) => ipcRenderer.invoke('encrypt-file-standalone', cfg),
  compressFileStandalone: (cfg) => ipcRenderer.invoke('compress-file-standalone', cfg),
  setBackupPaths: (cfg) => ipcRenderer.invoke('set-backup-paths', cfg),
  findUsbDriveForPath: (targetPath) => ipcRenderer.invoke('find-usb-drive-for-path', targetPath),
  confirmSync: () => ipcRenderer.invoke('confirm-sync'),
  checkForChanges: () => ipcRenderer.invoke('check-for-changes'),
  decryptVaultToFolder: (cfg) => ipcRenderer.invoke('decrypt-vault-to-folder', cfg),
  decompressGz: (cfg) => ipcRenderer.invoke('decompress-gz', cfg),
  registerUsb: (cfg) => ipcRenderer.invoke('register-usb', cfg),
  unregisterUsb: () => ipcRenderer.invoke('unregister-usb'),
  verifyUsbRegistration: (targetPath) => ipcRenderer.invoke('verify-usb-registration', targetPath),
  getAppConfig: () => ipcRenderer.invoke('get-app-config'),
  saveAppConfig: (config) => ipcRenderer.invoke('save-app-config', config),
  onLog: (callback) => {
    ipcRenderer.on('log', (_event, data) => callback(data));
  },
  onUsbEvent: (callback) => {
    ipcRenderer.on('usb-event', (_event, data) => callback(data));
  },
  onTargetDirUpdated: (callback) => {
    ipcRenderer.on('target-dir-updated', (_event, path) => callback(path));
  }
});
