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
  | 'looking_up'
  | 'confirming_localizado'
  | 'form_otro_bien'
  | 'sending'
  | 'done';

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
  const [asset, setAsset]         = useState<AssetInfo | null>(null);

  // Campo compartido usado por ambos formularios
  const [estado, setEstado]       = useState<Estado | null>(null);

  // Campo para formulario "Otro bien"
  const [descripcion, setDescripcion] = useState('');
  const [responsable, setResponsable] = useState<Responsable | null>(null);

  const [doneInfo, setDoneInfo]   = useState<DoneInfo | null>(null);

  const reset = useCallback(() => {
    setAppState('scanning');
    setScannedCode('');
    setAsset(null);
    setEstado(null);
    setDescripcion('');
    setResponsable(null);
    setDoneInfo(null);
  }, []);

  // ─── Scan handler ──────

  const handleBarcodeScanned = useCallback(async (result: BarcodeScanningResult) => {
    const code = result.data;
    setScannedCode(code);
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
        // Not found is a normal path — open the "Otro bien" form.
        // No encontrado es una "opcion" normal/esperada, se abre el formulario de "Otro bien"
        setAsset(null);
        setAppState('form_otro_bien');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert(
        'Error de conexión',
        `No se pudo consultar el inventario.\n\nDetalle: ${msg}`,
        [{ text: 'Volver a escanear', onPress: reset }],
      );
    }
  }, [reset]);

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
            <Text style={s.hint}>Apunte la cámara hacia un código de barras</Text>
          )}
        </View>
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

        <View style={s.card}>
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
});
