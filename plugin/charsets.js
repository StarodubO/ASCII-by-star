// Character sets. A leading space is added automatically (blank cell) unless noBlank is set.
// Order does not matter unless the user turns off "Sort by density".

function range(a, b) {
  let s = "";
  for (let c = a; c <= b; c++) s += String.fromCharCode(c);
  return s;
}

const CHARSETS = [
  // Classic
  { id: "standard", group: "Classic", name: "Standard", chars: " .:-=+*#%@" },
  { id: "bourke", group: "Classic", name: "Standard Long (70)", chars: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$" },
  { id: "minimal", group: "Classic", name: "Minimal", chars: " .:" },
  { id: "punct", group: "Classic", name: "Punctuation", chars: " .,:;'\"`^~-_" },
  { id: "hash", group: "Classic", name: "Hash", chars: " -+#" },
  { id: "plus", group: "Classic", name: "Plus & Cross", chars: " .+x*X#" },
  { id: "slashes", group: "Classic", name: "Slashes", chars: " /\\|-_" },
  { id: "code", group: "Classic", name: "Code", chars: " {}[]()<>;:=+-*/&|!?#" },
  { id: "brackets", group: "Classic", name: "Brackets", chars: " ()[]{}<>" },
  { id: "symbols", group: "Classic", name: "Symbols", chars: " !@#$%^&*()" },

  // Letters & numbers
  { id: "lower", group: "Letters & Numbers", name: "Lowercase", chars: range(97, 122) },
  { id: "upper", group: "Letters & Numbers", name: "Uppercase", chars: range(65, 90) },
  { id: "alnum", group: "Letters & Numbers", name: "Alphanumeric", chars: range(48, 57) + range(65, 90) + range(97, 122) },
  { id: "digits", group: "Letters & Numbers", name: "Digits", chars: "0123456789" },
  { id: "binary", group: "Letters & Numbers", name: "Binary", chars: "01" },
  { id: "hex", group: "Letters & Numbers", name: "Hexadecimal", chars: "0123456789ABCDEF" },
  { id: "roman", group: "Letters & Numbers", name: "Roman Numerals", chars: "IVXLCDM" },
  { id: "dna", group: "Letters & Numbers", name: "DNA", chars: "ACGT" },
  { id: "morse", group: "Letters & Numbers", name: "Morse", chars: ".-" },
  { id: "greek", group: "Letters & Numbers", name: "Greek", chars: "αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΘΛΞΠΣΦΨΩ" },
  { id: "cyrillic", group: "Letters & Numbers", name: "Cyrillic", chars: "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ" },
  { id: "superscript", group: "Letters & Numbers", name: "Superscript", chars: "⁰¹²³⁴⁵⁶⁷⁸⁹" },
  { id: "circled", group: "Letters & Numbers", name: "Circled Numbers", chars: "①②③④⑤⑥⑦⑧⑨⑩" },
  { id: "fractions", group: "Letters & Numbers", name: "Fractions", chars: "½⅓¼⅕⅙⅛⅔¾" },
  { id: "currency", group: "Letters & Numbers", name: "Currency", chars: "$€£¥¢₽₹₩" },

  // Blocks & pixels
  { id: "shade", group: "Blocks & Pixels", name: "Shade Blocks", chars: "░▒▓█" },
  { id: "pixel", group: "Blocks & Pixels", name: "Pixel", chars: "█" },
  { id: "vbars", group: "Blocks & Pixels", name: "Vertical Bars", chars: "▁▂▃▄▅▆▇█", shape: true },
  { id: "hbars", group: "Blocks & Pixels", name: "Horizontal Bars", chars: "▏▎▍▌▋▊▉█", shape: true },
  { id: "quadrant", group: "Blocks & Pixels", name: "Quadrant Blocks", chars: "▘▝▀▖▌▞▛▗▚▐▜▄▙▟█", shape: true },
  { id: "halfblock", group: "Blocks & Pixels", name: "Half Blocks", chars: "▀▄▌▐█", shape: true },
  { id: "shademix", group: "Blocks & Pixels", name: "Shade + Halves", chars: "░▒▓█▀▄▌▐", shape: true },
  { id: "petscii", group: "Blocks & Pixels", name: "Retro 8-bit", chars: "▖▗▘▙▚▛▜▝▞▟▀▄▌▐█▔▁▏▕", shape: true },
  { id: "braille", group: "Blocks & Pixels", name: "Braille", chars: range(0x2801, 0x28ff), shape: true },
  { id: "squares", group: "Blocks & Pixels", name: "Squares", chars: "▫□▪■" },

  // Lines & boxes
  { id: "boxlight", group: "Lines & Boxes", name: "Box Light", chars: "─│┌┐└┘├┤┬┴┼", shape: true },
  { id: "boxheavy", group: "Lines & Boxes", name: "Box Double", chars: "═║╔╗╚╝╠╣╦╩╬", shape: true },
  { id: "rounded", group: "Lines & Boxes", name: "Rounded Box", chars: "╭╮╯╰─│", shape: true },
  { id: "circuit", group: "Lines & Boxes", name: "Circuit", chars: "─│┌┐└┘├┤┬┴┼╭╮╯╰━┃", shape: true },
  { id: "diagonal", group: "Lines & Boxes", name: "Diagonals", chars: "╱╲╳", shape: true },
  { id: "dashes", group: "Lines & Boxes", name: "Dashes", chars: "┄┅┈┉╌╍" },
  { id: "lines", group: "Lines & Boxes", name: "Lines", chars: "-=≡" },
  { id: "waves", group: "Lines & Boxes", name: "Waves", chars: "~≈∿" },
  { id: "arrows", group: "Lines & Boxes", name: "Arrows", chars: "←↑→↓↖↗↘↙↔↕", shape: true },

  // Shapes & symbols
  { id: "dots", group: "Shapes & Symbols", name: "Dots", chars: ".·•●" },
  { id: "circles", group: "Shapes & Symbols", name: "Circles", chars: "·∘○◎●" },
  { id: "triangles", group: "Shapes & Symbols", name: "Triangles", chars: "▵▴△▲" },
  { id: "geometric", group: "Shapes & Symbols", name: "Geometric", chars: "·▫◇○□◆●■" },
  { id: "stars", group: "Shapes & Symbols", name: "Stars", chars: "·✧✦☆★" },
  { id: "asterisks", group: "Shapes & Symbols", name: "Asterisks", chars: "·∗✱✲✳✴" },
  { id: "math", group: "Shapes & Symbols", name: "Math", chars: "·÷×±≠≈∞∑∏√∫∂∆" },
  { id: "suits", group: "Shapes & Symbols", name: "Card Suits", chars: "♤♧♡♢♠♣♥♦" },
  { id: "hearts", group: "Shapes & Symbols", name: "Hearts", chars: "♡♥" },
  { id: "chess", group: "Shapes & Symbols", name: "Chess", chars: "♔♕♖♗♘♙♚♛♜♝♞♟" },
  { id: "music", group: "Shapes & Symbols", name: "Music", chars: "♩♪♫♬♭♮♯" },
  { id: "weather", group: "Shapes & Symbols", name: "Weather", chars: "☀☁☂☃☄" },

  // World scripts
  { id: "katakana_half", group: "World Scripts", name: "Matrix (Half Katakana)", chars: range(0xff66, 0xff9d) },
  { id: "katakana", group: "World Scripts", name: "Katakana", chars: range(0x30a2, 0x30f3) },
  { id: "hiragana", group: "World Scripts", name: "Hiragana", chars: range(0x3042, 0x3093) },
  { id: "hangul", group: "World Scripts", name: "Hangul Jamo", chars: "ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ" },
  { id: "runes", group: "World Scripts", name: "Runes", chars: "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ" },

  { id: "custom", group: "Custom", name: "Custom…", chars: "" },
];

function allChars() {
  const set = new Set();
  for (let c = 32; c < 127; c++) set.add(String.fromCharCode(c));
  for (const cs of CHARSETS) for (const ch of cs.chars) set.add(ch);
  return Array.from(set);
}

if (typeof module !== "undefined") module.exports = { CHARSETS, allChars };
