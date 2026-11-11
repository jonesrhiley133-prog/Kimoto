# Kimoto for Android

The Android app is the Kimoto web app packaged with [Capacitor](https://capacitorjs.com). The interface, reader and offline downloads are the same code, plus native features:

| Feature | How |
|---|---|
| Connect to any Kimoto server | Chosen on first launch; change it from the sign-in screen |
| Sign-in | Bearer token stored on the device (the web app uses a cookie) |
| Volume-button page turning | Custom `VolumeKeys` plugin, active only while the reader is open |
| Screen stays on while reading | `@capacitor-community/keep-awake` |
| Hardware back button | Goes back in the app; exits from the first screen |
| Status bar | Matches your theme; hides with the reader toolbar |
| Notifications | System notifications for new chapters, messages, replies and other events, while the app is running in the background |
| Offline reading | Downloads are stored on the device (IndexedDB). The app opens and reads downloads with no connection |
| Export / MAL XML | Saved through the Android share sheet |
| MAL / AniList connect | Opens in the system browser; switch back to the app when done |

## Install

Every push builds an APK in GitHub Actions (**Actions → Android app → latest run → Artifacts → `kimoto-debug-apk`**). Tagged releases (`v*`) also attach the APK to the GitHub release.

1. Download and unzip the artifact, then copy `app-debug.apk` to your phone.
2. Open it and allow installing from that source when Android asks.
3. Launch **Kimoto** and enter your server address, for example `https://kimoto.example.com`, or `http://192.168.1.20:4000` for a computer on your home network.

> The server must be reachable from the phone. For a server on your computer, start it with `PORT=4000`, use the computer's LAN IP, and allow the port through its firewall.

## Server configuration

The app calls the API from its own origin (`https://localhost`), so the server allows that origin for cross-origin requests. The default `APP_ORIGINS=https://localhost,http://localhost,capacitor://localhost` covers Android and iOS; only change it if you customize the app's scheme.

## Build it yourself

You need Node 22, JDK 21 and the Android SDK (Android Studio installs it).

```bash
npm install
```

Build the web bundle and copy it into the Android project:

```bash
npm run android
```

Then either open it in Android Studio and press Run:

```bash
npm run android:open -w web
```

…or build a debug APK from the command line (output: `web/android/app/build/outputs/apk/debug/app-debug.apk`):

```bash
npm run android:apk
```

Optionally bake in a default server, so users don't have to type it:

```bash
VITE_DEFAULT_SERVER=https://kimoto.example.com npm run android
```

## Signed releases (Play Store / sideloading)

Create a keystore once and keep it safe; you need the same key for every update:

```bash
keytool -genkey -v -keystore kimoto.keystore -alias kimoto -keyalg RSA -keysize 2048 -validity 10000
```

Add these repository secrets (**Settings → Secrets and variables → Actions**):

| Secret | Value |
|---|---|
| `KIMOTO_KEYSTORE_BASE64` | output of `base64 -w0 kimoto.keystore` |
| `KIMOTO_KEYSTORE_PASSWORD` | keystore password |
| `KIMOTO_KEY_ALIAS` | `kimoto` (or your alias) |
| `KIMOTO_KEY_PASSWORD` | key password |

The workflow then also produces a signed `app-release.apk` and an `app-release.aab` (the App Bundle Google Play expects). Locally, set the same variables, plus `KIMOTO_KEYSTORE_FILE=/path/to/kimoto.keystore`, and run `./gradlew assembleRelease bundleRelease` in `web/android`.

## Known limitations

- **Notifications while the app is fully closed** need Firebase Cloud Messaging (a `google-services.json` and server-side FCM sending). This build shows notifications while Kimoto runs in the background; the server's Web Push can't reach Android apps.
- **Discord Rich Presence** is desktop-only (Discord doesn't offer it on Android), so the setting is hidden in the app.
- **iOS:** Capacitor supports it with the same code. Run `npx cap add ios` in `web/` on a Mac with Xcode. It isn't included here because it can't be built or tested without macOS.
