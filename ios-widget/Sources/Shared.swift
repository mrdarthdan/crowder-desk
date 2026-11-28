import Foundation

// Reads shared.json, which the iPhone app writes into an App Group folder (see
// `mod shared` in src-tauri/src/lib.rs and syncShared in src/api.js).
// Sideloading tools rename the App Group when they re-sign, so the widget looks for
// the real name the same way the app does: ALTAppGroups in Info.plist (AltStore),
// then the groups in its provisioning profile (Sideloadly), then the build-time name.

struct SharedLocation: Codable {
    var name: String
    var lat: Double
    var lon: Double
}

struct SharedSession: Codable {
    var access_token: String
    var refresh_token: String
    var expires_at: Double // ms since 1970
    var email: String?
    var user_id: String?
}

struct SharedState: Decodable {
    var location: SharedLocation?
    var units: String?
    var newsDesk: String?
    var session: SharedSession?
    var sessionAt: Double?
}

enum Shared {
    static let buildGroup = "group.com.crowder.desk"

    private static func groups(in plist: [String: Any]?, key: String) -> [String] {
        (plist?[key] as? [String]) ?? []
    }

    private static func profileGroups(_ bundle: URL) -> [String] {
        guard let data = try? Data(contentsOf: bundle.appendingPathComponent("embedded.mobileprovision")) else { return [] }
        let text = String(decoding: data, as: UTF8.self)
        guard let a = text.range(of: "<?xml"), let b = text.range(of: "</plist>", options: .backwards),
              a.lowerBound < b.upperBound,
              let xml = String(text[a.lowerBound..<b.upperBound]).data(using: .utf8),
              let plist = try? PropertyListSerialization.propertyList(from: xml, format: nil) as? [String: Any],
              let ent = plist["Entitlements"] as? [String: Any] else { return [] }
        return (ent["com.apple.security.application-groups"] as? [String]) ?? []
    }

    /// App Group names this install may have, most likely first.
    static func candidates() -> [String] {
        let ext = Bundle.main.bundleURL // …/Crowder Desk.app/PlugIns/CrowderDeskWidget.appex
        let app = ext.deletingLastPathComponent().deletingLastPathComponent()
        var out: [String] = []
        out += groups(in: Bundle.main.infoDictionary, key: "ALTAppGroups")
        out += groups(in: Bundle(url: app)?.infoDictionary, key: "ALTAppGroups")
        out += profileGroups(ext)
        out += profileGroups(app)
        out.append(buildGroup)
        var seen = Set<String>()
        let unique = out.filter { seen.insert($0).inserted }
        return unique.filter { $0.contains("crowder") } + unique.filter { !$0.contains("crowder") }
    }

    /// The shared folder and its App Group name, if this install was given one.
    static func folder() -> (group: String, url: URL)? {
        for g in candidates() {
            if let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: g) {
                return (g, url)
            }
        }
        return nil
    }

    private static var fileURL: URL? { folder()?.url.appendingPathComponent("shared.json") }

    static func read() -> SharedState? {
        guard let url = fileURL, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(SharedState.self, from: data)
    }

    /// Writes a renewed (or ended) session back, keeping everything else the app wrote.
    /// Skips the write if the app changed the session after `basedOn`.
    private static func writeSession(_ s: SharedSession?, basedOn: Double) {
        guard let url = fileURL else { return }
        var dict: [String: Any] = [:]
        if let data = try? Data(contentsOf: url),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { dict = obj }
        if let at = dict["sessionAt"] as? Double, at > basedOn { return }
        if let s = s {
            dict["session"] = [
                "access_token": s.access_token, "refresh_token": s.refresh_token,
                "expires_at": s.expires_at, "email": s.email ?? "", "user_id": s.user_id ?? "",
            ] as [String: Any]
        } else {
            dict["session"] = NSNull()
        }
        dict["sessionAt"] = Date().timeIntervalSince1970 * 1000
        guard let out = try? JSONSerialization.data(withJSONObject: dict) else { return }
        try? out.write(to: url, options: .atomic)
    }

    /// A Blog Plan access token, renewing the session when it has run out.
    static func accessToken(_ state: SharedState) async -> String? {
        guard let s = state.session, !s.refresh_token.isEmpty else { return nil }
        let nowMs = Date().timeIntervalSince1970 * 1000
        if !s.access_token.isEmpty, nowMs < s.expires_at - 60_000 { return s.access_token }

        guard let url = URL(string: "\(Config.supabaseURL)/auth/v1/token?grant_type=refresh_token") else { return nil }
        var req = URLRequest(url: url, timeoutInterval: 15)
        req.httpMethod = "POST"
        req.setValue(Config.supabaseKey, forHTTPHeaderField: "apikey")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["refresh_token": s.refresh_token])
        guard let result = try? await URLSession.shared.data(for: req),
              let http = result.1 as? HTTPURLResponse else { return nil }
        if http.statusCode == 400 || http.statusCode == 401 {
            // Same as the app: a refused refresh token means the sign-in has ended.
            writeSession(nil, basedOn: state.sessionAt ?? 0)
            return nil
        }
        guard (200..<300).contains(http.statusCode),
              let j = try? JSONSerialization.jsonObject(with: result.0) as? [String: Any],
              let access = j["access_token"] as? String, let refresh = j["refresh_token"] as? String else { return nil }
        let expiresIn = (j["expires_in"] as? Double) ?? 3600
        let renewed = SharedSession(access_token: access, refresh_token: refresh,
                                    expires_at: Date().timeIntervalSince1970 * 1000 + expiresIn * 1000,
                                    email: s.email, user_id: s.user_id)
        writeSession(renewed, basedOn: state.sessionAt ?? 0)
        return access
    }
}
