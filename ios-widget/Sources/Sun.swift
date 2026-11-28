import Foundation

// Sun times for golden and blue hour, ported from src/sky.js (the SunCalc approach,
// Vladimir Agafonkin, BSD-2-Clause). Accurate to about a minute.
enum Sun {
    private static let rad = Double.pi / 180
    private static let daySeconds = 86_400.0
    private static let J1970 = 2_440_588.0
    private static let J2000 = 2_451_545.0
    private static let J0 = 0.0009
    private static let e = rad * 23.4397 // obliquity of the Earth

    private static func toJulian(_ d: Date) -> Double { d.timeIntervalSince1970 / daySeconds - 0.5 + J1970 }
    private static func fromJulian(_ j: Double) -> Date { Date(timeIntervalSince1970: (j + 0.5 - J1970) * daySeconds) }
    private static func toDays(_ d: Date) -> Double { toJulian(d) - J2000 }

    private static func declination(_ l: Double, _ b: Double) -> Double {
        asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l))
    }
    private static func solarMeanAnomaly(_ d: Double) -> Double { rad * (357.5291 + 0.98560028 * d) }
    private static func eclipticLongitude(_ m: Double) -> Double {
        let c = rad * (1.9148 * sin(m) + 0.02 * sin(2 * m) + 0.0003 * sin(3 * m))
        return m + c + rad * 102.9372 + Double.pi
    }
    private static func julianCycle(_ d: Double, _ lw: Double) -> Double { (d - J0 - lw / (2 * Double.pi)).rounded() }
    private static func approxTransit(_ ht: Double, _ lw: Double, _ n: Double) -> Double { J0 + (ht + lw) / (2 * Double.pi) + n }
    private static func solarTransitJ(_ ds: Double, _ m: Double, _ l: Double) -> Double {
        J2000 + ds + 0.0053 * sin(m) - 0.0069 * sin(2 * l)
    }
    private static func hourAngle(_ h: Double, _ phi: Double, _ dec: Double) -> Double {
        acos((sin(h) - sin(phi) * sin(dec)) / (cos(phi) * cos(dec)))
    }

    /// When the sun crosses `angle` degrees of altitude, rising and setting, around `date`'s solar noon.
    static func times(_ date: Date, lat: Double, lon: Double, angle: Double) -> (rise: Date, set: Date) {
        let lw = rad * -lon, phi = rad * lat, d = toDays(date)
        let n = julianCycle(d, lw), ds = approxTransit(0, lw, n)
        let m = solarMeanAnomaly(ds), l = eclipticLongitude(m), dec = declination(l, 0)
        let jNoon = solarTransitJ(ds, m, l)
        let w = hourAngle(angle * rad, phi, dec)
        let jSet = solarTransitJ(approxTransit(w, lw, n), m, l)
        return (fromJulian(jNoon - (jSet - jNoon)), fromJulian(jSet))
    }
}

struct LightWindow: Hashable {
    let kind: String // "Golden" or "Blue"
    let start: Date
    let end: Date
    var isGolden: Bool { kind == "Golden" }
}

enum Light {
    /// Blue and golden hour windows for today and tomorrow that haven't ended yet, in order.
    /// Same angles as the desktop Light card: blue -6° to -4°, golden -4° to +6°.
    static func upcoming(from now: Date, lat: Double, lon: Double) -> [LightWindow] {
        let cal = Calendar.current
        var out: [LightWindow] = []
        for k in 0...1 {
            guard let day = cal.date(byAdding: .day, value: k, to: cal.startOfDay(for: now)),
                  let noon = cal.date(bySettingHour: 12, minute: 0, second: 0, of: day) else { continue }
            let g = Sun.times(noon, lat: lat, lon: lon, angle: 6)
            let b4 = Sun.times(noon, lat: lat, lon: lon, angle: -4)
            let b6 = Sun.times(noon, lat: lat, lon: lon, angle: -6)
            out += [
                LightWindow(kind: "Blue", start: b6.rise, end: b4.rise),
                LightWindow(kind: "Golden", start: b4.rise, end: g.rise),
                LightWindow(kind: "Golden", start: g.set, end: b4.set),
                LightWindow(kind: "Blue", start: b4.set, end: b6.set),
            ]
        }
        return out.filter { $0.end > now && $0.start.timeIntervalSince1970.isFinite }
    }

    /// The next sunrise or sunset after `now`.
    static func nextSunEvent(from now: Date, lat: Double, lon: Double) -> (label: String, at: Date)? {
        let cal = Calendar.current
        var events: [(String, Date)] = []
        for k in 0...1 {
            guard let day = cal.date(byAdding: .day, value: k, to: cal.startOfDay(for: now)),
                  let noon = cal.date(bySettingHour: 12, minute: 0, second: 0, of: day) else { continue }
            let s = Sun.times(noon, lat: lat, lon: lon, angle: -0.833)
            events += [("Sunrise", s.rise), ("Sunset", s.set)]
        }
        return events.first { $0.1 > now }.map { (label: $0.0, at: $0.1) }
    }
}
