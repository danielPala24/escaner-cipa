# escaner-cipa

Este proyecto es un escaner de código de barras para el CIPA en el TEC. Es una app de React Native + Expo que escanea etiquetas con código 39 / código 128 y actualiza unas Google Sheet por medio de Google Apps Script. 

## Variables de entorno

Copiar `.env.example` a `.env` y llenar con los valores reales:

```
EXPO_PUBLIC_WEB_APP_URL=   # El Apps Script Web App /exec URL
EXPO_PUBLIC_API_TOKEN=     # Debería de ser igual al API_TOKEN en Code.gs
```

Las `EXPO_PUBLIC_*` variables se empaquetan en el build de JS en tiempo de compilación, actualmente no son criptográficamente secretas lo que quiere decir que cualquiera con el APK podría extraerlas. EL punto del `.env` es poder mantener estos valores fuera del repositorio de git, no como tal una manera de esconderlas por completo. Para entender y ver como actualmente funciona y esta seteada el `API_TOKEN` ver [backend/README.md](backend/README.md).

Después de editar `.env`, reinicie el empaquetador de Metro (las variables de entorno se leen al momento de empaquetar, no en cada recarga).

## setup del backend

Consulte [backend/README.md](backend/README.md) para configurar las propiedades del script `SPREADSHEET_ID` y `API_TOKEN`, y para desplegar `Code.gs`.

## Correrlo en un celular (Expo Go)

La camara y el escaneo de código de barra unicamente funcionan en un dispositivo real, no en simuladores.

```bash
npm install
npm start
```

Abrir **EXpo GO** en un teléfono Android y escanear el código QR que se generó en la terminal. Al hacerlo se abre la app y se podrá empezar a escanear medianete el uso de la camara las etiquetas.

## Estructura del proyecto

```
escaner-cipa/
├── App.tsx              componente de entrada (convención de Expo, se queda en la raíz)
├── index.ts              registra el componente raíz (convención de Expo)
├── src/
│   ├── screens/          ScannerScreen.tsx — el flujo de escaneo/búsqueda/envío
│   ├── services/         inventory.ts — llamadas a la API del backend
│   └── theme.ts           constantes de color compartidas
├── backend/               código de Google Apps Script (Code.gs) + su propio README
├── assets/                íconos de la app, referenciados desde app.json
```
