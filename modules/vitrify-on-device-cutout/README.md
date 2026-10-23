# Android on-device cutout — development-only, OFF by default

Local Expo module (automatically discovered under `modules/`), using the native
Android ONNX Runtime 1.23.2 Maven package. No JS tensor/image round trips, no
HTTP provider dispatch, no new Storage writer and no paid build service.
Existing V1 HTTP and V2 sources are retained; V2 stays OFF.

The bundled 4,574,861-byte u2netp.onnx is copied unchanged from the existing
local rembg model. Its SHA-256 is checked before creating an ORT session.
The Gradle dependency is native Android ONNX Runtime rather than the JS
`onnxruntime-react-native` bridge: preprocessing and postprocessing also need
to stay native, and Expo Modules supplies the React Native bridge here.

## Controlled development APK

Prerequisites: an SDK-compatible JDK/Android SDK (including NDK/CMake required
by this Expo/RN project), JAVA_HOME, ANDROID_HOME and a USB-debug-enabled phone
with ADB. No subscription or cloud builder is required. No AAB is produced.
With those installed, `npx expo run:android --variant debug` generates native
projects, compiles an APK and installs it on the selected phone. Do not use
Expo Go; the module is not in that binary. Expo prebuild completed here, but its
ADB daemon could not start. Direct Gradle assembly/unit-test startup then stopped
with `JAVA_HOME is not set and no 'java' command could be found in your PATH`.
No Kotlin compilation or APK was produced; SDK completeness, native compatibility,
Kotlin unit tests and device performance remain UNVERIFIED. No tool installation
or repeated build loop was attempted.

Once the toolchain is available, compilation alone does not need ADB/a phone:

```powershell
cd android
.\gradlew.bat :vitrify-on-device-cutout:testDebugUnitTest :app:assembleDebug --no-daemon
```

Keep the opt-in unset for ordinary builds. For the controlled test only:

```powershell
$env:EXPO_PUBLIC_WARDROBE_ON_DEVICE_CUTOUT = 'true'
npx expo start --dev-client --clear
```

The feature also checks __DEV__, Android platform and Android FLAG_DEBUGGABLE;
a release APK cannot enable it via this environment setting. Missing native
support fails closed without falling back to the HTTP provider.

APK path after a successful local build is normally
`android/app/build/outputs/apk/debug/app-debug.apk`; manual installation is
`adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.

## Processing and safety

- Dedicated single native worker. Admission stays reserved until JS's awaited
  release; competing process calls fail BUSY instead of retaining more images.
- Read only an owner-checked private original. Decode RGB without modifying
  the original; apply all eight EXIF orientations, thumbnail to 1600 maximum,
  Lanczos3 resize to 320x320, image-maximum/mean/std normalization, float32 NCHW.
- CPU ORT session loads on demand, uses two intra-op/one inter-op threads and
  closes with results/tensors after each job. No resident eager startup session.
- First output mask: finite check, min/max normalization, uint8, Lanczos3 resize,
  rembg naive RGBA composite, PNG color type 6; no EXIF/GPS chunks. Constant and
  all-empty/all-opaque masks fail safely. Android/Pillow decoder and Lanczos
  rounding parity must still be measured on device, not assumed bit-exact.
- Native inference/encoding yields a volatile handle. Only after reacquiring
  the account guard and persisting/read-backing an owned-file CREATING intent
  does native code write/fsync the exact PNG path. JS verifies file length
  before READY. Finally awaits native buffer wipe/release; the enclosing
  existing workflow keeps deletion drain pending until actual completion.
- Existing store checks item/original identity before publishing a result and
  persists its PNG checkpoint, invokes the existing accountStorageUpload
  writer/reconciliation/signing and updates the card. No direct bucket.upload.
- Old HTTP provider UNKNOWN and old blocked garments are neither read as local
  jobs nor changed/retried. A new local job is independent of that remote journal.
  A native crash can still leave the store's existing conservative blocked state;
  no legacy status reset or speculative recovery is included in this change.
- 12 MiB source/output and 40 MP decode bounds, plus a conservative Java heap
  headroom check. Large originals can be rejected without a lower-quality retry.
  These limits cannot guarantee against native-heap OOM on every Android phone.

## One-device acceptance

Use a new cloud-confirmed garment (old blocked/UNKNOWN items remain untouched).
Expect processing, a PNG checkpoint and automatic card update after safe upload.
Repeat locally with a synthetic fixture for cold/warm timing and verify EXIF,
transparent edges and visual parity with the existing Python result. CPU runs
offline; cloud confirmation and Storage still require network access.
During a local job, change account or start deletion: no late result may publish,
and drain must await completion/release. Do not clear journals or resubmit old
UNKNOWN uploads as a workaround. No such live test has been executed here.

Development-only `wardrobe_on_device_timing` logs contain numeric
preprocessingMs, modelLoadMs, inferenceMs, pngEncodeMs, totalMs and
sampledPssMaxKb. peakMemoryBytes is null: sampled process PSS is NOT a measured
peak. No owner, item, file path, photo, token or request handle is logged.
Times cover native computation; existing stage timings cover upload/checkpoint.
Device duration, peak memory, heat, dropped frames and native build compatibility
remain UNKNOWN until measured. JVM math/PNG tests exist under android/src/test;
they require the same missing JDK/SDK and have not run.
