**Zephon** is a desktop application built with Electron that provides secure, automated local file synchronization with AES-256-CBC encryption. It is designed to protect your important files by backing them up to USB drives or local directories — with optional encryption, compression, real-time file monitoring, and plug-and-play USB auto-backup.

Think of Zephon as your personal **file shield**: you point it at folders or files you want to protect, choose a destination (like a USB drive), and Zephon continuously watches for changes and syncs them automatically — encrypted and compressed.

---

##  Features

| Feature | Description |
|---|---|
|  Automated Backup | Real-time file system monitoring with automatic sync on change detection |
|  AES-256-CBC Encryption | Military-grade encryption for all backed-up files and folders |
|  Gzip / tar.gz Compression | Reduces backup size with gzip (files) and tar.gz (folders) |
|  USB Hardware Lock | Register a specific USB drive by hardware signature (VID/PID/Serial) |
|  Plug & Play Auto-Backup | Automatically starts backup when your registered USB drive is plugged in |
|  Multi-Source Support | Monitor multiple files and folders simultaneously, each with independent settings |
|  Incremental Sync | Manifest-based change detection — only syncs files that have actually changed |
|  Decrypt & Restore | Built-in module to decrypt `.vault` files and decompress `.gz` / `.tar.gz` archives |
|  Real-Time Activity Log | Live log panel showing every operation, warning, and error |
|  Persistent Configuration | All settings are saved automatically and restored on next launch |

---

##  Screenshots

> _Launch the app with `npm start` to see the UI in action._

The application features a modern dark-themed UI with four main modules accessible from the sidebar:

- **Backup** — Configure sources, targets, encryption, compression, and USB hardware lock
- **Encrypt** — One-off file/folder encryption
- **Compress** — One-off file/folder compression
- **Restore** — Decrypt `.vault` files or decompress `.gz` / `.tar.gz` archives

---

##  Prerequisites

Before you begin, make sure you have the following installed:

| Requirement | Version | Download |
|---|---|---|
| **Node.js** | v18.0.0 or higher | [nodejs.org](https://nodejs.org/) |
| **npm** | v9.0.0 or higher | Included with Node.js |
| **Git** | Latest | [git-scm.com](https://git-scm.com/) |

> **Note:** Zephon's USB detection features are currently **Windows-only** (uses PowerShell and WMI queries). The rest of the app works cross-platform.

---

##  Installation

### 1. Clone the Repository

```bash
git clone https://github.com/rinu-thomas210/Zephon.git
cd Zephon
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Run the Application

```bash
npm start
```

The Zephon window will open and you can begin configuring your backups.

---

##  Getting Started

Here's a quick 5-step guide to get your first backup running:

```
Step 1  →  Click the "+" folder icon in the Backup panel to add a source folder
Step 2  →  Click "Browse" to select a target destination (USB drive or local folder)
Step 3  →  (Optional) Enable encryption and enter a password
Step 4  →  (Optional) Register your USB drive for hardware-locked auto-backup
Step 5  →  Click "Activate" to start real-time monitoring and sync
```

Once activated, the **Shield** indicator in the sidebar turns green, and Zephon will automatically sync changes to your target destination.

---

##  Usage Guide

### 1. Backup Module

The Backup module is the core of Zephon. It lets you configure one or more source files/folders, set a target destination, and control encryption, compression, and monitoring.

#### Adding Sources

| Action | How |
|---|---|
| **Add a folder** | Click the 📁+ button in the Backup panel header |
| **Add a file** | Click the 📄+ button in the Backup panel header |
| **Remove a source** | Click the 🗑️ trash icon on any item in the source list |

#### Configuring a Source

Select any source from the list to reveal its configuration panel:

- **Target Destination** — The folder where backups will be saved. Click **Browse** or paste a path directly. This is typically a USB drive path like `E:\Backups` or a local directory.

- **USB Hardware Lock** — If your target is on a USB drive, Zephon detects it automatically and shows the device info (Model, VID, PID, Serial Number). You can **Register** the USB to enable plug-and-play auto-backup.

- **Security & Pipeline**
  - **Enable Compression** — Toggle on/off. When enabled, files are gzip-compressed and folders are tar.gz-archived before saving.
  - **Enable Encryption** — Toggle on/off. When enabled, files are encrypted with AES-256-CBC. **A password is required.**
  - **Encryption Password** — Enter a passphrase for this specific source. Each source can have its own password.

- **Auto-Backup** — When enabled (and USB is registered), Zephon automatically starts a backup the moment your registered USB is plugged in.

#### Activating the Shield

| Button | Action |
|---|---|
| **Activate** | Starts real-time file monitoring + runs an initial full sync |
| **Deactivate** | Stops monitoring for the selected source |

> **Important:** The Activate button stays disabled until a target directory is set. If encryption is enabled, a password is also required.

#### How Sync Works

1. When you **Activate**, Zephon starts a [chokidar](https://github.com/paulmillr/chokidar) file watcher on your source path.
2. Any file addition, modification, or deletion triggers a **debounced auto-sync** (2-second delay to batch rapid changes).
3. Zephon compares current files against a **manifest** (stored at the target) to detect what changed.
4. Only changed files are re-synced, not the entire source.

#### Backup Modes

Depending on your toggle settings, Zephon uses one of three backup strategies:

| Encryption | Compression | Output Format | Description |
|---|---|---|---|
|  On |  On | `.vault` | Encrypted + compressed vault file |
|  On |  Off | `.vault` | Encrypted vault file (no compression) |
|  Off |  On | `.tar.gz` / `.gz` | Compressed archive (folders → tar.gz, files → gz) |
|  Off |  Off | Raw copy | Plain file/folder copy to target |

---

### 2. Encrypt Module

A standalone tool for one-off encryption. Navigate to it via the **Encrypt** tab in the sidebar.

#### Steps:

1. **Select Source** — Click **File** or **Folder** to pick what you want to encrypt.
2. **Enter Password** — Type your encryption passphrase.
3. **Output Folder** _(optional)_ — Choose where to save the `.vault` file. If left blank, it saves next to the source.
4. **Click "Encrypt"** — The encrypted `.vault` file is created.

> **Output:** A single `.vault` file containing your encrypted data. For folders, the contents are first archived with tar before encryption.

---

### 3. Compress Module

A standalone tool for one-off compression (no encryption). Navigate to it via the **Compress** tab in the sidebar.

#### Steps:

1. **Select Source** — Click **File** or **Folder** to pick what you want to compress.
2. **Output Folder** _(optional)_ — Choose where to save the compressed file. If left blank, it saves next to the source.
3. **Click "Compress"** — The compressed file is created.

| Source Type | Output |
|---|---|
| Single file | `filename.gz` |
| Folder | `foldername.tar.gz` |

---

### 4. Restore Module

Decrypt `.vault` files or decompress `.gz` / `.tar.gz` archives. Navigate to it via the **Restore** tab in the sidebar.

#### Steps:

1. **Select Source File** — Browse for a `.vault` or `.gz` / `.tar.gz` file.
2. **Enter Password** — Only required for `.vault` files.
3. **Select Output Directory** — Where the restored files will be placed.
4. **Click "Decrypt & Decompress"** — Files are restored to the output directory.

| Input File | Password Required | Output |
|---|---|---|
| `*.vault` |  Yes | Decrypted file or folder |
| `*.tar.gz` |  No | Extracted folder |
| `*.gz` |  No | Decompressed file |

---

## 🔌 USB Hardware Lock

Zephon can **fingerprint your USB drive** using its hardware identifiers (VID, PID, Serial Number) and bind backups to that specific device.

### How It Works

1. Set your **target directory** to a path on a USB drive (e.g., `E:\Backups`).
2. Zephon detects the USB device and displays its hardware info.
3. Click **Register USB** to bind the device.
4. Zephon writes a hidden `.zephon_id` token file to the USB root for verification.
5. The device signature (VID, PID, Serial, token) is saved locally.

### What Registration Enables

- **Identity Verification** — Zephon verifies both the hardware signature AND the token file before trusting a USB drive.
- **Plug & Play Detection** — Zephon polls for USB devices every 5 seconds. When your registered drive is detected, it triggers auto-backup.
- **Security** — Even if someone copies your USB data to another drive, the hardware signature won't match.

### Unregistering

Click **Unregister USB** to remove the binding. This deletes the `.zephon_id` token from the drive and clears the saved signature.

---

## ⚡ Auto-Backup (Plug & Play)

When both **USB Registration** and **Auto-Backup** are enabled:

```
1. Plug in your registered USB drive
2. Zephon detects it within ~5 seconds
3. Zephon checks for changes against the manifest
4. If changes exist → automatic encrypted backup begins
5. If no changes → logs "Backup is already up to date"
```

If auto-backup is disabled but the USB is registered, Zephon shows a **modal prompt** asking if you want to run a backup.

---

## 📁 File Formats

### `.vault` Files

Zephon's encrypted file format with the following binary structure:

| Offset | Size | Content |
|---|---|---|
| 0 | 16 bytes | AES Initialization Vector (IV) |
| 16 | 1 byte | Flags byte |
| 17 | Remaining | Encrypted ciphertext |

**Flags byte:**

| Value | Meaning |
|---|---|
| `0x00` | File, no compression |
| `0x01` | File, gzip-compressed before encryption |
| `0x02` | Folder (tar archive), no additional compression |
| `0x03` | Folder (tar archive), gzip-compressed before encryption |

### `.manifest.json` Files

Stored alongside backups at the target directory. Tracks the last sync state:

```json
{
  "lastSync": "2026-06-21T12:00:00.000Z",
  "sourceDirName": "MyFolder",
  "fileCount": 42,
  "totalSize": 1048576,
  "files": {
    "path/to/file.txt": {
      "mtime": 1750495200000,
      "size": 2048
    }
  }
}
```


### Key Design Decisions

- **Context Isolation** — `nodeIntegration: false` and `contextIsolation: true`. The renderer has zero direct access to Node.js APIs.
- **Preload Bridge** — All communication happens through `contextBridge.exposeInMainWorld()` via named IPC channels.
- **Debounced Sync** — File system events are debounced (500ms per file, 2s for sync trigger) to prevent rapid-fire operations.
- **Manifest-Based Diffing** — Instead of re-encrypting everything, Zephon compares file `mtime` and `size` against a stored manifest.

---

## 📂 Project Structure

```
Zephon/
├── main.js              # Electron main process — file watching, encryption, USB, sync
├── preload.js           # Context bridge — exposes safe APIs to the renderer
├── package.json         # Project config, scripts, and build settings
├── icon.ico             # Application icon (Windows)
├── icon.png             # Application icon (high-res)
├── .gitignore           # Git ignore rules
│
├── renderer/
│   ├── index.html       # Application UI layout (4 module panels + sidebar)
│   ├── app.js           # Renderer logic — event handlers, state management, UI updates
│   └── styles.css       # Application styling — dark theme, cards, animations
│
├── node_modules/        # Dependencies (not tracked in git)
└── dist/                # Build output (not tracked in git)
```

---

## 📦 Building for Production

Zephon uses [electron-builder](https://www.electron.build/) to create distributable installers.

### Build for Windows (MSI Installer)

```bash
npm run build
```

This generates an MSI installer in the `dist/` directory with:

-  Per-machine installation
-  Desktop shortcut
-  Custom icon

### Build Configuration

The build config is defined in `package.json`:

```json
{
  "build": {
    "appId": "com.zephon.app",
    "productName": "Zephon",
    "win": {
      "target": ["msi"],
      "icon": "icon.ico"
    },
    "msi": {
      "oneClick": false,
      "perMachine": true,
      "createDesktopShortcut": true
    }
  }
}
```

---

## ⚙️ Configuration Storage

All configuration is persisted in Electron's `userData` directory:

| File | Location | Purpose |
|---|---|---|
| `app-config.json` | `%APPDATA%/zephon/` | Folder configs, target paths, encryption/compression toggles |
| `usb-signature.json` | `%APPDATA%/zephon/` | Registered USB device signatures and tokens |

Configuration is loaded automatically on startup and saved whenever settings change.

---

##  Security Details

| Aspect | Implementation |
|---|---|
| **Algorithm** | AES-256-CBC (via Node.js `crypto` module) |
| **Key Derivation** | SHA-256 hash of user password |
| **IV** | 16 random bytes per encryption operation (stored in vault header) |
| **Compression** | Gzip (zlib) applied before encryption for compressible file types |
| **Context Isolation** | Renderer process has no direct Node.js access |
| **USB Token** | Cryptographically random 32-byte hex token stored as hidden file on USB |

### Compressible File Types

The following extensions are automatically compressed before encryption (if under 2 GB):

```
.txt  .docx  .xlsx  .csv  .json
.html  .md  .log  .pdf  .jpg  .png
```

### ⚠️ Important Security Notes

- **Remember your password.** There is no password recovery. If you forget it, your `.vault` files cannot be decrypted.
- **Key derivation uses SHA-256** (not a slow KDF like Argon2 or PBKDF2). For maximum security, use a strong, unique passphrase.
- **Backups are local only.** Nothing is sent to the cloud. Your data stays on your machine and your USB drive.

---

## 🔧 Troubleshooting

| Problem | Solution |
|---|---|
| **"Activate" button is disabled** | Make sure a target directory is set. If encryption is enabled, enter a password. |
| **USB not detected** | Ensure the USB is properly inserted. Zephon uses PowerShell WMI queries — try running the app as administrator. |
| **"Incorrect password or corrupted vault file"** | Double-check your password. The vault file may also be corrupted if the backup was interrupted. |
| **Auto-backup not triggering** | Verify that: (1) USB is registered, (2) Auto-backup toggle is on, (3) Shield is activated for folders targeting that USB. |
| **File watcher not detecting changes** | Some network drives or special file systems may not emit change events. Try deactivating and re-activating the shield. |
| **Build fails** | Run `npm install` again to ensure all dependencies are present. Check that you have the latest Node.js LTS. |

---

## 🛠️ Dependencies

| Package | Version | Purpose |
|---|---|---|
| [electron](https://www.electronjs.org/) | ^28.0.0 | Desktop application framework |
| [chokidar](https://github.com/paulmillr/chokidar) | ^3.6.0 | Cross-platform file system watching |
| [tar](https://github.com/isaacs/node-tar) | ^7.5.16 | Creating and extracting tar.gz archives |
| [electron-builder](https://www.electron.build/) | ^25.1.8 | Building distributable installers |

---

## 👤 Author

**R I N U**

- GitHub: [@rinu-thomas210](https://github.com/rinu-thomas210)

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---
