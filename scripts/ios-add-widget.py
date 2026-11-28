#!/usr/bin/env python3
"""Adds the Crowder Desk home/lock screen widget (ios-widget/) to the Xcode project
that `tauri ios init` generates, then the workflow re-runs XcodeGen.

Tauri has no setting for app extensions, so this edits gen/apple/project.yml:
- appends a WidgetKit extension target built from ios-widget/Sources
- makes the app target depend on it, which embeds it in the app's PlugIns folder
- gives the app and the widget the App Group they share data through
  (ios-widget/*.entitlements; the workflow ad-hoc signs with them so sideloading
  tools see the request)
"""
import pathlib, plistlib, re, sys

apple = pathlib.Path("src-tauri/gen/apple")
spec = apple / "project.yml"
text = spec.read_text()
if "CrowderDeskWidget:" in text:
    print("Widget target already present.")
    sys.exit(0)

# The app target's name ends in _iOS (e.g. crowder-desk_iOS).
m = re.search(r"^  (\S+_iOS):\s*$", text, re.M)
if not m:
    sys.exit("Couldn't find the app target in project.yml")
app = m.group(1)

# Version numbers and bundle id from the generated app Info.plist / project.
info = plistlib.loads((apple / app / "Info.plist").read_bytes())
short = str(info.get("CFBundleShortVersionString", "1.0.0"))
build = str(info.get("CFBundleVersion", short))
bid = re.search(r"PRODUCT_BUNDLE_IDENTIFIER:\s*(\S+)", text)
bundle_id = (bid.group(1) if bid else "com.crowder.desk") + ".widget"

# 1) the app depends on (and embeds) the widget. The app target is the only one with dependencies.
if text.count("\n    dependencies:\n") != 1:
    sys.exit("Expected exactly one dependencies list in project.yml")
text = text.replace("\n    dependencies:\n", "\n    dependencies:\n      - target: CrowderDeskWidget\n        embed: true\n", 1)

# 2) the widget target (targets: is the last top-level key in Tauri's template).
text = text.rstrip("\n") + f"""
  CrowderDeskWidget:
    type: app-extension
    platform: iOS
    deploymentTarget: "16.0"
    sources:
      - path: ../../../ios-widget/Sources
    info:
      path: CrowderDeskWidget/Info.plist
      properties:
        CFBundleDisplayName: Crowder Desk
        CFBundleShortVersionString: "{short}"
        CFBundleVersion: "{build}"
        NSExtension:
          NSExtensionPointIdentifier: com.apple.widgetkit-extension
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: {bundle_id}
        PRODUCT_NAME: CrowderDeskWidget
        SWIFT_VERSION: "5.0"
        TARGETED_DEVICE_FAMILY: "1,2"
        SKIP_INSTALL: true
        ARCHS: [arm64]
        EXCLUDED_ARCHS[sdk=iphoneos*]: x86_64
        LD_RUNPATH_SEARCH_PATHS: "$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"
    dependencies:
      - sdk: WidgetKit.framework
      - sdk: SwiftUI.framework
    entitlements:
      path: ../../../ios-widget/widget.entitlements
"""

# 3) the app's entitlements: Tauri's file plus the App Group.
m_ent = re.search(r"entitlements:\s*\n\s*path:\s*(\S+)", text)
app_ent = apple / (m_ent.group(1) if m_ent else f"{app}/{app}.entitlements")
ent = {}
if app_ent.exists() and app_ent.read_bytes().strip():
    ent = plistlib.loads(app_ent.read_bytes())
group = plistlib.loads(pathlib.Path("ios-widget/app.entitlements").read_bytes())
ent.update(group)
app_ent.parent.mkdir(parents=True, exist_ok=True)
app_ent.write_bytes(plistlib.dumps(ent))

spec.write_text(text)
print(f"Added CrowderDeskWidget ({bundle_id}, {short}) to {app}.")
