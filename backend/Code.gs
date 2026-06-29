// ─── CONFIG ────────────────────────────────────────────────────────────────────
// SPREADSHEET_ID and API_TOKEN are intentionally NOT hardcoded here — they are
// read from Script Properties so they never end up in the committed Code.gs file.
// Set them via: Apps Script editor → Project Settings (gear icon) → Script
// Properties → Add script property.
//   SPREADSHEET_ID = <spreadsheet ID from the sheet URL, .../d/<ID>/edit>
//   API_TOKEN      = <a long random string — must match EXPO_PUBLIC_API_TOKEN in
//                      the app's .env file>
// See backend/README.md for the full setup steps.
var SCRIPT_PROPS   = PropertiesService.getScriptProperties();
var SPREADSHEET_ID = SCRIPT_PROPS.getProperty('SPREADSHEET_ID');
var API_TOKEN      = SCRIPT_PROPS.getProperty('API_TOKEN');

var SHEET_LOCALIZADOS    = 'Bienes Localizados';   // normal scan path: update row
var SHEET_OTROS          = 'Otros bienes';         // unknown code path: append row
var SHEET_NO_LOCALIZADOS = 'Bienes no Localizados'; // app never writes here

var HEADER_ROW     = 7;
var DATA_START_ROW = 8;

// 1-based column indices. Column A (1) is an empty left margin.
var COL_PLACA       = 2;  // B — search key
var COL_DESCRIPCION = 3;  // C
var COL_RESPONSABLE = 4;  // D
var COL_UBICACION   = 5;  // E
var COL_MARCA       = 6;  // F
var COL_MODELO      = 7;  // G
var COL_SERIE       = 8;  // H
var COL_ESTADO      = 9;  // I — "E.O." or "E.D."
var COL_FECHA       = 10; // J — server-side timestamp

var VALID_ESTADOS      = ['E.O.', 'E.D.'];
var VALID_RESPONSABLES = ['Maria Sofia Infante Alfaro', 'Coordinación CIPA'];
// ───────────────────────────────────────────────────────────────────────────────


// Health-check: open the /exec URL in a browser to confirm the script is live.
function doGet(e) {
  return json({ status: 'ok' });
}


// All requests from the app arrive here.
// Body: Content-Type text/plain;charset=utf-8, content: JSON string.
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);

    if (!API_TOKEN || payload.token !== API_TOKEN) {
      return json({ ok: false, found: false, reason: 'unauthorized' });
    }

    var action = payload.action;

    if (action === 'lookup')           return handleLookup(payload);
    if (action === 'submitLocalizado') return handleSubmitLocalizado(payload);
    if (action === 'submitOtroBien')   return handleSubmitOtroBien(payload);

    return json({ error: 'Unknown action: ' + action });
  } catch (err) {
    return json({ error: 'Server error: ' + err.message });
  }
}


// ─── LOOKUP ────────────────────────────────────────────────────────────────────
// Input:  { action:"lookup", code }
// Output: { found:true, placa, descripcion, marca, ubicacion, row, ?warning }
//      OR { found:false }
function handleLookup(payload) {
  var code = payload.code;
  if (!code) return json({ found: false, reason: 'missing_code' });

  var result = findRow(SHEET_LOCALIZADOS, code);
  if (!result) return json({ found: false });

  var sheet = getSheet(SHEET_LOCALIZADOS);
  var row   = result.row;

  var resp = {
    found:       true,
    placa:       normalize(sheet.getRange(row, COL_PLACA).getValue()),
    descripcion: normalize(sheet.getRange(row, COL_DESCRIPCION).getValue()),
    marca:       normalize(sheet.getRange(row, COL_MARCA).getValue()),
    ubicacion:   normalize(sheet.getRange(row, COL_UBICACION).getValue()),
    row:         row
  };
  if (result.duplicate) resp.warning = 'duplicate_placa';
  return json(resp);
}


// ─── SUBMIT LOCALIZADO ─────────────────────────────────────────────────────────
// Input:  { action:"submitLocalizado", code, estado:"E.O."|"E.D." }
// Output: { ok:true, placa, estado, fecha, ?warning }
//      OR { ok:false, reason:"missing_code"|"invalid_estado"|"not_found" }
function handleSubmitLocalizado(payload) {
  var code   = payload.code;
  var estado = payload.estado;

  if (!code)                              return json({ ok: false, reason: 'missing_code' });
  if (VALID_ESTADOS.indexOf(estado) < 0)  return json({ ok: false, reason: 'invalid_estado' });

  var result = findRow(SHEET_LOCALIZADOS, code);
  if (!result) return json({ ok: false, reason: 'not_found' });

  var sheet = getSheet(SHEET_LOCALIZADOS);
  var row   = result.row;
  var now   = new Date();

  sheet.getRange(row, COL_ESTADO).setValue(estado);

  var fechaCell = sheet.getRange(row, COL_FECHA);
  fechaCell.setNumberFormat('yyyy-mm-dd hh:mm:ss');
  fechaCell.setValue(now);

  var resp = {
    ok:     true,
    placa:  normalize(sheet.getRange(row, COL_PLACA).getValue()),
    estado: estado,
    fecha:  formatDate(now)
  };
  if (result.duplicate) resp.warning = 'duplicate_placa';
  return json(resp);
}


// ─── SUBMIT OTRO BIEN ──────────────────────────────────────────────────────────
// Input:  { action:"submitOtroBien", code, descripcion, responsable, estado }
// Output: { ok:true, placa, descripcion, responsable, estado, fecha }
//      OR { ok:false, reason:"missing_code"|"missing_descripcion"|
//                           "invalid_estado"|"invalid_responsable" }
function handleSubmitOtroBien(payload) {
  var code        = payload.code;
  var descripcion = String(payload.descripcion || '').trim();
  var responsable = payload.responsable;
  var estado      = payload.estado;

  if (!code)                                  return json({ ok: false, reason: 'missing_code' });
  if (!descripcion)                           return json({ ok: false, reason: 'missing_descripcion' });
  if (VALID_ESTADOS.indexOf(estado) < 0)      return json({ ok: false, reason: 'invalid_estado' });
  if (VALID_RESPONSABLES.indexOf(responsable) < 0) return json({ ok: false, reason: 'invalid_responsable' });

  var sheet   = getSheet(SHEET_OTROS);
  var nextRow = Math.max(sheet.getLastRow() + 1, DATA_START_ROW);
  var now     = new Date();

  sheet.getRange(nextRow, COL_PLACA).setValue(code);
  sheet.getRange(nextRow, COL_DESCRIPCION).setValue(descripcion);
  sheet.getRange(nextRow, COL_RESPONSABLE).setValue(responsable);
  sheet.getRange(nextRow, COL_ESTADO).setValue(estado);

  var fechaCell = sheet.getRange(nextRow, COL_FECHA);
  fechaCell.setNumberFormat('yyyy-mm-dd hh:mm:ss');
  fechaCell.setValue(now);

  return json({
    ok:          true,
    placa:       code,
    descripcion: descripcion,
    responsable: responsable,
    estado:      estado,
    fecha:       formatDate(now)
  });
}


// ─── HELPERS ───────────────────────────────────────────────────────────────────

// Strips non-breaking spaces ( ) and surrounding whitespace.
// Applied to BOTH the sheet value and the incoming code before comparing.
function normalize(val) {
  return String(val).replace(/ /g, ' ').trim();
}

function getSheet(name) {
  if (!SPREADSHEET_ID) throw new Error('Script property SPREADSHEET_ID is not set.');
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet "' + name + '" not found in spreadsheet.');
  return sheet;
}

// Searches COL_PLACA in the given sheet from DATA_START_ROW down.
// Returns { row, duplicate } for the first normalized match, or null.
function findRow(sheetName, code) {
  var sheet   = getSheet(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return null;

  var numRows    = lastRow - DATA_START_ROW + 1;
  var values     = sheet.getRange(DATA_START_ROW, COL_PLACA, numRows, 1).getValues();
  var target     = normalize(code);
  var firstMatch = -1;
  var duplicate  = false;

  for (var i = 0; i < values.length; i++) {
    if (normalize(values[i][0]) === target) {
      if (firstMatch === -1) {
        firstMatch = DATA_START_ROW + i;
      } else {
        duplicate = true;
        break;
      }
    }
  }

  if (firstMatch === -1) return null;
  return { row: firstMatch, duplicate: duplicate };
}

function formatDate(d) {
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  return d.getFullYear()     + '-' +
         pad(d.getMonth()+1) + '-' +
         pad(d.getDate())    + ' ' +
         pad(d.getHours())   + ':' +
         pad(d.getMinutes()) + ':' +
         pad(d.getSeconds());
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
