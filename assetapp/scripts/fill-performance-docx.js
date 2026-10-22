/**
 * Write the measured results into the Word performance test document.
 *
 *   node scripts/fill-performance-docx.js [source.docx] [output.docx]
 *
 * Inputs, both produced by the harnesses in this folder:
 *   perf-results/perf-results-emulated.json  — Chrome mobile emulation: for each screen, five
 *                                              runs of load / response / render time
 *   perf-results/perf-results.json           — the API timings (sign-in round trip, QR asset
 *                                              lookup, request insert) used where the action
 *                                              itself is a request, not a screen
 *
 * Every one of the document's 18 forms is filled in all three columns:
 *
 *   Application Load Time      navigation start → the screen's content on the page
 *   Application Response Time  slowest of that screen's Supabase requests, send → fully received
 *                              (or, for sign-in / QR / submit, the request the action itself makes)
 *   Screen Rendering Time      from the last response arriving → the content on the page
 *
 * Values are seconds with two decimals, matching the document's own targets
 * ("< 2 seconds", "1-3 seconds") and the web performance document's style. Date is ISO.
 *
 * The source file is never modified; a new document is written next to it. The .docx is read
 * and written with the two small ZIP helpers below, so nothing outside Node is needed.
 */
/* global __dirname, Buffer */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const RESULTS_DIR = path.join(ROOT, 'perf-results');

const DEFAULT_SOURCE = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  'Downloads',
  'NU_TRACE_Mobile_Performance_Detailed_Test_Document_FIXED2.docx',
);

// ------------------------------------------------------------------ zip helpers

/** Minimal ZIP reader — enough for the ~20 entries of a .docx. */
function unzip(buffer) {
  const eocdSignature = 0x06054b50;
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== eocdSignature) eocd -= 1;
  if (eocd < 0) throw new Error('Not a zip file: end-of-central-directory not found');

  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const method = buffer.readUInt16LE(p + 10);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);

    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    entries.push({ name, data: method === 8 ? zlib.inflateRawSync(raw) : raw });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Minimal ZIP writer (deflate), UTF-8 names, no data descriptors. */
function zip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const deflated = zlib.deflateRawSync(entry.data, { level: 9 });
    const useDeflate = deflated.length < entry.data.length;
    const data = useDeflate ? deflated : entry.data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralStart = offset;
  const centralSize = centralParts.reduce((a, b) => a + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

let crcTable = null;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf);
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

// --------------------------------------------------------------- docx surgery

const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescapeXml = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The text the document itself shows in one cell (used to read back its labels). */
function cellText(rowXml, cellIndex) {
  const cell = rowCells(rowXml)[cellIndex] || '';
  return [...cell.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((m) => unescapeXml(m[1]))
    .join(' ')
    .trim();
}

/** Put `value` in a `<w:tc>` cell, keeping the cell's own formatting. */
function setCellText(cellXml, value) {
  const text = escapeXml(value);
  const existing = cellXml.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/);
  if (existing) return cellXml.replace(existing[0], `<w:t xml:space="preserve">${text}</w:t>`);
  const lastParagraph = cellXml.lastIndexOf('</w:p>');
  if (lastParagraph < 0) throw new Error('Cell has no paragraph to write into');
  return (
    cellXml.slice(0, lastParagraph) +
    `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>` +
    cellXml.slice(lastParagraph)
  );
}

const rowCells = (row) => row.split('<w:tc>');
const joinCells = (parts) => parts.join('<w:tc>');

/**
 * Fill one form.
 *
 * Row layout as authored: [0] title, [1] date / application name, [2] pre-condition,
 * [3] used tool(s), [4] "Execution Runs | Performance Metrics", [5] metric names,
 * [6] targets, [7..11] runs 1–5, [12] overall average.
 * Cell layout (index 0 is the row's own fragment): [1] run number / "Overall Average…",
 * [2] Application Load Time, [3] Application Response Time, [4] Screen Rendering Time.
 */
function fillForm(table, form, dateLabel) {
  const rows = table.split('<w:tr ');

  const setCell = (rowIndex, cellIndex, value) => {
    const cells = rowCells(rows[rowIndex]);
    cells[cellIndex] = setCellText(cells[cellIndex], value);
    rows[rowIndex] = joinCells(cells);
  };

  setCell(2, 2, dateLabel);

  const toolCells = rowCells(rows[4]);
  toolCells[2] = setCellText(toolCells[2], form.tool);
  rows[4] = joinCells(toolCells);

  const seconds = (ms) => (ms / 1000).toFixed(2);
  const columns = [
    { key: 'load', index: 2, values: form.load },
    { key: 'response', index: 3, values: form.response },
    { key: 'render', index: 4, values: form.render },
  ];
  const written = [];
  for (const column of columns) {
    if (!column.values) continue;
    column.values.forEach((ms, i) => setCell(8 + i, column.index, seconds(ms)));
    const average = column.values.reduce((a, b) => a + b, 0) / column.values.length;
    setCell(13, column.index, seconds(average));
    written.push({
      // The document's own column heading and target line, so the sheet cannot drift from it.
      metric: cellText(rows[6], column.index),
      target: cellText(rows[7], column.index),
      source: form.sources[column.key],
      values: column.values,
      average,
    });
  }

  return {
    xml: rows.join('<w:tr '),
    preCondition: cellText(rows[3], 2),
    written,
  };
}

// ------------------------------------------------------------------------ main

/** Five numbers for one metric, or null when the measurement is missing. */
const series = (runs, key) => {
  if (!Array.isArray(runs) || runs.length === 0) return null;
  const values = runs.map((r) => (r && typeof r[key] === 'number' ? r[key] : null));
  return values.every((v) => v !== null) ? values : null;
};

function main() {
  const sourcePath = process.argv[2] || DEFAULT_SOURCE;
  const baseName = path.basename(sourcePath, '.docx').replace(/_?FIXED\d*$/i, '');
  const outputPath =
    process.argv[3] || path.join(path.dirname(sourcePath), `${baseName}_FILLED.docx`);

  const api = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, 'perf-results.json'), 'utf8'));
  const emulated = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, 'perf-results-emulated.json'), 'utf8'));

  const apiById = {};
  for (const r of api.results) apiById[r.id] = r;
  const emuById = {};
  for (const r of emulated.results) emuById[r.scenario] = r;

  const screen = (id) => emuById[id] || {};
  const apiRuns = (id) => apiById[id]?.runs ?? null;
  const writeRuns = (role) => api.writeResults.find((w) => w.role === role)?.runs ?? null;

  const METHOD =
    'Chrome mobile emulation (412\u00d7915, CPU \u00d74) of the production build + Supabase API timing, 2026-10-07';
  const TOOL = `${METHOD}. Load = opening the screen to its content drawn; Response = the slowest API call it makes; Render = last response to content drawn.`;
  const TOOL_SIGNIN = `${METHOD}. Load = app launch to the first screen drawn; Response = the sign-in request; Render = the first screen drawn.`;
  const TOOL_SCAN = `${METHOD}. Load = the app\u2019s first screen drawn (where the scanner lives); Response = the asset lookup the scan performs; Render = the scanned asset record drawn.`;
  const TOOL_SUBMIT = `${METHOD}. Load/Render = opening the request form to its content drawn; Response = the request insert, inside a rolled-back transaction.`;

  // One entry per form of the document, in the document's own order. Each of the three
  // columns names exactly where its five numbers come from: a measured screen (by id) or
  // one of the API actions timed by the API harness.
  const forms = [
    { load: 'launch-admin', render: 'launch-admin', response: { api: 'sign-in-admin' }, tool: TOOL_SIGNIN },
    {
      load: 'launch-head',
      render: 'launch-head',
      response: { api: 'sign-in-department-head' },
      tool: TOOL_SIGNIN,
    },
    {
      load: 'launch-employee',
      render: 'launch-employee',
      response: { api: 'sign-in-employee' },
      tool: TOOL_SIGNIN,
    },
    { screen: 'dashboard-admin' },
    { screen: 'dashboard-head' },
    { screen: 'dashboard-employee' },
    { screen: 'my-assets-head' },
    { screen: 'my-assets-employee' },
    { screen: 'asset-details-head' },
    { screen: 'asset-details-employee' },
    { screen: 'submit-request-head', response: { write: 'Department Head' }, tool: TOOL_SUBMIT },
    { screen: 'submit-request-employee', response: { write: 'Employee' }, tool: TOOL_SUBMIT },
    { screen: 'notifications-head' },
    { screen: 'notifications-employee' },
    {
      load: 'dashboard-admin',
      render: 'asset-details-admin',
      response: { api: 'qr-scan-admin' },
      tool: TOOL_SCAN,
    },
    { load: 'dashboard-head', render: 'asset-details-head', response: { api: 'qr-scan-head' }, tool: TOOL_SCAN },
    {
      load: 'dashboard-employee',
      render: 'asset-details-employee',
      response: { api: 'qr-scan-employee' },
      tool: TOOL_SCAN,
    },
    { screen: 'profile-employee' },
  ];

  const resolved = forms.map((form, index) => {
    const formNumber = index + 1;
    const screenRuns = form.screen ? screen(form.screen).runs : null;
    const missing = [];

    const load = series(form.load ? screen(form.load).runs : screenRuns, 'load');
    const render = series(form.render ? screen(form.render).runs : screenRuns, 'render');

    let response;
    if (form.response && form.response.api) response = apiRuns(form.response.api);
    else if (form.response && form.response.write) response = writeRuns(form.response.write);
    else response = series(screenRuns, 'response');

    if (!load) missing.push('load');
    if (!render) missing.push('render');
    if (!response) missing.push('response');
    if (missing.length) {
      throw new Error(`Form ${formNumber}: no measurement for ${missing.join(', ')}`);
    }

    const screenSource = (id) => `screen: ${id} (Chrome mobile emulation 412×915, CPU ×4)`;
    return {
      load,
      response,
      render,
      tool: form.tool || TOOL,
      label: form.screen || form.load,
      sources: {
        load: screenSource(form.load || form.screen),
        render: screenSource(form.render || form.screen),
        response: form.response && form.response.api
          ? `api: ${form.response.api} (Supabase round trip)`
          : form.response && form.response.write
            ? `insert as ${form.response.write} (rolled-back transaction)`
            : screenSource(form.screen),
      },
    };
  });

  const entries = unzip(fs.readFileSync(sourcePath));
  const docEntry = entries.find((e) => e.name === 'word/document.xml');
  if (!docEntry) throw new Error('word/document.xml not found in the document');

  const dateLabel = (emulated.measuredAt || api.finishedAt || new Date().toISOString()).slice(0, 10);

  const parts = docEntry.data.toString('utf8').split('<w:tbl>');
  const formTables = parts.map((_, i) => i - 1).filter((i) => i >= 0 && i % 2 === 0); // T0, T2, … T34
  if (formTables.length !== 18) {
    throw new Error(`Expected 18 measurement tables, found ${formTables.length}`);
  }
  const sheet = [];
  formTables.forEach((tableIndex, formIndex) => {
    const filled = fillForm(parts[tableIndex + 1], resolved[formIndex], dateLabel);
    parts[tableIndex + 1] = filled.xml;
    for (const metric of filled.written) {
      sheet.push({ form: formIndex + 1, preCondition: filled.preCondition, ...metric });
    }
  });

  docEntry.data = Buffer.from(parts.join('<w:tbl>'), 'utf8');
  fs.writeFileSync(outputPath, zip(entries));

  // The same numbers as a plain sheet — what was filled in, where each figure came from.
  const csvPath = path.join(RESULTS_DIR, 'document-rows.csv');
  const csvCell = (value) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const verdict = (secondsValue, target) => {
    const bounds = [...String(target).matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    if (!bounds.length) return '';
    return secondsValue <= Math.max(...bounds) ? 'PASS' : 'OVER';
  };
  const csvLines = [
    [
      'Form',
      'Pre-condition',
      'Metric',
      'Run 1 (s)',
      'Run 2 (s)',
      'Run 3 (s)',
      'Run 4 (s)',
      'Run 5 (s)',
      'Average (s)',
      'Target',
      'Verdict',
      'Measured at',
    ].join(','),
  ];
  for (const row of sheet) {
    const runs = row.values.map((ms) => (ms / 1000).toFixed(2));
    const average = (row.average / 1000).toFixed(2);
    csvLines.push(
      [
        row.form,
        row.preCondition,
        row.metric,
        ...runs,
        average,
        row.target,
        verdict(Number(average), row.target),
        row.source,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(csvPath, `${csvLines.join('\n')}\n`);
  console.log(`Sheet : ${csvPath}`);

  console.log(`Source : ${sourcePath}`);
  console.log(`Written: ${outputPath}`);
  console.log(`Forms filled: ${resolved.length} × 3 columns (${dateLabel})`);
  resolved.forEach((form, i) => {
    const avg = (v) => (v.reduce((a, b) => a + b, 0) / v.length / 1000).toFixed(2);
    console.log(
      `  form ${String(i + 1).padStart(2)} ${form.label.padEnd(24)} load ${avg(form.load)}s  response ${avg(form.response)}s  render ${avg(form.render)}s`,
    );
  });
}

main();
