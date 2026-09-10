/* TimeTracker — write a real Excel workbook (.xlsx) with no libraries.

   Why: a CSV is plain text that every computer splits into columns by its own
   rules (comma in the US, semicolon in Denmark, …), so the same file opens
   cleanly for one person and as one messy column for another. An .xlsx already
   *is* columns: it opens the same everywhere — Excel, Numbers, Google Sheets —
   and dates, times and hours arrive as real values you can sum and sort.

   How: an .xlsx is a ZIP archive holding a handful of small XML files. This
   module writes those XML parts and packs them into a ZIP with "stored"
   (uncompressed) entries, which needs only a CRC-32 checksum, not a compressor.
   Everything happens in memory; nothing leaves the browser.

   Public surface:
     xlsxCell.header(s) / .text(s) / .num(n) / .date("2026-08-03") / .time(minutes) / .duration(hours)
     buildXlsx([{ name, widths, rows: [[cell, …], …] }, …]) -> Uint8Array */
"use strict";

/* ---------- ZIP archive with stored (uncompressed) entries ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/* The MS-DOS time and date fields every ZIP header carries (2-second steps). */
function dosDateTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/* files: [{ name, data: Uint8Array }] -> the bytes of a valid ZIP archive.
   Layout: [local header + name + data] per file, then the central directory
   (one record per file, pointing back at its local header), then the end record. */
function buildZip(files, now = new Date()) {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const u16 = n => [n & 0xFF, (n >>> 8) & 0xFF];
  const u32 = n => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];

  const chunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data), size = f.data.length;
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0),   // signature, version 2.0, no flags, stored
      ...u16(time), ...u16(date), ...u32(crc), ...u32(size), ...u32(size),
      ...u16(name.length), ...u16(0),
    ]);
    chunks.push(local, name, f.data);
    central.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0),
      ...u16(time), ...u16(date), ...u32(crc), ...u32(size), ...u32(size),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset),
    ]), name);
    offset += local.length + name.length + size;
  }

  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(cdSize), ...u32(offset), ...u16(0),
  ]);

  const out = new Uint8Array(offset + cdSize + end.length);
  let pos = 0;
  for (const c of [...chunks, ...central, end]) { out.set(c, pos); pos += c.length; }
  return out;
}

/* ---------- Excel workbook ---------- */
/* XML namespace identifiers. They look like web addresses but are labels
   written into the file — nothing is ever fetched from them. */
const XLSX_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS  = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_NS  = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT_NS   = "http://schemas.openxmlformats.org/package/2006/content-types";
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/* Cell styles, by index into <cellXfs> in STYLES_XML below. */
const XLSX_STYLE = { text: 0, header: 1, date: 2, time: 3, num: 4, duration: 5 };

const xlsxCell = {
  text:     s => ({ t: "s", v: s == null ? "" : String(s), s: XLSX_STYLE.text }),
  header:   s => ({ t: "s", v: String(s), s: XLSX_STYLE.header }),
  num:      n => ({ t: "n", v: n, s: XLSX_STYLE.num }),                        // shown as 0.00
  date:     ymd => ({ t: "n", v: excelDateSerial(ymd), s: XLSX_STYLE.date }),  // "2026-08-03"
  time:     minutes => ({ t: "n", v: minutes / 1440, s: XLSX_STYLE.time }),    // minutes since midnight
  duration: hours => ({ t: "n", v: hours / 24, s: XLSX_STYLE.duration }),      // elapsed, shown as [h]:mm
};

/* Excel stores a date as the number of days since 1899-12-30 (its day 1 is
   1900-01-01, and it keeps Lotus 1-2-3's phantom 29 Feb 1900). "2026-08-03" -> 46237 */
function excelDateSerial(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

function colName(i) {                       // 0 -> "A", 25 -> "Z", 26 -> "AA"
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}

/* Escape text for XML and drop the control characters XML 1.0 forbids. */
function xmlEsc(s) {
  let out = "";
  for (const ch of String(s)) {
    const c = ch.charCodeAt(0);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) continue;
    out += ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : ch;
  }
  return out;
}

const STYLES_XML = XML_HEAD +
  `<styleSheet xmlns="${XLSX_NS}">` +
  '<numFmts count="3">' +
  '<numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>' +
  '<numFmt numFmtId="165" formatCode="hh:mm"/>' +
  '<numFmt numFmtId="166" formatCode="[h]:mm"/>' +
  '</numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="6">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                          // 0 text
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +            // 1 bold header
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +  // 2 date
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +  // 3 time of day
  '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +    // 4 number, 0.00
  '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +  // 5 duration
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function sheetXml(sheet, index) {
  const cols = (sheet.widths || []).map((w, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const rows = sheet.rows.map((cells, r) => {
    const xml = cells.map((c, i) => {
      if (!c) return "";
      const ref = `${colName(i)}${r + 1}`;
      if (c.t === "s") {
        if (c.v === "") return "";
        return `<c r="${ref}" s="${c.s}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(c.v)}</t></is></c>`;
      }
      return Number.isFinite(c.v) ? `<c r="${ref}" s="${c.s}"><v>${c.v}</v></c>` : "";
    }).join("");
    return `<row r="${r + 1}">${xml}</row>`;
  }).join("");
  return XML_HEAD +
    `<worksheet xmlns="${XLSX_NS}">` +
    `<sheetViews><sheetView workbookViewId="0"${index === 0 ? ' tabSelected="1"' : ""}>` +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +   // header row stays visible
    '</sheetView></sheetViews>' +
    (cols ? `<cols>${cols}</cols>` : "") +
    `<sheetData>${rows}</sheetData></worksheet>`;
}

function workbookXml(sheets) {
  const list = sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  return XML_HEAD + `<workbook xmlns="${XLSX_NS}" xmlns:r="${REL_NS}"><sheets>${list}</sheets></workbook>`;
}

function workbookRelsXml(n) {
  const rels = Array.from({ length: n }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("");
  return XML_HEAD + `<Relationships xmlns="${PKG_NS}">${rels}` +
    `<Relationship Id="rId${n + 1}" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`;
}

function contentTypesXml(n) {
  const sheets = Array.from({ length: n }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  return XML_HEAD + `<Types xmlns="${CT_NS}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    sheets + '</Types>';
}

/* sheets: [{ name, widths: [chars, …], rows: [[cell | null, …], …] }] -> .xlsx bytes */
function buildXlsx(sheets, now) {
  const enc = new TextEncoder();
  const part = (name, xml) => ({ name, data: enc.encode(xml) });
  return buildZip([
    part("[Content_Types].xml", contentTypesXml(sheets.length)),
    part("_rels/.rels", XML_HEAD + `<Relationships xmlns="${PKG_NS}">` +
      `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    part("xl/workbook.xml", workbookXml(sheets)),
    part("xl/_rels/workbook.xml.rels", workbookRelsXml(sheets.length)),
    part("xl/styles.xml", STYLES_XML),
    ...sheets.map((s, i) => part(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s, i))),
  ], now);
}
