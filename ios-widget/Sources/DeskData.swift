import Foundation

// What the widget shows, fetched straight from the same public sources the app uses:
// Open-Meteo for weather, and Supabase (publishable key, public read) for the recipe
// list and the latest Picket Station briefing. The last good copy is cached so the
// widget still has something to show when a refresh fails.

enum Config {
    // Same default location as the app (Settings → Weather). The widget can't read the
    // app's settings yet, so change these if you move.
    static let placeName = "Mesa"
    static let lat = 33.4152
    static let lon = -111.8315
    static let fahrenheit = true

    static let supabaseURL = "https://htkbjbfjipbrzidnafrs.supabase.co"
    static let supabaseKey = "sb_publishable_XhiTniGMnL449MnIPNAGtw_7Hvi_T9i"
}

struct Weather: Codable {
    var temp: Double
    var feels: Double
    var code: Int
    var isDay: Bool
    var days: [Day]
}

struct Day: Codable, Hashable {
    var date: String // yyyy-MM-dd
    var code: Int
    var hi: Double
    var lo: Double
    var rain: Double?
}

struct Recipe: Codable {
    var title: String
    var time: String?
}

struct Story: Codable, Hashable {
    var desk: String
    var topic: String?
    var headline: String
}

struct Snapshot: Codable {
    var weather: Weather?
    var weatherAt: Date?
    var recipe: Recipe?
    var recipeDay: String?
    var stories: [Story] = []
    var briefingDate: String?

    /// Picks a story for the moment shown, so the widget steps through the briefing hour by hour.
    func story(at date: Date) -> Story? {
        guard !stories.isEmpty else { return nil }
        let hour = Calendar.current.component(.hour, from: date)
        return stories[hour % stories.count]
    }

    static let sample = Snapshot(
        weather: Weather(temp: 72, feels: 70, code: 2, isDay: true, days: [
            Day(date: "2026-11-28", code: 2, hi: 76, lo: 52, rain: 0),
            Day(date: "2026-11-29", code: 0, hi: 78, lo: 54, rain: 0),
            Day(date: "2026-11-30", code: 1, hi: 75, lo: 51, rain: 10),
            Day(date: "2026-12-01", code: 61, hi: 68, lo: 49, rain: 60),
        ]),
        weatherAt: Date(),
        recipe: Recipe(title: "Green chile chicken enchiladas", time: "45 min"),
        recipeDay: nil,
        stories: [Story(desk: "space", topic: "Launch", headline: "Next crewed flight cleared for launch window")],
        briefingDate: nil
    )
}

enum Loader {
    private static let cacheKey = "crowder-desk.widget.snapshot"

    static func cached() -> Snapshot? {
        guard let d = UserDefaults.standard.data(forKey: cacheKey) else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: d)
    }

    private static func save(_ s: Snapshot) {
        if let d = try? JSONEncoder().encode(s) { UserDefaults.standard.set(d, forKey: cacheKey) }
    }

    /// Fetches everything it can; anything that fails keeps its last good value.
    static func load() async -> Snapshot {
        var snap = cached() ?? Snapshot()
        async let w = fetchWeather()
        async let r = fetchRecipeOfTheDay()
        async let b = fetchBriefing()
        if let weather = await w { snap.weather = weather; snap.weatherAt = Date() }
        if let recipe = await r { snap.recipe = recipe; snap.recipeDay = dayKey(Date()) }
        if let briefing = await b { snap.briefingDate = briefing.0; snap.stories = briefing.1 }
        save(snap)
        return snap
    }

    static func dayKey(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    private static func get(_ url: URL, headers: [String: String] = [:]) async -> Data? {
        var req = URLRequest(url: url, timeoutInterval: 15)
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        guard let result = try? await URLSession.shared.data(for: req),
              let http = result.1 as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        return result.0
    }

    // MARK: weather

    private struct OMResponse: Decodable {
        struct Current: Decodable {
            let temperature_2m: Double
            let apparent_temperature: Double
            let weather_code: Int
            let is_day: Int
        }
        struct Daily: Decodable {
            let time: [String]
            let weather_code: [Int]
            let temperature_2m_max: [Double]
            let temperature_2m_min: [Double]
            let precipitation_probability_max: [Double?]?
        }
        let current: Current
        let daily: Daily
    }

    private static func fetchWeather() async -> Weather? {
        var c = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        c.queryItems = [
            URLQueryItem(name: "latitude", value: String(Config.lat)),
            URLQueryItem(name: "longitude", value: String(Config.lon)),
            URLQueryItem(name: "current", value: "temperature_2m,apparent_temperature,weather_code,is_day"),
            URLQueryItem(name: "daily", value: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"),
            URLQueryItem(name: "temperature_unit", value: Config.fahrenheit ? "fahrenheit" : "celsius"),
            URLQueryItem(name: "timezone", value: "auto"),
            URLQueryItem(name: "forecast_days", value: "4"),
        ]
        guard let url = c.url, let data = await get(url),
              let om = try? JSONDecoder().decode(OMResponse.self, from: data) else { return nil }
        let d = om.daily
        let n = min(d.time.count, d.weather_code.count, d.temperature_2m_max.count, d.temperature_2m_min.count)
        let rain: [Double?] = d.precipitation_probability_max ?? []
        var days: [Day] = []
        for i in 0..<n {
            let r: Double? = i < rain.count ? rain[i] : nil
            days.append(Day(date: d.time[i], code: d.weather_code[i],
                            hi: d.temperature_2m_max[i], lo: d.temperature_2m_min[i], rain: r))
        }
        return Weather(temp: om.current.temperature_2m, feels: om.current.apparent_temperature,
                       code: om.current.weather_code, isDay: om.current.is_day == 1, days: days)
    }

    // MARK: Supabase

    private static func rest(_ path: String, schema: String = "public") async -> Data? {
        guard let url = URL(string: "\(Config.supabaseURL)/rest/v1/\(path)") else { return nil }
        var h = ["apikey": Config.supabaseKey]
        if schema != "public" { h["Accept-Profile"] = schema }
        return await get(url, headers: h)
    }

    /// One recipe a day, picked from the Crowder Kitchen list by the date (the same pick all day).
    private static func fetchRecipeOfTheDay() async -> Recipe? {
        guard let data = await rest("recipes?select=title,time&order=title.asc", schema: "plico"),
              let list = try? JSONDecoder().decode([Recipe].self, from: data), !list.isEmpty else { return nil }
        // FNV-1a, like hash() in src/api.js.
        var h: UInt32 = 2_166_136_261
        for u in dayKey(Date()).utf16 { h ^= UInt32(u); h = h &* 16_777_619 }
        return list[Int(h % UInt32(list.count))]
    }

    private struct BriefingRow: Decodable {
        struct Item: Decodable { let headline: String?; let topic: String? }
        struct DataField: Decodable { let desks: [String: [Item]]? }
        let briefing_date: String
        let data: DataField?
    }

    private static func fetchBriefing() async -> (String, [Story])? {
        guard let data = await rest("news_briefings?select=briefing_date,data&order=briefing_date.desc&limit=1"),
              let rows = try? JSONDecoder().decode([BriefingRow].self, from: data),
              let row = rows.first else { return nil }
        let desks = row.data?.desks ?? [:]
        let order = ["defense", "space", "tech"] + desks.keys.sorted().filter { !["defense", "space", "tech"].contains($0) }
        let stories = order.flatMap { desk in
            (desks[desk] ?? []).compactMap { item -> Story? in
                guard let h = item.headline, !h.isEmpty else { return nil }
                return Story(desk: desk, topic: item.topic, headline: h)
            }
        }
        return (row.briefing_date, stories)
    }
}
