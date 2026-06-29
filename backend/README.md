# Configuración del backend (Google Apps Script)

`Code.gs` lee dos valores desde **Script Properties** en lugar de tenerlos
codificados de forma fija, así nunca terminan en el archivo confirmado ni en el historial de Git.

## Configurar las propiedades del script

1. Abre el proyecto de Apps Script (Extensiones → Apps Script desde la hoja de cálculo,
   o script.google.com).
2. Pega en `Code.gs`.
3. Haz clic en el icono de engranaje (**Project Settings**) en la barra lateral izquierda.
4. Desplázate hasta **Script Properties** → **Add script property**, y añade:

   | Propiedad       | Valor                                                         |
   |-----------------|---------------------------------------------------------------|
   | `SPREADSHEET_ID` | El ID de la URL de la hoja: `.../d/<SPREADSHEET_ID>/edit`      |
   | `API_TOKEN`      | Una cadena larga aleatoria — debe coincidir con `EXPO_PUBLIC_API_TOKEN` en el `.env` de la app |

5. Guarda.

## Desplegar

1. **Deploy → Manage deployments → pencil icon → Version: New version → Deploy.**
2. Copia la URL `/exec` en el `.env` de la app como `EXPO_PUBLIC_WEB_APP_URL`.

> Cada vez que se edite `Code.gs`, debes desplegar una **new version** — la URL
> `/exec` de lo contrario seguirá sirviendo el código antiguo.

## Comprobación del token

Cada solicitud `doPost` debe incluir un campo `token` que coincida con `API_TOKEN`. Si
no coincide (o `API_TOKEN` no está definido), el script devuelve
{ ok: false, found: false, reason: "unauthorized" } sin tocar la hoja.

## Hoja "Config" (Fase 1: configuración externalizada)

`Code.gs` ya no tiene nombres de hoja, columnas, estados ni responsables
codificados — todo eso vive en un JSON dentro de una hoja llamada **Config**,
en la misma hoja de cálculo.

1. Crea una hoja nueva llamada exactamente **Config** (puedes ocultarla).
2. Copia el contenido de [`config.example.json`](config.example.json) y
   pégalo, como texto plano, en la celda **A1** de esa hoja.
3. Ajusta los valores al inventario real: nombres de hoja, encabezados de
   columna (deben coincidir con el texto real de la fila de encabezado —
   tildes y mayúsculas no importan, pero el texto sí), estados, responsables
   y qué pide cada formulario.

> El campo `provider.locator` del JSON es solo documentación — el
> `SPREADSHEET_ID` real sigue viniendo exclusivamente de Script Properties,
> nunca de esta celda.

Si un nombre de columna en el config no se encuentra en la fila de
encabezado configurada, el backend responde con
`{ ok: false, reason: "config_mismatch", detail: "..." }` en vez de escribir
en la columna equivocada. El campo `detail` dice exactamente qué columna o
qué hoja no coincide.

Para adaptar el sistema a otro inventario: edita esta celda, no `Code.gs`.
