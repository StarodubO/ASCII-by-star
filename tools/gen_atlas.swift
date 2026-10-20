// Rasterizes glyphs into an 8-bit alpha atlas using CoreText (Menlo + system fallback).
// usage: swift gen_atlas.swift chars.json outDir
import Foundation
import CoreText
import CoreGraphics

let args = CommandLine.arguments
let chars = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: args[1]))) as! [String]
let outDir = args[2]

let fontSize: CGFloat = 40
let base = CTFontCreateWithName("Menlo-Regular" as CFString, fontSize, nil)
let ascent = CTFontGetAscent(base), descent = CTFontGetDescent(base)
var adv = CGSize.zero
var g: CGGlyph = 0
var mch: UniChar = 0x4D // "M"
CTFontGetGlyphsForCharacters(base, &mch, &g, 1)
CTFontGetAdvancesForGlyphs(base, .horizontal, &g, &adv, 1)
let cellW = Int(adv.width.rounded())
let cellH = Int((ascent + descent).rounded())

var out = Data()
var kept: [String] = []
let cs = CGColorSpaceCreateDeviceGray()
for ch in chars {
  let utf16 = Array(ch.utf16)
  let resolved = CTFontCreateForString(base, ch as CFString, CFRange(location: 0, length: utf16.count))
  let name = CTFontCopyPostScriptName(resolved) as String
  if name.contains("LastResort") { FileHandle.standardError.write("skip \(ch) U+\(String(utf16[0], radix: 16))\n".data(using: .utf8)!); continue }
  let ctx = CGContext(data: nil, width: cellW, height: cellH, bitsPerComponent: 8, bytesPerRow: cellW, space: cs, bitmapInfo: CGImageAlphaInfo.none.rawValue)!
  ctx.setFillColor(gray: 0, alpha: 1); ctx.fill(CGRect(x: 0, y: 0, width: cellW, height: cellH))
  let attr = NSAttributedString(string: ch, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): base,
    NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 1, alpha: 1)])
  let line = CTLineCreateWithAttributedString(attr)
  var a: CGFloat = 0, d: CGFloat = 0, l: CGFloat = 0
  let w = CGFloat(CTLineGetTypographicBounds(line, &a, &d, &l))
  ctx.setShouldAntialias(true); ctx.setAllowsFontSmoothing(false)
  if w > CGFloat(cellW) * 1.05 {
    // wide glyph (e.g. full-width kana): shrink to fit cell, centred
    let s = CGFloat(cellW) / w
    ctx.translateBy(x: 0, y: CGFloat(cellH) * (1 - s) / 2)
    ctx.scaleBy(x: s, y: s)
    ctx.textPosition = CGPoint(x: 0, y: descent)
  } else {
    ctx.textPosition = CGPoint(x: (CGFloat(cellW) - w) / 2, y: descent)
  }
  CTLineDraw(line, ctx)
  let p = ctx.data!.bindMemory(to: UInt8.self, capacity: cellW * cellH)
  out.append(UnsafeBufferPointer(start: p, count: cellW * cellH))
  kept.append(ch)
}
try! out.write(to: URL(fileURLWithPath: outDir + "/atlas.bin"))
let meta: [String: Any] = ["font": "Menlo-Regular", "fontSize": Int(fontSize), "cellW": cellW, "cellH": cellH, "chars": kept]
try! JSONSerialization.data(withJSONObject: meta).write(to: URL(fileURLWithPath: outDir + "/atlas.json"))
print("glyphs \(kept.count) cell \(cellW)x\(cellH) bytes \(out.count)")
