// La configuración se lee de las variables de entorno EXPO_PUBLIC_* (ver .env.example)
// para que los valores reales nunca vivan en el código fuente / historial de Git.
//
// IMPORTANTE: Las variables EXPO_PUBLIC_* se incorporan en el paquete JS al compilar —
// cualquiera con el APK puede extraerlas. NO son secretos criptográficos.
// Mantenerlas fuera de las variables de entorno solo las mantiene fuera del repositorio Git;

const WEB_APP_URL = process.env.EXPO_PUBLIC_WEB_APP_URL;
const API_TOKEN   = process.env.EXPO_PUBLIC_API_TOKEN;

if (!WEB_APP_URL) {
  throw new Error(
    'EXPO_PUBLIC_WEB_APP_URL no está establecido. Crea un archivo .env a partir de .env.example ' +
    'y reinicia el Metro bundler.',
  );
}
if (!API_TOKEN) {
  throw new Error(
    'EXPO_PUBLIC_API_TOKEN no está establecido. Crea un archivo .env a partir de .env.example ' +
    'y reinicia el Metro bundler.',
  );
}

// ─── Tipos: configuración ──────────────────────────────────────────────────────
// Estos tipos reflejan lo que el backend devuelve desde la hoja "Config" —
// ningún estado/responsable/campo de formulario está fijo en el código.

export type EstadoOption = { valor: string; etiqueta: string };

export type AppConfig = {
  configVersion: number;
  nombreInventario: string;
  estados: EstadoOption[];
  responsables: string[];
  formularios: {
    localizado: string[];
    otroBien: string[];
  };
};

export type GetConfigResult =
  | ({ ok: true } & AppConfig)
  | { ok: false; reason: string; detail?: string };

// ─── Tipos: lookup / submit ─────────────────────────────────────────────────────

export type LookupResult =
  | {
      found: true;
      placa: string;
      descripcion: string;
      marca: string;
      ubicacion: string;
      row: number;
      warning?: string;
    }
  | { found: false; reason?: string };

// El valor real de "estado"/"responsable" ya no es un literal fijo — viene
// de la lista que devuelve getConfig().
export type Estado = string;
export type Responsable = string;

export type SubmitLocalizadoPayload = {
  code: string;
  estado: Estado;
};

export type SubmitOtroBienPayload = {
  code: string;
  descripcion: string;
  responsable: Responsable;
  estado: Estado;
};

export type SubmitResult =
  | {
      ok: true;
      placa: string;
      estado: string;
      fecha: string;
      descripcion?: string;
      responsable?: string;
      warning?: string;
    }
  | { ok: false; reason: string; detail?: string };

// ─── Network ────────

// texto/plain evita la preflight CORS que GAS no puede manejar desde clientes nativos.
// el preflight hace que la app falle con un error de CORS antes de que el request llegue al backend.
async function post(body: object): Promise<unknown> {
  const res = await fetch(WEB_APP_URL as string, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, token: API_TOKEN }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  if (typeof data === 'object' && data !== null) {
    const reason = (data as { reason?: string }).reason;
    if (reason === 'unauthorized') {
      throw new Error('No autorizado: el token de la app no coincide con el del backend.');
    }
    if (reason === 'config_mismatch') {
      const detail = (data as { detail?: string }).detail;
      throw new Error(`Configuración inválida en el backend: ${detail ?? 'sin detalle'}`);
    }
  }

  return data;
}

// ─── API publica ──────

export async function getConfig(): Promise<GetConfigResult> {
  return post({ action: 'getConfig' }) as Promise<GetConfigResult>;
}

export async function lookupAsset(code: string): Promise<LookupResult> {
  return post({ action: 'lookup', code }) as Promise<LookupResult>;
}

export async function submitLocalizado(payload: SubmitLocalizadoPayload): Promise<SubmitResult> {
  return post({ action: 'submitLocalizado', ...payload }) as Promise<SubmitResult>;
}

export async function submitOtroBien(payload: SubmitOtroBienPayload): Promise<SubmitResult> {
  return post({ action: 'submitOtroBien', ...payload }) as Promise<SubmitResult>;
}
