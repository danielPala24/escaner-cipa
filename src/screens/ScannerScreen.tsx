import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import {
  lookupAsset,
  submitLocalizado,
  submitOtroBien,
  Estado,
  EstadoOption,
  Responsable,
} from '../services/inventory';
import { useConfig } from '../context/ConfigContext';
import { BLUE, ORANGE } from '../theme';

// ─── Logica de estados ────────
//
//  escaneando ──scan──> buscando ──encontrado──> confirming_localizado ──> enviando ──> hecho
//                              └──no encontrado──> form_otro_bien        ──> enviando ──> hecho
//
// Error durante el envio regresa al estado del formulario de origen (datos conservados).

type AppState =
  | 'scanning'
  | 'manual_input'
  | 'looking_up'
  | 'confirming_localizado'
  | 'confirming_not_found'
  | 'form_otro_bien'
  | 'sending'
  | 'done';

// De dónde vino el código actual. Solo afecta la UI (qué tan prominente se
// muestra la confirmación, y si un "no encontrado" pide doble confirmación) —
// el lookup/submit en sí es idéntico para ambas fuentes.
type InputSource = 'scan' | 'manual';

type AssetInfo = {
  placa: string;
  descripcion: string;
  marca: string;
  ubicacion: string;
};

type DoneInfo = {
  placa: string;
  estado: string;
  fecha: string;
  descripcion?: string;
  responsable?: string;
};

// ─── Componente ─────

export default function ScannerScreen() {
  const config = useConfig();
  const [permission, requestPermission] = useCameraPermissions();

  const [appState, setAppState]   = useState<AppState>('scanning');
  const [scannedCode, setScannedCode] = useState('');
  const [inputSource, setInputSource] = useState<InputSource>('scan');
  const [asset, setAsset]         = useState<AssetInfo | null>(null);

  // Texto del campo de entrada manual (separado de scannedCode, que es el
  // código ya confirmado/normalizado que se usó para el lookup).
  const [manualCode, setManualCode] = useState('');

  // Campo compartido usado por ambos formularios
  const [estado, setEstado]       = useState<Estado | null>(null);

  // Campo para formulario "Otro bien"
  const [descripcion, setDescripcion] = useState('');
  const [responsable, setResponsable] = useState<Responsable | null>(null);

  const [doneInfo, setDoneInfo]   = useState<DoneInfo | null>(null);

  const reset = useCallback(() => {
    setAppState('scanning');
    setScannedCode('');
    setInputSource('scan');
    setManualCode('');
    setAsset(null);
    setEstado(null);
    setDescripcion('');
    setResponsable(null);
    setDoneInfo(null);
  }, []);

  // ─── Lookup compartido (escaneo Y entrada manual pasan por aquí) ─────────────
  // El código puede venir de la cámara o del teclado — a partir de este punto
  // el flujo es idéntico, salvo el manejo del caso "no encontrado": un código
  // manual no encontrado pide doble confirmación (riesgo de error de tipeo),
  // uno escaneado va directo al formulario de "Otro bien" como siempre.

  const performLookup = useCallback(async (code: string, source: InputSource) => {
    setScannedCode(code);
    setInputSource(source);
    setAppState('looking_up');

    try {
      const lookup = await lookupAsset(code);

      if (lookup.found) {
        setAsset({
          placa:       lookup.placa,
          descripcion: lookup.descripcion,
          marca:       lookup.marca,
          ubicacion:   lookup.ubicacion,
        });
        setAppState('confirming_localizado');
      } else {
        setAsset(null);
        if (source === 'manual') {
          // Entrada manual sin coincidencia: puede ser un typo — pedir
          // confirmación explícita antes de crear un "otro bien".
          setAppState('confirming_not_found');
        } else {
          // Escaneado y no encontrado sigue siendo el camino normal/esperado.
          setAppState('form_otro_bien');
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (source === 'manual') {
        Alert.alert(
          'Error de conexión',
          `No se pudo consultar el inventario.\n\nDetalle: ${msg}`,
          [{ text: 'Reintentar', onPress: () => setAppState('manual_input') }],
        );
      } else {
        Alert.alert(
          'Error de conexión',
          `No se pudo consultar el inventario.\n\nDetalle: ${msg}`,
          [{ text: 'Volver a escanear', onPress: reset }],
        );
      }
    }
  }, [reset]);

  const handleBarcodeScanned = useCallback((result: BarcodeScanningResult) => {
    performLookup(result.data, 'scan');
  }, [performLookup]);

  // Misma normalización que aplica el backend (NBSP→espacio, luego trim) —
  // de cortesía, el backend ya normaliza igual sin importar el origen.
  const handleManualSubmit = () => {
    const code = manualCode.replace(/ /g, ' ').trim();
    if (!code) return;
    performLookup(code, 'manual');
  };

  // ─── Submit: Bien Localizado ──────

  const handleSubmitLocalizado = async () => {
    if (!estado || !scannedCode) return;
    setAppState('sending');

    try {
      const result = await submitLocalizado({ code: scannedCode, estado });

      if (!result.ok) {
        const reasons: Record<string, string> = {
          not_found:     'El activo ya no se encontró en la hoja.',
          invalid_estado:'Estado inválido.',
          missing_code:  'Código faltante.',
        };
        Alert.alert(
          'Error al enviar',
          reasons[result.reason] ?? `Error: ${result.reason}`,
          [{ text: 'Corregir', onPress: () => setAppState('confirming_localizado') }],
        );
        return;
      }

      setDoneInfo({ placa: result.placa, estado: result.estado, fecha: result.fecha });
      setAppState('done');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert(
        'Error de conexión',
        `No se pudo enviar el registro. Sus datos están conservados.\n\nDetalle: ${msg}`,
        [{ text: 'Reintentar', onPress: () => setAppState('confirming_localizado') }],
      );
    }
  };

  // ─── Submit: Otro Bien ──────

  const handleSubmitOtroBien = async () => {
    if (!estado || !responsable || !descripcion.trim() || !scannedCode) return;
    setAppState('sending');

    try {
      const result = await submitOtroBien({
        code:        scannedCode,
        descripcion: descripcion.trim(),
        responsable,
        estado,
      });

      if (!result.ok) {
        const reasons: Record<string, string> = {
          missing_descripcion: 'La descripción es requerida.',
          invalid_estado:      'Estado inválido.',
          invalid_responsable: 'Responsable inválido.',
          missing_code:        'Código faltante.',
        };
        Alert.alert(
          'Error al enviar',
          reasons[result.reason] ?? `Error: ${result.reason}`,
          [{ text: 'Corregir', onPress: () => setAppState('form_otro_bien') }],
        );
        return;
      }

      setDoneInfo({
        placa:       result.placa,
        estado:      result.estado,
        fecha:       result.fecha,
        descripcion: result.descripcion,
        responsable: result.responsable,
      });
      setAppState('done');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert(
        'Error de conexión',
        `No se pudo enviar el registro. Sus datos están conservados.\n\nDetalle: ${msg}`,
        [{ text: 'Reintentar', onPress: () => setAppState('form_otro_bien') }],
      );
    }
  };

  // ─── Campos dinámicos por config ─────────────────────────────────────────────
  // Qué campos pide cada formulario viene de config.formularios — nunca fijo
  // en el componente. Roles desconocidos se ignoran (no bloquean el envío).

  const campoCompleto = (campo: string): boolean => {
    if (campo === 'estado') return !!estado;
    if (campo === 'responsable') return !!responsable;
    if (campo === 'descripcion') return descripcion.trim().length > 0;
    return true;
  };

  const renderCampo = (campo: string) => {
    if (campo === 'estado') {
      return (
        <View key="estado">
          <Text style={s.fieldLabel}>Estado del bien</Text>
          <EstadoSelector value={estado} onChange={setEstado} options={config.estados} />
        </View>
      );
    }
    if (campo === 'responsable') {
      return (
        <View key="responsable">
          <Text style={s.fieldLabel}>Responsable del bien</Text>
          <ResponsableSelector value={responsable} onChange={setResponsable} options={config.responsables} />
        </View>
      );
    }
    if (campo === 'descripcion') {
      return (
        <View key="descripcion">
          <Text style={s.fieldLabel}>Descripción del bien</Text>
          <TextInput
            style={s.input}
            placeholder="Descripción del activo"
            placeholderTextColor="#aaa"
            value={descripcion}
            onChangeText={setDescripcion}
            autoCapitalize="sentences"
            returnKeyType="next"
          />
        </View>
      );
    }
    return null;
  };

  // ─── Permisos de camara ───────

  if (!permission) {
    return <View style={s.center}><ActivityIndicator color={BLUE} /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={s.center}>
        <Text style={s.message}>Se requiere acceso a la cámara para escanear códigos de barras.</Text>
        <Pressable style={s.btn} onPress={requestPermission}>
          <Text style={s.btnText}>Conceder permiso</Text>
        </Pressable>
      </View>
    );
  }

  // ─── scanning / looking_up ───────
  // estados de escaneo y busqueda de activo

  if (appState === 'scanning' || appState === 'looking_up') {
    return (
      <View style={s.container}>
        <CameraView
          style={s.camera}
          barcodeScannerSettings={{ barcodeTypes: ['code39', 'code128'] }}
          onBarcodeScanned={appState === 'scanning' ? handleBarcodeScanned : undefined}
        />
        <View style={s.panel}>
          {appState === 'looking_up' ? (
            <>
              <ActivityIndicator color={BLUE} size="large" />
              <Text style={[s.hint, { marginTop: 12 }]}>Buscando activo…</Text>
            </>
          ) : (
            <>
              <Text style={s.hint}>Apunte la cámara hacia un código de barras</Text>
              <Pressable
                style={s.manualEntryBtn}
                onPress={() => { setManualCode(''); setAppState('manual_input'); }}
              >
                <Text style={s.manualEntryBtnText}>Ingresar código manualmente</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  }

  // ─── manual_input ───────────────────────────────────────────────────────────

  if (appState === 'manual_input') {
    const canSubmit = manualCode.trim().length > 0;
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
        <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
          <View style={s.formHeader}>
            <Text style={s.formHeaderBadge}>Entrada Manual</Text>
            <Text style={[s.formHeaderCode, { fontSize: 18 }]}>Ingrese el código de la placa</Text>
          </View>

          <Text style={s.fieldLabel}>Código</Text>
          <TextInput
            style={s.input}
            placeholder="Ej. 80415, AI-0512, M08"
            placeholderTextColor="#aaa"
            value={manualCode}
            onChangeText={setManualCode}
            autoCapitalize="characters"
            autoFocus
            returnKeyType="search"
            onSubmitEditing={canSubmit ? handleManualSubmit : undefined}
          />

          <Pressable
            style={[s.btn, !canSubmit && s.btnDisabled]}
            onPress={handleManualSubmit}
            disabled={!canSubmit}
          >
            <Text style={s.btnText}>Buscar</Text>
          </Pressable>

          <Pressable onPress={reset} style={s.cancelBtn}>
            <Text style={s.cancelText}>Cancelar</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ─── confirming_not_found (solo entrada manual) ──────────────────────────────
  // Un código manual no encontrado puede ser un typo — se exige una segunda
  // confirmación explícita antes de dejarlo pasar al formulario de "Otro bien".

  if (appState === 'confirming_not_found') {
    return (
      <View style={s.center}>
        <Text style={s.warningTitle}>Código no encontrado</Text>
        <Text style={s.message}>
          El código "{scannedCode}" no está registrado en el inventario.{'\n\n'}
          ¿Está seguro de que lo escribió bien?
        </Text>
        <Pressable
          style={[s.btn, { width: '100%' }]}
          onPress={() => setAppState('manual_input')}
        >
          <Text style={s.btnText}>Revisar / corregir</Text>
        </Pressable>
        <Pressable
          style={[s.btn, s.btnOutline, { width: '100%' }]}
          onPress={() => setAppState('form_otro_bien')}
        >
          <Text style={[s.btnText, s.btnTextOutline]}>Sí, continuar de todos modos</Text>
        </Pressable>
      </View>
    );
  }

  // ─── sending/enviando ───────

  if (appState === 'sending') {
    return (
      <View style={s.center}>
        <ActivityIndicator color={BLUE} size="large" />
        <Text style={[s.hint, { marginTop: 16 }]}>Enviando…</Text>
      </View>
    );
  }

  // ─── confirming_localizado ──────

  if (appState === 'confirming_localizado' && asset) {
    const canSubmit = config.formularios.localizado.every(campoCompleto);
    return (
      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        <View style={s.formHeader}>
          <Text style={s.formHeaderBadge}>Bien Localizado</Text>
          <Text style={s.formHeaderCode}>{asset.placa}</Text>
        </View>

        {inputSource === 'manual' && (
          <View style={s.manualWarningBanner}>
            <Text style={s.manualWarningText}>
              Entrada manual: verifique cuidadosamente que estos datos correspondan
              al activo correcto antes de continuar.
            </Text>
          </View>
        )}

        <View style={[s.card, inputSource === 'manual' && s.cardManualHighlight]}>
          <DetailRow label="Descripción" value={asset.descripcion} />
          <DetailRow label="Marca"       value={asset.marca} />
          <DetailRow label="Ubicación"   value={asset.ubicacion} />
        </View>

        {config.formularios.localizado.map(renderCampo)}

        <Pressable
          style={[s.btn, !canSubmit && s.btnDisabled]}
          onPress={handleSubmitLocalizado}
          disabled={!canSubmit}
        >
          <Text style={s.btnText}>Enviar</Text>
        </Pressable>

        <Pressable onPress={reset} style={s.cancelBtn}>
          <Text style={s.cancelText}>Cancelar y escanear otro</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // ─── form_otro_bien ─────

  if (appState === 'form_otro_bien') {
    const canSubmit = config.formularios.otroBien.every(campoCompleto);
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
        <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
          <View style={[s.formHeader, s.formHeaderOtro]}>
            <Text style={s.formHeaderBadge}>Otro Bien</Text>
            <Text style={s.formHeaderCode}>{scannedCode}</Text>
          </View>

          <Text style={s.fieldLabel}>Placa</Text>
          <TextInput
            style={[s.input, s.inputReadonly]}
            value={scannedCode}
            editable={false}
          />

          {config.formularios.otroBien.map(renderCampo)}

          <Pressable
            style={[s.btn, !canSubmit && s.btnDisabled]}
            onPress={handleSubmitOtroBien}
            disabled={!canSubmit}
          >
            <Text style={s.btnText}>Enviar</Text>
          </Pressable>

          <Pressable onPress={reset} style={s.cancelBtn}>
            <Text style={s.cancelText}>Cancelar y escanear otro</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ─── done/listo ─────

  if (appState === 'done' && doneInfo) {
    return (
      <View style={s.doneContainer}>
        <View style={s.checkCircle}>
          <Text style={s.checkMark}>✓</Text>
        </View>
        <Text style={s.doneTitle}>Registro enviado</Text>

        <View style={[s.card, { width: '100%' }]}>
          <DetailRow label="Placa"  value={doneInfo.placa} />
          {doneInfo.descripcion && (
            <DetailRow label="Descripción" value={doneInfo.descripcion} />
          )}
          {doneInfo.responsable && (
            <DetailRow label="Responsable" value={doneInfo.responsable} />
          )}
          <DetailRow label="Estado"    value={doneInfo.estado} />
          <DetailRow label="Fecha/hora" value={doneInfo.fecha} />
        </View>

        <View style={s.doneButtons}>
          <Pressable style={[s.btn, s.btnOutline, { flex: 1 }]} onPress={reset}>
            <Text style={[s.btnText, s.btnTextOutline]}>Salir</Text>
          </Pressable>
          <View style={{ width: 12 }} />
          <Pressable style={[s.btn, { flex: 1 }]} onPress={reset}>
            <Text style={s.btnText}>Otra vez</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return null;
}

// ─── Sub componentes compartidos ───

function EstadoSelector({
  value,
  onChange,
  options,
}: {
  value: Estado | null;
  onChange: (v: Estado) => void;
  options: EstadoOption[];
}) {
  return (
    <View style={s.segmented}>
      {options.map((opt) => (
        <Pressable
          key={opt.valor}
          style={[s.seg, value === opt.valor && s.segActive]}
          onPress={() => onChange(opt.valor)}
        >
          <Text style={[s.segText, value === opt.valor && s.segTextActive]}>
            {opt.valor} — {opt.etiqueta}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function ResponsableSelector({
  value,
  onChange,
  options,
}: {
  value: Responsable | null;
  onChange: (v: Responsable) => void;
  options: string[];
}) {
  return (
    <View style={s.segmented}>
      {options.map((opt) => (
        <Pressable
          key={opt}
          style={[s.seg, value === opt && s.segActive]}
          onPress={() => onChange(opt)}
        >
          <Text style={[s.segText, value === opt && s.segTextActive]}>{opt}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue}>{value || '—'}</Text>
    </View>
  );
}

// ─── Styles ───────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },

  camera: { flex: 1 },
  panel: {
    padding: 24,
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  hint: { color: '#666', fontSize: 15 },

  form:       { padding: 20, paddingBottom: 40 },
  formHeader: {
    backgroundColor: BLUE,
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  formHeaderOtro:  { backgroundColor: ORANGE },
  formHeaderBadge: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '700',
                     textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  formHeaderCode:  { color: '#fff', fontSize: 30, fontWeight: 'bold', letterSpacing: 2 },

  card: {
    backgroundColor: '#F5F8FF',
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E8F5',
  },
  detailLabel: { color: '#555', fontSize: 14 },
  detailValue: { color: '#111', fontSize: 14, fontWeight: '600',
                 flexShrink: 1, textAlign: 'right', marginLeft: 8 },

  fieldLabel: { fontSize: 14, color: '#333', fontWeight: '600', marginBottom: 8 },

  segmented: { flexDirection: 'row', marginBottom: 20, gap: 10 },
  seg: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#C5D5EA',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  segActive:     { backgroundColor: BLUE, borderColor: BLUE },
  segText:       { fontSize: 13, color: '#444', fontWeight: '600', textAlign: 'center' },
  segTextActive: { color: '#fff' },

  input: {
    borderWidth: 1,
    borderColor: '#C5D5EA',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    backgroundColor: '#fff',
    marginBottom: 20,
    color: '#111',
  },
  inputReadonly: { backgroundColor: '#F0F4FA', color: '#555' },

  btn: {
    backgroundColor: BLUE,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  btnDisabled:    { backgroundColor: '#B0C4DE' },
  btnOutline:     { backgroundColor: '#fff', borderWidth: 2, borderColor: BLUE },
  btnText:        { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnTextOutline: { color: BLUE },

  cancelBtn:  { alignItems: 'center', paddingVertical: 8 },
  cancelText: { color: '#888', fontSize: 14, textDecorationLine: 'underline' },

  doneContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1A7F37',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  checkMark:   { color: '#fff', fontSize: 36, fontWeight: 'bold', lineHeight: 40 },
  doneTitle:   { fontSize: 24, fontWeight: 'bold', color: '#111', marginBottom: 20 },
  doneButtons: { flexDirection: 'row', width: '100%', marginTop: 8 },

  message: { textAlign: 'center', color: '#444', fontSize: 15, marginBottom: 20 },

  // Entrada manual
  manualEntryBtn: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: BLUE,
  },
  manualEntryBtnText: { color: BLUE, fontSize: 14, fontWeight: '700', textAlign: 'center' },

  manualWarningBanner: {
    backgroundColor: '#FFF4E5',
    borderWidth: 1,
    borderColor: ORANGE,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  manualWarningText: { color: '#8A5300', fontSize: 13, lineHeight: 18 },
  cardManualHighlight: { borderWidth: 2, borderColor: ORANGE },

  warningTitle: { fontSize: 22, fontWeight: 'bold', color: '#111', marginBottom: 16, textAlign: 'center' },
});
