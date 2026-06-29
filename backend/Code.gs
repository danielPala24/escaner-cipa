// ─── SECRETOS (Script Properties) ───────────────────────────────────────────
// SPREADSHEET_ID y API_TOKEN NUNCA viven en este archivo ni en la hoja de
// Config — se leen de Script Properties para que nunca terminen en el
// historial de Git ni en el JSON de configuración editable.
// Se configuran en: Apps Script editor → Project Settings (engranaje) →
// Script Properties. Ver backend/README.md.
var SCRIPT_PROPS   = PropertiesService.getScriptProperties();
var SPREADSHEET_ID = SCRIPT_PROPS.getProperty('SPREADSHEET_ID');
var API_TOKEN      = SCRIPT_PROPS.getProperty('API_TOKEN');

// La hoja "Config" y la celda donde vive el JSON de configuración no cambian
// entre instalaciones, todo lo demás (nombres de hoja, columnas, estados,
// responsables, qué pide cada formulario) vive en ese JSON.
var CONFIG_SHEET_NAME = 'Config';
var CONFIG_CELL       = 'A1';
// ──────────────────────────────────────────────────────────────────────────────


// Error especial: un valor del config no coincide con la hoja real
// (encabezado faltante, hoja faltante, JSON inválido, etc). Se distingue de
// un error genérico de servidor para que el backend nunca escriba en la
// columna equivocada en silencio.
function ConfigMismatchError(message) {
  this.message = message;
  this.configMismatch = true;
}
ConfigMismatchError.prototype = Object.create(Error.prototype);
ConfigMismatchError.prototype.name = 'ConfigMismatchError';


// meh, la verdad medio sobra este paso pero es bueno para saber si se hizo el redeploy correctamente.
// Health-check: abre la URL /exec en un navegador para confirmar que el script está activo.
function doGet(e) {
  return json({ status: 'ok' });
}


// Todas las solicitudes de la app llegan aquí.
// Body: Content-Type text/plain;charset=utf-8, contenido: JSON string.
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);

    if (!API_TOKEN || payload.token !== API_TOKEN) {
      return json({ ok: false, found: false, reason: 'unauthorized' });
    }

    // Se parsea una sola vez por solicitud y se pasa a cada handler
    // nunca se vuelve a leer/parsear por cada fila.
    var config = loadConfig();
    var action = payload.action;

    if (action === 'getConfig')        return handleGetConfig(config);
    if (action === 'lookup')           return handleLookup(payload, config);
    if (action === 'submitLocalizado') return handleSubmitLocalizado(payload, config);
    if (action === 'submitOtroBien')   return handleSubmitOtroBien(payload, config);

    return json({ error: 'Unknown action: ' + action });
  } catch (err) {
    if (err && err.configMismatch) {
      return json({ ok: false, found: false, reason: 'config_mismatch', detail: err.message });
    }
    return json({ error: 'Server error: ' + err.message });
  }
}


// ─── CONFIG ────────────────────────────────────────────────────────────────────

// Lee y parsea el JSON de configuración desde la hoja "Config".
function loadConfig() {
  if (!SPREADSHEET_ID) throw new Error('Script property SPREADSHEET_ID no está definido.');

  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!sheet) {
    throw new ConfigMismatchError(
      'Hoja "' + CONFIG_SHEET_NAME + '" no encontrada. Créala con el JSON de configuración en la celda ' + CONFIG_CELL + '.'
    );
  }

  var raw = sheet.getRange(CONFIG_CELL).getValue();
  if (!raw) {
    throw new ConfigMismatchError('La celda ' + CONFIG_SHEET_NAME + '!' + CONFIG_CELL + ' está vacía.');
  }

  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new ConfigMismatchError('El JSON de configuración es inválido: ' + e.message);
  }
}

// Devuelve a la app solo lo que necesita para construir su UI — nunca
// provider.locator (sería el SPREADSHEET_ID) ni nombres internos de hoja/columna.
function handleGetConfig(config) {
  return json({
    ok:               true,
    configVersion:    config.configVersion,
    nombreInventario: config.nombreInventario,
    estados:          config.estados,
    responsables:     config.responsables,
    formularios:      config.formularios
  });
}


// ─── LOOKUP ────────────────────────────────────────────────────────────────────
// Input:  { action:"lookup", code }
// Output: { found:true, placa, descripcion, marca, ubicacion, row, ?warning }
//      OR { found:false }
function handleLookup(payload, config) {
  var code = payload.code;
  if (!code) return json({ found: false, reason: 'missing_code' });

  var hojaConfig = getHojaConfig(config, 'localizados');
  var sheet      = getSheetByConfig(hojaConfig);
  var columnMap  = buildColumnMap(sheet, hojaConfig, config);
  var llaveRole  = config.llaveDeEscaneo || 'llave';

  var result = findRow(sheet, hojaConfig, columnMap, llaveRole, code, config);
  if (!result) return json({ found: false });

  var row = result.row;
  var resp = {
    found:       true,
    placa:       getCell(sheet, row, columnMap, llaveRole, config),
    descripcion: getCell(sheet, row, columnMap, 'descripcion', config),
    marca:       getCell(sheet, row, columnMap, 'marca', config),
    ubicacion:   getCell(sheet, row, columnMap, 'ubicacion', config),
    row:         row
  };
  if (result.duplicate) resp.warning = 'duplicate_llave';
  return json(resp);
}


// ─── SUBMIT LOCALIZADO ─────────────────────────────────────────────────────────
// Input:  { action:"submitLocalizado", code, estado }
// Output: { ok:true, placa, estado, fecha, ?warning }
//      OR { ok:false, reason:"missing_code"|"invalid_estado"|"not_found" }
function handleSubmitLocalizado(payload, config) {
  var code   = payload.code;
  var estado = payload.estado;

  if (!code)                          return json({ ok: false, reason: 'missing_code' });
  if (!isValidEstado(config, estado)) return json({ ok: false, reason: 'invalid_estado' });

  var hojaConfig = getHojaConfig(config, 'localizados');
  var sheet      = getSheetByConfig(hojaConfig);
  var columnMap  = buildColumnMap(sheet, hojaConfig, config);
  var llaveRole  = config.llaveDeEscaneo || 'llave';

  var result = findRow(sheet, hojaConfig, columnMap, llaveRole, code, config);
  if (!result) return json({ ok: false, reason: 'not_found' });

  var row = result.row;
  var now = new Date();

  sheet.getRange(row, columnMap['estado']).setValue(estado);

  var fechaCell = sheet.getRange(row, columnMap['fechaEscaneo']);
  fechaCell.setNumberFormat('yyyy-mm-dd hh:mm:ss');
  fechaCell.setValue(now);

  var resp = {
    ok:     true,
    placa:  getCell(sheet, row, columnMap, llaveRole, config),
    estado: estado,
    fecha:  formatDate(now)
  };
  if (result.duplicate) resp.warning = 'duplicate_llave';
  return json(resp);
}


// ─── SUBMIT OTRO BIEN ──────────────────────────────────────────────────────────
// Input:  { action:"submitOtroBien", code, descripcion, responsable, estado }
// Output: { ok:true, placa, descripcion, responsable, estado, fecha }
//      OR { ok:false, reason:"missing_code"|"missing_descripcion"|
//                           "invalid_estado"|"invalid_responsable" }
function handleSubmitOtroBien(payload, config) {
  var code        = payload.code;
  var descripcion = String(payload.descripcion || '').trim();
  var responsable = payload.responsable;
  var estado      = payload.estado;

  if (!code)                                    return json({ ok: false, reason: 'missing_code' });
  if (!descripcion)                             return json({ ok: false, reason: 'missing_descripcion' });
  if (!isValidEstado(config, estado))           return json({ ok: false, reason: 'invalid_estado' });
  if (!isValidResponsable(config, responsable)) return json({ ok: false, reason: 'invalid_responsable' });

  var hojaConfig = getHojaConfig(config, 'otros');
  var sheet      = getSheetByConfig(hojaConfig);
  var columnMap  = buildColumnMap(sheet, hojaConfig, config);
  var llaveRole  = config.llaveDeEscaneo || 'llave';

  var nextRow = Math.max(sheet.getLastRow() + 1, hojaConfig.dataStartRow);
  var now     = new Date();

  sheet.getRange(nextRow, columnMap[llaveRole]).setValue(code);
  sheet.getRange(nextRow, columnMap['descripcion']).setValue(descripcion);
  sheet.getRange(nextRow, columnMap['responsable']).setValue(responsable);
  sheet.getRange(nextRow, columnMap['estado']).setValue(estado);

  var fechaCell = sheet.getRange(nextRow, columnMap['fechaEscaneo']);
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


// ─── VALIDACIÓN CONTRA CONFIG ──────────────────────────────────────────────────

function isValidEstado(config, estado) {
  var estados = config.estados || [];
  for (var i = 0; i < estados.length; i++) {
    if (estados[i].valor === estado) return true;
  }
  return false;
}

function isValidResponsable(config, responsable) {
  var lista = config.responsables || [];
  return lista.indexOf(responsable) >= 0;
}


// ─── RESOLUCIÓN DE HOJAS Y COLUMNAS POR CONFIG ─────────────────────────────────

// Lee config.hojas[hojaKey] (p.ej. "localizados", "otros") y valida que exista.
function getHojaConfig(config, hojaKey) {
  var hoja = config.hojas && config.hojas[hojaKey];
  if (!hoja || !hoja.nombre) {
    throw new ConfigMismatchError('Config inválida: falta "hojas.' + hojaKey + '".');
  }
  return hoja;
}

function getSheetByConfig(hojaConfig) {
  if (!SPREADSHEET_ID) throw new Error('Script property SPREADSHEET_ID no está definido.');
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(hojaConfig.nombre);
  if (!sheet) {
    throw new ConfigMismatchError('Hoja "' + hojaConfig.nombre + '" no encontrada en la hoja de cálculo.');
  }
  return sheet;
}

// Construye { rol -> índiceDeColumna(1-based) } leyendo la fila de encabezado
// configurada y emparejándola contra config.columnas (rol -> texto de encabezado).
// Tanto los encabezados reales como los nombres del config se normalizan IGUAL
// (trim, NBSP→espacio, espacios repetidos→uno, minúsculas) antes de comparar,
// porque las hojas reales suelen traer espacios sobrantes, NBSP y acentos que
// rompen una comparación exacta sin ser un error real de config.
// TODO el acceso a columnas pasa por este mapa — nunca por índice fijo.
function buildColumnMap(sheet, hojaConfig, config) {
  var headerRow    = hojaConfig.headerRow;
  var lastCol      = Math.max(sheet.getLastColumn(), 1);
  var headerValues = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];

  var headerIndex = {};
  for (var c = 0; c < headerValues.length; c++) {
    var h = normalizeHeader(headerValues[c]);
    if (h) headerIndex[h] = c + 1;
  }

  var map      = {};
  var columnas = config.columnas || {};
  for (var role in columnas) {
    var headerName = normalizeHeader(columnas[role]);
    var colIndex   = headerIndex[headerName];
    if (!colIndex) {
      throw new ConfigMismatchError(
        'columna "' + columnas[role] + '" no encontrada en la fila de encabezado (' +
        headerRow + ') de la hoja "' + hojaConfig.nombre + '"'
      );
    }
    map[role] = colIndex;
  }
  return map;
}

// Normaliza un texto de encabezado para comparar de forma tolerante:
// NBSP→espacio, trim, espacios repetidos colapsados a uno solo, minúsculas.
function normalizeHeader(val) {
  return String(val)
    .replace(/ /g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}


// ─── BÚSQUEDA Y LECTURA DE CELDAS ──────────────────────────────────────────────

// Busca la llave de escaneo en la hoja desde dataStartRow hacia abajo.
// Devuelve { row, duplicate } para la primera coincidencia normalizada, o null.
function findRow(sheet, hojaConfig, columnMap, llaveRole, code, config) {
  var dataStartRow = hojaConfig.dataStartRow;
  var lastRow       = sheet.getLastRow();
  if (lastRow < dataStartRow) return null;

  var colIndex = columnMap[llaveRole];
  var numRows  = lastRow - dataStartRow + 1;
  var values   = sheet.getRange(dataStartRow, colIndex, numRows, 1).getValues();
  var target   = normalize(code, config);

  var firstMatch = -1;
  var duplicate  = false;
  for (var i = 0; i < values.length; i++) {
    if (normalize(values[i][0], config) === target) {
      if (firstMatch === -1) {
        firstMatch = dataStartRow + i;
      } else {
        duplicate = true;
        break;
      }
    }
  }

  if (firstMatch === -1) return null;
  return { row: firstMatch, duplicate: duplicate };
}

function getCell(sheet, row, columnMap, role, config) {
  var col = columnMap[role];
  if (!col) return '';
  return normalize(sheet.getRange(row, col).getValue(), config);
}

// Normaliza un valor de celda según config.normalizacion (trim, NBSP, nunca
// como número). Se aplica a la llave de escaneo Y a los demás valores leídos.
function normalize(val, config) {
  var norm = (config && config.normalizacion) || {};
  var s = String(val);
  if (norm.reemplazarNbsp !== false) s = s.replace(/ /g, ' ');
  if (norm.trimLlave !== false) s = s.trim();
  return s;
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
