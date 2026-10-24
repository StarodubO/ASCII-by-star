// Renders the section badges: a Lucide icon (tools/section-icons, ISC licence) in white on a coloured rounded
// square, 36 px (shown at 18 px, sharp on Retina). Run: swift tools/make_section_icons.swift
import AppKit

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let src = root.appendingPathComponent("tools/section-icons"), out = root.appendingPathComponent("plugin/icons/sections")
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

// section id: (Lucide icon, badge colour)
let icons: [(String, String, UInt32)] = [
  ("look", "sparkles", 0xd4a017), ("chars", "type", 0x3b82f6), ("outline", "circle-dashed", 0xff2a6d), ("rain", "cloud-rain", 0x16a34a), ("depth", "squares-nested", 0x7c3aed),
  ("edit", "pencil", 0x06b6d4), ("grid", "grid-3x3", 0x64748b), ("tone", "contrast", 0x737373), ("color", "palette", 0xe11d48),
  ("shadow", "blend", 0x4b5563), ("cells", "layout-grid", 0xea580c), ("glitch", "zap", 0xa21caf), ("output", "download", 0x2563eb), ("batch", "folder-open", 0x0d9488),
  ("inkType", "scroll-text", 0xa16207), ("inkInk", "droplet", 0x1e3a8a), ("inkPaper", "sticky-note", 0xb45309), ("inkLayers", "layers", 0x475569),
  ("taStyle", "sparkles", 0xca8a04), ("taShape", "blend", 0x9333ea), ("taText", "pencil", 0x0891b2), ("taFont", "type", 0xdb2777), ("taLayout", "grid-3x3", 0x65a30d),
]
let S = 36, inset: CGFloat = 7
for (id, name, rgb) in icons {
  var svg = try String(contentsOf: src.appendingPathComponent(name + ".svg"), encoding: .utf8)
  svg = svg.replacingOccurrences(of: "currentColor", with: "#ffffff").replacingOccurrences(of: "stroke-width=\"2\"", with: "stroke-width=\"2.25\"")
  guard let icon = NSImage(data: svg.data(using: .utf8)!) else { print("can't read", name); continue }
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: S, pixelsHigh: S, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  NSColor(srgbRed: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255, blue: CGFloat(rgb & 255) / 255, alpha: 1).setFill()
  NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: S, height: S), xRadius: 8, yRadius: 8).fill()
  icon.draw(in: NSRect(x: inset, y: inset, width: CGFloat(S) - 2 * inset, height: CGFloat(S) - 2 * inset))
  NSGraphicsContext.restoreGraphicsState()
  try rep.representation(using: .png, properties: [:])!.write(to: out.appendingPathComponent(id + ".png"))
}
print("wrote", icons.count, "badges to", out.path)
