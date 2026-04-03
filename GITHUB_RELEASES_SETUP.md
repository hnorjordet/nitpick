# GitHub Releases and Auto-Update Setup Guide

This guide explains how to set up GitHub Releases and auto-updates for XLIFF RegEx Tool.

## Part 1: Prerequisites ✅ COMPLETED

### 1.1 Create GitHub Repository ✅

Repository created at: https://github.com/hnorjordet/xliff-regex-tool

### 1.2 Push Code to GitHub ✅

Code has been pushed to GitHub (commit: dfe97b8)

## Part 2: Generate Signing Keys

For security, Tauri uses cryptographic signatures for updates. You need to generate a key pair.

### 2.1 Generate Key Pair

```bash
cd gui
npm run tauri signer generate -- --write-keys ~/.tauri/xliff-regex-tool.key
```

This will:
- Create a private key in `~/.tauri/xliff-regex-tool.key`
- Display the public key in the terminal (looks like: `dW50cnVzdGVkIGNvbW1lbnQ6...`)

### 2.2 Update tauri.conf.json

Copy the public key and replace `PLACEHOLDER_WILL_BE_GENERATED` in `gui/src-tauri/tauri.conf.json`:

```json
"plugins": {
  "updater": {
    "active": true,
    "endpoints": [
      "https://github.com/hnorjordet/xliff-regex-tool/releases/latest/download/latest.json"
    ],
    "dialog": true,
    "pubkey": "YOUR_PUBLIC_KEY_HERE"
  }
}
```

**IMPORTANT**: The private key (`~/.tauri/xliff-regex-tool.key`) must be kept secret! Never commit it to Git.

## Part 3: Build and Publish Release

### 3.1 Build the Application

```bash
cd gui
npm run tauri build
```

This will create:
- DMG: `src-tauri/target/release/bundle/dmg/XLIFF RegEx Tool_0.4.3_aarch64.dmg`
- App: `src-tauri/target/release/bundle/macos/XLIFF RegEx Tool.app`

### 3.2 Sign the DMG

```bash
npx tauri signer sign "src-tauri/target/release/bundle/dmg/XLIFF RegEx Tool_0.4.3_aarch64.dmg" --private-key-path ~/.tauri/xliff-regex-tool.key
```

This will output a signature that looks like: `dW50cnVzdGVkIGNvbW1lbnQ6...`

### 3.3 Create latest.json

Create a `latest.json` file with the following content:

```json
{
  "version": "0.4.3",
  "notes": "See CHANGELOG.md for full list of changes",
  "pub_date": "2026-02-05T21:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "SIGNATURE_FROM_STEP_3.2_HERE",
      "url": "https://github.com/hnorjordet/xliff-regex-tool/releases/download/v0.4.3/XLIFF.RegEx.Tool_0.4.3_aarch64.dmg"
    }
  }
}
```

Replace:
- `SIGNATURE_FROM_STEP_3.2_HERE` with the signature from the previous step
- Adjust the URL if needed (must match the GitHub release URL)

### 3.4 Create GitHub Release

1. Go to GitHub repository
2. Click on "Releases" → "Create a new release"
3. Tag version: `v0.4.3`
4. Release title: `v0.4.3 - Markdown Changelog & Tag Protection Fix`
5. Description: Copy from CHANGELOG.md
6. Upload files:
   - `XLIFF.RegEx.Tool_0.4.3_aarch64.dmg` (rename to remove spaces)
   - `latest.json`
7. Click "Publish release"

## Part 4: Test Auto-Update

### 4.1 Install Current Version

Send the DMG to users and have them install it.

### 4.2 Publish a New Version

When you've made changes:

1. Update version number in:
   - `gui/package.json`
   - `gui/src-tauri/tauri.conf.json`
   - `gui/src/App.tsx`
   - `USER_GUIDE.html`
   - `CHANGELOG.md`

2. Commit and push changes

3. Build new version:
   ```bash
   cd gui
   npm run tauri build
   ```

4. Generate new signature for DMG

5. Update `latest.json` with new version, new signature, and new URL

6. Create new GitHub Release with new tag (e.g., `v0.4.4`)

### 4.3 Users Get Updates

When users open the app:
- It automatically checks GitHub for updates on startup
- If a new version is available, they get a dialog asking if they want to update
- If they click "Yes", the new version is downloaded and installed automatically
- The app restarts with the new version

Users can also manually check for updates via the menu: **Help → Check for Updates...**

## Part 5: Automation (Optional)

To make the process easier, you can:

1. **Use GitHub Actions** to automatically build and publish releases when you push a new tag
2. **Create a script** to automatically update version numbers in all files
3. **Use Tauri's GitHub Action** which handles building, signing, and publishing

Example GitHub Actions workflow coming in future updates!

## Important Notes

- **Private key** must never be shared or committed to Git
- **Version number** must be consistent across all files
- **latest.json** must always point to the newest version
- **GitHub repository** must be public for free auto-update
- **Signature** must be regenerated for each new DMG

## Troubleshooting

### "Failed to check for updates"
- Check that GitHub repository is public
- Verify that `latest.json` URL in `tauri.conf.json` is correct

### "Invalid signature"
- Ensure you're using the same private key for all releases
- Check that the signature in `latest.json` matches the DMG file

### "Update not detected"
- Ensure the version number in `latest.json` is higher than the installed version
- Check that `latest.json` has the correct format

## Resources

- [Tauri Updater Documentation](https://v2.tauri.app/plugin/updater/)
- [Tauri GitHub Actions](https://github.com/tauri-apps/tauri-action)
