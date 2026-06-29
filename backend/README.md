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
