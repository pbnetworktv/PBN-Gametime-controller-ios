#!/bin/bash
set -euo pipefail

PLIST_PATH="ios/App/App/Info.plist"
ICON_PATH="ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
PROJECT_PATH="ios/App/App.xcodeproj/project.pbxproj"

if [[ ! -f "$PLIST_PATH" ]]; then
  echo "Missing generated iOS Info.plist at $PLIST_PATH" >&2
  exit 1
fi

/usr/libexec/PlistBuddy -c "Add :ITSAppUsesNonExemptEncryption bool false" "$PLIST_PATH" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Set :ITSAppUsesNonExemptEncryption false" "$PLIST_PATH"

# The Geolocation plugin validates both purpose strings. It requests location
# only when a member claims a staff role; no background tracking is enabled.
LOCATION_PURPOSE="Game Time Controller checks that you are at the event field when you claim a staff role."
for LOCATION_KEY in NSLocationWhenInUseUsageDescription NSLocationAlwaysAndWhenInUseUsageDescription; do
  /usr/libexec/PlistBuddy -c "Add :$LOCATION_KEY string $LOCATION_PURPOSE" "$PLIST_PATH" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c "Set :$LOCATION_KEY $LOCATION_PURPOSE" "$PLIST_PATH"
done

/usr/libexec/PlistBuddy -c "Delete :UISupportedInterfaceOrientations" "$PLIST_PATH" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :UISupportedInterfaceOrientations array" "$PLIST_PATH"
/usr/libexec/PlistBuddy -c "Add :UISupportedInterfaceOrientations:0 string UIInterfaceOrientationPortrait" "$PLIST_PATH"

if ! /usr/libexec/PlistBuddy -c "Print :CFBundleURLTypes" "$PLIST_PATH" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" "$PLIST_PATH"
fi
if ! /usr/libexec/PlistBuddy -c "Print :CFBundleURLTypes" "$PLIST_PATH" | grep -Fq 'pbngametimecontroller'; then
  /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0 dict" "$PLIST_PATH"
  /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLName string tv.pbnetwork.gametimecontroller.staff" "$PLIST_PATH"
  /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PLIST_PATH"
  /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string pbngametimecontroller" "$PLIST_PATH"
fi

# The controller canvas is an iPhone-first 390×844 operating surface. Limiting
# the initial TestFlight target avoids requiring separate iPad screenshots.
perl -0pi -e 's/TARGETED_DEVICE_FAMILY = "1,2";/TARGETED_DEVICE_FAMILY = 1;/g' "$PROJECT_PATH"

if [[ -f "resources/AppIcon-1024.png" ]]; then
  cp "resources/AppIcon-1024.png" "$ICON_PATH"
fi

echo "Configured iOS metadata and PBN app icon."
