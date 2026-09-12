# PBN Game Time Controller — iOS / Codemagic

This repository is the iOS TestFlight source for PBN Game Time Controller.

- App name: `PBN Game Time Controller`
- Bundle ID: `tv.pbnetwork.gametimecontroller`
- Marketing version: `1.0.0`
- Build number: assigned automatically from Codemagic's `BUILD_NUMBER`
- Native runtime: Capacitor 8
- Web directory: `www`
- Supported device family for this first build: iPhone
- Supported orientation: Portrait

## Local verification

```sh
npm install
npm test
npm run build
```

The native `ios/` directory is intentionally generated on the Codemagic Mac.
It is excluded from Git so every build begins from the committed Capacitor
configuration and cannot contain stale Xcode signing settings.

## Codemagic setup

1. Add this GitHub repository to Codemagic.
2. Create an App Store Connect API key named `PBN Codemagic` with App Manager
   access and add it under Codemagic Team integrations > Developer Portal.
3. Add or generate an Apple Distribution certificate in Codemagic.
4. Add or fetch the App Store provisioning profile matching
   `tv.pbnetwork.gametimecontroller`.
5. Start the `PBN Game Time Controller — TestFlight` workflow.

The workflow builds a signed IPA and uploads it to App Store Connect. It does
not automatically submit the app for public App Store review or external beta
review. After Apple processes the first build, add it to an internal TestFlight
group in App Store Connect.

## Security

Never commit `.p8`, `.p12`, `.mobileprovision`, environment files, or provider
credentials. Signing secrets belong only in Codemagic and App Store Connect.
