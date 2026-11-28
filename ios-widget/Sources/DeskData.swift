import Foundation

// What the widget shows, fetched straight from the same public sources the app uses:
// Open-Meteo for weather, and Supabase (publishable key, public read) for the recipe
// list and the latest Picket Station briefing. The last good copy is cached so the
// widget still has something to show when a refresh fails.

enum Config {
    // Used until the app has shared its settings (or when the install has no App Group).
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

struct PlanTask: Codable, Hashable {
    var title: String
    var section: String?
    var due: String? // yyyy-MM-dd
}

struct Outing: Codable, Hashable {
    var spot: String
    var date: String // yyyy-MM-dd
    var session: String
}

/// Blog Plan and Shoot Planner, which need the app's sign-in.
struct Plans: Codable {
    enum Status: String, Codable { case ok, signedOut, noGroup, offline }
    var status: Status
    var tasks: [PlanTask] = []
    var outing: Outing?
}

struct Snapshot: Codable {
    var place: String?
    var lat: Double?
    var lon: Double?
    var fahrenheit: Bool?
    var plans: Plans?
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

    var placeName: String {
        // "Mesa, Arizona" → "Mesa"
        (place ?? Config.placeName).split(separator: ",").first.map(String.init) ?? Config.placeName
    }
    var latitude: Double { lat ?? Config.lat }
    var longitude: Double { lon ?? Config.lon }

    static let sample = Snapshot(
        place: "Mesa, Arizona", lat: Config.lat, lon: Config.lon, fahrenheit: true,
        plans: Plans(status: .ok, tasks: [
            PlanTask(title: "Draft the Superstition sunrise post", section: "Writing", due: "2026-11-30"),
            PlanTask(title: "Export prints for the store", section: "Store", due: nil),
        ], outing: Outing(spot: "Lost Dutchman", date: "2026-11-29", session: "sunrise")),
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
        let hasGroup = Shared.folder() != nil
        let shared = Shared.read()

        let loc = shared?.location
        let lat = loc?.lat ?? Config.lat, lon = loc?.lon ?? Config.lon
        let fahrenheit = (shared?.units ?? (Config.fahrenheit ? "F" : "C")) != "C"
        if snap.lat != lat || snap.lon != lon || snap.fahrenheit != fahrenheit {
            snap.weather = nil // don't show another place's weather while this one loads
        }
        snap.place = loc?.name ?? Config.placeName
        snap.lat = lat
        snap.lon = lon
        snap.fahrenheit = fahrenheit
        let desk = shared?.newsDesk ?? "all"

        async let w = fetchWeather(lat: lat, lon: lon, fahrenheit: fahrenheit)
        async let r = fetchRecipeOfTheDay()
        async let b = fetchBriefing(desk: desk)
        async let p = fetchPlans(shared, hasGroup: hasGroup)
        if let weather = await w { snap.weather = weather; snap.weatherAt = Date() }
        if let recipe = await r { snap.recipe = recipe; snap.recipeDay = dayKey(Date()) }
        if let briefing = await b { snap.briefingDate = briefing.0; snap.stories = briefing.1 }
        let plans = await p
        if plans.status == .offline, let old = snap.plans, old.status == .ok {
            // keep the last tasks and outing on a failed refresh
        } else {
            snap.plans = plans
        }
        save(snap)
        return snap
    }

    // MARK: Blog Plan and Shoot Planner (signed in)

    private struct TaskRow: Decodable { let title: String?; let section: String?; let due: String? }
    private struct OutingRow: Decodable { let spot_id: String?; let date: String; let session: String? }
    private struct SpotRow: Decodable { let name: String }

    private static func fetchPlans(_ shared: SharedState?, hasGroup: Bool) async -> Plans {
        guard hasGroup else { return Plans(status: .noGroup) }
        guard let shared = shared, shared.session != nil else { return Plans(status: .signedOut) }
        guard let token = await Shared.accessToken(shared) else {
            // accessToken clears the shared session when the sign-in has ended
            return Plans(status: Shared.read()?.session == nil ? .signedOut : .offline)
        }
        let auth = ["Authorization": "Bearer \(token)"]
        async let t = rest("blogplan_tasks?select=title,section,due&done=is.false&order=due.asc.nullslast,section_order.asc,sort.asc&limit=4", headers: auth)
        async let o = rest("shoot_outings?select=spot_id,date,session&status=eq.planned&date=gte.\(dayKey(Date()))&order=date.asc&limit=1", headers: auth)
        let taskData = await t, outingData = await o
        guard let taskData = taskData,
              let rows = try? JSONDecoder().decode([TaskRow].self, from: taskData) else { return Plans(status: .offline) }
        let tasks = rows.compactMap { r -> PlanTask? in
            guard let title = r.title, !title.isEmpty else { return nil }
            return PlanTask(title: title, section: r.section, due: r.due)
        }
        var outing: Outing?
        if let outingData = outingData,
           let first = (try? JSONDecoder().decode([OutingRow].self, from: outingData))?.first {
            var spot = "Planned outing"
            if let id = first.spot_id,
               let spotData = await rest("shoot_spots?select=name&id=eq.\(id)", headers: auth),
               let name = (try? JSONDecoder().decode([SpotRow].self, from: spotData))?.first?.name {
                spot = name
            }
            outing = Outing(spot: spot, date: first.date, session: first.session ?? "")
        }
        return Plans(status: .ok, tasks: tasks, outing: outing)
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

    private static func fetchWeather(lat: Double, lon: Double, fahrenheit: Bool) async -> Weather? {
        var c = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        c.queryItems = [
            URLQueryItem(name: "latitude", value: String(lat)),
            URLQueryItem(name: "longitude", value: String(lon)),
            URLQueryItem(name: "current", value: "temperature_2m,apparent_temperature,weather_code,is_day"),
            URLQueryItem(name: "daily", value: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"),
            URLQueryItem(name: "temperature_unit", value: fahrenheit ? "fahrenheit" : "celsius"),
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

    private static func rest(_ path: String, schema: String = "public", headers: [String: String] = [:]) async -> Data? {
        guard let url = URL(string: "\(Config.supabaseURL)/rest/v1/\(path)") else { return nil }
        var h = headers
        h["apikey"] = Config.supabaseKey
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

    private static func fetchBriefing(desk: String) async -> (String, [Story])? {
        guard let data = await rest("news_briefings?select=briefing_date,data&order=briefing_date.desc&limit=1"),
              let rows = try? JSONDecoder().decode([BriefingRow].self, from: data),
              let row = rows.first else { return nil }
        let desks = row.data?.desks ?? [:]
        let all = ["defense", "space", "tech"] + desks.keys.sorted().filter { !["defense", "space", "tech"].contains($0) }
        let order = desk == "all" || desks[desk] == nil ? all : [desk]
        let stories = order.flatMap { desk in
            (desks[desk] ?? []).compactMap { item -> Story? in
                guard let h = item.headline, !h.isEmpty else { return nil }
                return Story(desk: desk, topic: item.topic, headline: h)
            }
        }
        return (row.briefing_date, stories)
    }
}
