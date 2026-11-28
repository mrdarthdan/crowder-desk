import SwiftUI
import WidgetKit

// MARK: - Timeline

struct DeskEntry: TimelineEntry {
    let date: Date
    let snap: Snapshot
}

struct DeskProvider: TimelineProvider {
    func placeholder(in context: Context) -> DeskEntry {
        DeskEntry(date: Date(), snap: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (DeskEntry) -> Void) {
        if context.isPreview {
            completion(DeskEntry(date: Date(), snap: Loader.cached() ?? .sample))
            return
        }
        Task { completion(DeskEntry(date: Date(), snap: await Loader.load())) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DeskEntry>) -> Void) {
        Task {
            let snap = await Loader.load()
            let now = Date()
            // Same data, re-drawn every 15 minutes so the light window and story stay current;
            // new data after 30 minutes (iOS may stretch that out to save battery).
            let entries = (0..<4).map { DeskEntry(date: now.addingTimeInterval(Double($0) * 900), snap: snap) }
            completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(1800))))
        }
    }
}

// MARK: - Widget

@main
struct CrowderDeskWidgetBundle: WidgetBundle {
    var body: some Widget {
        CrowderDeskWidget()
        CrowderPlansWidget()
    }
}

struct CrowderPlansWidget: Widget {
    let kind = "CrowderPlansWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DeskProvider()) { entry in
            PlansWidgetView(entry: entry)
        }
        .configurationDisplayName("Crowder Desk Plans")
        .description("Your next Blog Plan tasks and Shoot Planner outing. Uses the sign-in from the app.")
        .supportedFamilies([.systemMedium, .systemLarge, .accessoryRectangular])
    }
}

struct CrowderDeskWidget: Widget {
    let kind = "CrowderDeskWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DeskProvider()) { entry in
            DeskWidgetView(entry: entry)
        }
        .configurationDisplayName("Crowder Desk")
        .description("Weather, golden and blue hour, the recipe of the day and a Picket Station story.")
        .supportedFamilies([
            .systemSmall, .systemMedium, .systemLarge,
            .accessoryInline, .accessoryCircular, .accessoryRectangular,
        ])
    }
}

// MARK: - Look

enum Palette {
    static let bg = Color(red: 20 / 255, green: 18 / 255, blue: 24 / 255)
    static let ink = Color(red: 237 / 255, green: 230 / 255, blue: 218 / 255)
    static let ink2 = Color(red: 185 / 255, green: 177 / 255, blue: 164 / 255)
    static let ink3 = Color(red: 133 / 255, green: 126 / 255, blue: 116 / 255)
    static let ember = Color(red: 224 / 255, green: 137 / 255, blue: 75 / 255)
    static let sky = Color(red: 134 / 255, green: 174 / 255, blue: 191 / 255)
}

enum Fmt {
    static let time: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "h:mm"; return f
    }()
    static let timeAP: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "h:mm a"; return f
    }()
    static let weekday: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "EEE"; return f
    }()
    static let dayKey: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func deg(_ v: Double) -> String { "\(Int(v.rounded()))°" }

    /// "5:02–5:38 PM"
    static func range(_ w: LightWindow) -> String {
        "\(time.string(from: w.start))–\(timeAP.string(from: w.end))"
    }

    static func weekdayName(_ key: String) -> String {
        guard let d = dayKey.date(from: key) else { return "" }
        return weekday.string(from: d)
    }
}

/// Same labels as the app's weather card, with SF Symbols in place of its drawings.
func weatherLook(_ code: Int, day: Bool = true) -> (label: String, symbol: String) {
    switch code {
    case 0: return (day ? "Clear" : "Clear night", day ? "sun.max.fill" : "moon.stars.fill")
    case 1: return ("Mostly clear", day ? "sun.max.fill" : "moon.fill")
    case 2: return ("Partly cloudy", day ? "cloud.sun.fill" : "cloud.moon.fill")
    case 3: return ("Overcast", "cloud.fill")
    case 45, 48: return ("Fog", "cloud.fog.fill")
    case 51...57: return ("Drizzle", "cloud.drizzle.fill")
    case 61...67: return ("Rain", "cloud.rain.fill")
    case 80...82: return ("Showers", "cloud.heavyrain.fill")
    case 71...77, 85, 86: return ("Snow", "cloud.snow.fill")
    case 95...: return ("Thunderstorms", "cloud.bolt.rain.fill")
    default: return ("—", "cloud.fill")
    }
}

extension View {
    /// iOS 17 wants widget backgrounds set this way; iOS 16 uses a plain background.
    @ViewBuilder
    func widgetBackground(_ color: Color) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            self.containerBackground(for: .widget) { color }
        } else {
            self.background(color)
        }
    }
}

// MARK: - Views

struct DeskWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: DeskEntry

    var body: some View {
        switch family {
        case .accessoryInline: InlineView(entry: entry).widgetBackground(.clear)
        case .accessoryCircular: CircularView(entry: entry).widgetBackground(.clear)
        case .accessoryRectangular: RectangularView(entry: entry).widgetBackground(.clear)
        case .systemMedium: MediumView(entry: entry).widgetBackground(Palette.bg)
        case .systemLarge: LargeView(entry: entry).widgetBackground(Palette.bg)
        default: SmallView(entry: entry).widgetBackground(Palette.bg)
        }
    }
}

private func nextLight(_ entry: DeskEntry) -> LightWindow? {
    Light.upcoming(from: entry.date, lat: entry.snap.latitude, lon: entry.snap.longitude).first
}

private func lightLine(_ w: LightWindow, at now: Date) -> String {
    w.start <= now ? "\(w.kind) now · until \(Fmt.timeAP.string(from: w.end))" : "\(w.kind) \(Fmt.range(w))"
}

// Lock screen: one line above the clock.
struct InlineView: View {
    let entry: DeskEntry
    var body: some View {
        if let w = entry.snap.weather {
            let look = weatherLook(w.code, day: w.isDay)
            let light = nextLight(entry).map { " · \($0.kind) \(Fmt.time.string(from: $0.start))" } ?? ""
            Label("\(Fmt.deg(w.temp))\(light)", systemImage: look.symbol)
        } else {
            Label("Crowder Desk", systemImage: "cloud")
        }
    }
}

// Lock screen: small circle.
struct CircularView: View {
    let entry: DeskEntry
    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            if let w = entry.snap.weather {
                VStack(spacing: 0) {
                    Image(systemName: weatherLook(w.code, day: w.isDay).symbol).font(.system(size: 15))
                    Text(Fmt.deg(w.temp)).font(.system(size: 17, weight: .semibold))
                }
            } else {
                Image(systemName: "cloud")
            }
        }
    }
}

// Lock screen: rectangle under the clock.
struct RectangularView: View {
    let entry: DeskEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            if let w = entry.snap.weather {
                let look = weatherLook(w.code, day: w.isDay)
                HStack(spacing: 4) {
                    Image(systemName: look.symbol)
                    Text("\(Fmt.deg(w.temp)) \(look.label)").lineLimit(1)
                }
                .font(.headline)
                if let today = w.days.first {
                    Text("H \(Fmt.deg(today.hi))  L \(Fmt.deg(today.lo))").font(.caption)
                }
            } else {
                Text("Crowder Desk").font(.headline)
            }
            if let l = nextLight(entry) {
                Text(lightLine(l, at: entry.date)).font(.caption).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct WeatherBlock: View {
    let w: Weather
    var big: CGFloat = 34
    var body: some View {
        let look = weatherLook(w.code, day: w.isDay)
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(Fmt.deg(w.temp)).font(.system(size: big, weight: .light, design: .rounded))
                Image(systemName: look.symbol).symbolRenderingMode(.multicolor).font(.system(size: big * 0.5))
            }
            Text(look.label).font(.caption).foregroundColor(Palette.ink2).lineLimit(1)
            if let t = w.days.first {
                Text("H \(Fmt.deg(t.hi)) · L \(Fmt.deg(t.lo))\(rainText(t))")
                    .font(.caption2).foregroundColor(Palette.ink3).lineLimit(1)
            }
        }
    }
    private func rainText(_ d: Day) -> String {
        guard let r = d.rain, r >= 20 else { return "" }
        return " · \(Int(r))% rain"
    }
}

struct LightBlock: View {
    let entry: DeskEntry
    var count = 2
    var body: some View {
        let windows = Array(Light.upcoming(from: entry.date, lat: entry.snap.latitude, lon: entry.snap.longitude).prefix(count))
        VStack(alignment: .leading, spacing: 3) {
            Text("LIGHT").font(.system(size: 9, weight: .semibold)).kerning(1.4).foregroundColor(Palette.ember)
            ForEach(windows, id: \.self) { w in
                HStack(spacing: 5) {
                    Circle().fill(w.isGolden ? Palette.ember : Palette.sky).frame(width: 6, height: 6)
                    Text(lightLine(w, at: entry.date)).font(.caption2).foregroundColor(Palette.ink).lineLimit(1)
                }
            }
            if let s = Light.nextSunEvent(from: entry.date, lat: entry.snap.latitude, lon: entry.snap.longitude) {
                Text("\(s.label) \(Fmt.timeAP.string(from: s.at))").font(.caption2).foregroundColor(Palette.ink3)
            }
        }
    }
}

struct Header: View {
    let text: String
    var body: some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 2).fill(Palette.ember).frame(width: 7, height: 7)
            Text(text.uppercased()).font(.system(size: 9, weight: .semibold)).kerning(1.4).foregroundColor(Palette.ink2)
        }
    }
}

struct SmallView: View {
    let entry: DeskEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Header(text: entry.snap.placeName)
            if let w = entry.snap.weather { WeatherBlock(w: w) } else { Text("No weather yet").font(.caption) }
            Spacer(minLength: 0)
            if let l = nextLight(entry) {
                HStack(spacing: 4) {
                    Circle().fill(l.isGolden ? Palette.ember : Palette.sky).frame(width: 6, height: 6)
                    Text(l.start <= entry.date ? "\(l.kind) now" : "\(l.kind) \(Fmt.timeAP.string(from: l.start))")
                        .font(.caption2).lineLimit(1)
                }
            }
        }
        .foregroundColor(Palette.ink)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct ForecastRow: View {
    let days: [Day]
    var body: some View {
        HStack(spacing: 0) {
            ForEach(days, id: \.self) { d in
                VStack(spacing: 2) {
                    Text(Fmt.weekdayName(d.date)).font(.caption2).foregroundColor(Palette.ink3)
                    Image(systemName: weatherLook(d.code).symbol).symbolRenderingMode(.multicolor).font(.caption)
                    Text("\(Fmt.deg(d.hi)) \(Fmt.deg(d.lo))").font(.caption2).foregroundColor(Palette.ink2)
                }
                .frame(maxWidth: .infinity)
            }
        }
    }
}

struct MediumView: View {
    let entry: DeskEntry
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Header(text: entry.snap.placeName)
                if let w = entry.snap.weather { WeatherBlock(w: w) } else { Text("No weather yet").font(.caption) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 8) {
                LightBlock(entry: entry)
                if let w = entry.snap.weather, w.days.count > 1 {
                    ForecastRow(days: Array(w.days.dropFirst().prefix(3)))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .foregroundColor(Palette.ink)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct LargeView: View {
    let entry: DeskEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Header(text: entry.snap.placeName)
                    if let w = entry.snap.weather { WeatherBlock(w: w, big: 38) } else { Text("No weather yet").font(.caption) }
                }
                Spacer()
                LightBlock(entry: entry, count: 2)
            }
            if let w = entry.snap.weather, w.days.count > 1 {
                ForecastRow(days: Array(w.days.dropFirst().prefix(3)))
            }
            Divider().overlay(Palette.ink3.opacity(0.4))
            if let r = entry.snap.recipe {
                VStack(alignment: .leading, spacing: 2) {
                    Text("TODAY'S RECIPE").font(.system(size: 9, weight: .semibold)).kerning(1.4).foregroundColor(Palette.ember)
                    Text(r.title).font(.subheadline.weight(.medium)).lineLimit(2)
                    if let t = r.time, !t.isEmpty {
                        Text(t).font(.caption2).foregroundColor(Palette.ink3)
                    }
                }
            }
            if let s = entry.snap.story(at: entry.date) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("PICKET STATION · \(s.desk.uppercased())")
                        .font(.system(size: 9, weight: .semibold)).kerning(1.4).foregroundColor(Palette.sky)
                    Text(s.headline).font(.subheadline).lineLimit(3)
                }
            }
            Spacer(minLength: 0)
        }
        .foregroundColor(Palette.ink)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Plans widget

enum PlanFmt {
    static let short: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "EEE MMM d"; return f
    }()
    static let sessions = ["sunrise": "Sunrise", "sunset": "Sunset", "blue": "Blue hour", "night": "Night sky"]

    /// "Today", "Tomorrow", "Sat Nov 29", or "Overdue · Nov 20"
    static func when(_ key: String?, now: Date) -> String? {
        guard let key = key, let d = Fmt.dayKey.date(from: key) else { return nil }
        let cal = Calendar.current
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: now), to: cal.startOfDay(for: d)).day ?? 0
        if days < 0 { return "Overdue · \(short.string(from: d))" }
        if days == 0 { return "Today" }
        if days == 1 { return "Tomorrow" }
        return short.string(from: d)
    }

    static func outing(_ o: Outing, now: Date) -> String {
        let when = PlanFmt.when(o.date, now: now) ?? o.date
        let session = sessions[o.session] ?? o.session.capitalized
        return session.isEmpty ? when : "\(when) · \(session)"
    }
}

struct PlansMessage: View {
    let status: Plans.Status
    var body: some View {
        switch status {
        case .noGroup:
            Text("The widget can't see the app's sign-in on this install (no App Group). See Settings in Crowder Desk.")
        case .signedOut:
            Text("Sign in to Blog Plan in Crowder Desk → Settings.")
        case .offline:
            Text("Couldn't reach Blog Plan. Trying again soon.")
        case .ok:
            EmptyView()
        }
    }
}

struct PlansWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: DeskEntry

    var body: some View {
        switch family {
        case .accessoryRectangular: PlansRectangular(entry: entry).widgetBackground(.clear)
        default: PlansHome(entry: entry, large: family == .systemLarge).widgetBackground(Palette.bg)
        }
    }
}

struct PlansRectangular: View {
    let entry: DeskEntry
    var body: some View {
        let plans = entry.snap.plans
        VStack(alignment: .leading, spacing: 1) {
            if let p = plans, p.status == .ok {
                if let o = p.outing {
                    Label(o.spot, systemImage: "camera").font(.headline).lineLimit(1)
                    Text(PlanFmt.outing(o, now: entry.date)).font(.caption).lineLimit(1)
                }
                ForEach(Array(p.tasks.prefix(p.outing == nil ? 3 : 1)), id: \.self) { t in
                    Text("• \(t.title)").font(.caption).lineLimit(1)
                }
                if p.outing == nil && p.tasks.isEmpty {
                    Text("Nothing planned").font(.caption)
                }
            } else {
                Text("Crowder Desk Plans").font(.headline)
                PlansMessage(status: plans?.status ?? .signedOut).font(.caption2).lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct PlansHome: View {
    let entry: DeskEntry
    let large: Bool
    var body: some View {
        let plans = entry.snap.plans
        VStack(alignment: .leading, spacing: 8) {
            if let p = plans, p.status == .ok {
                VStack(alignment: .leading, spacing: 4) {
                    Text("BLOG PLAN").font(.system(size: 9, weight: .semibold)).kerning(1.4).foregroundColor(Palette.ember)
                    if p.tasks.isEmpty {
                        Text("No open tasks").font(.caption).foregroundColor(Palette.ink3)
                    }
                    ForEach(Array(p.tasks.prefix(large ? 4 : 2)), id: \.self) { t in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Image(systemName: "circle").font(.system(size: 9)).foregroundColor(Palette.ink3)
                            Text(t.title).font(.caption).lineLimit(1)
                            Spacer(minLength: 4)
                            if let w = PlanFmt.when(t.due, now: entry.date) {
                                Text(w).font(.caption2)
                                    .foregroundColor(w.hasPrefix("Overdue") || w == "Today" ? Palette.ember : Palette.ink3)
                                    .lineLimit(1)
                            }
                        }
                    }
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text("NEXT OUTING").font(.system(size: 9, weight: .semibold)).kerning(1.4).foregroundColor(Palette.sky)
                    if let o = p.outing {
                        Text(o.spot).font(.subheadline.weight(.medium)).lineLimit(1)
                        Text(PlanFmt.outing(o, now: entry.date)).font(.caption2).foregroundColor(Palette.ink2)
                    } else {
                        Text("No outing planned").font(.caption).foregroundColor(Palette.ink3)
                    }
                }
                if large, let l = Light.upcoming(from: entry.date, lat: entry.snap.latitude, lon: entry.snap.longitude).first {
                    HStack(spacing: 5) {
                        Circle().fill(l.isGolden ? Palette.ember : Palette.sky).frame(width: 6, height: 6)
                        Text(l.start <= entry.date ? "\(l.kind) now · until \(Fmt.timeAP.string(from: l.end))" : "\(l.kind) \(Fmt.range(l))")
                            .font(.caption2).foregroundColor(Palette.ink2)
                    }
                }
            } else {
                Header(text: "Crowder Desk Plans")
                PlansMessage(status: plans?.status ?? .signedOut).font(.caption).foregroundColor(Palette.ink2)
            }
            Spacer(minLength: 0)
        }
        .foregroundColor(Palette.ink)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
