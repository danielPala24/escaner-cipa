import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppConfig, getConfig } from '../services/inventory';
import { BLUE } from '../theme';

const ConfigContext = createContext<AppConfig | null>(null);

// Lanza si se usa fuera de <ConfigProvider> — todo lo que necesita config
// (estados, responsables, qué pide cada formulario) debe pasar por aquí,
// nunca por valores fijos en el componente.
export function useConfig(): AppConfig {
  const config = useContext(ConfigContext);
  if (!config) {
    throw new Error('useConfig debe usarse dentro de <ConfigProvider>');
  }
  return config;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; config: AppConfig };

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const result = await getConfig();
      if (!result.ok) {
        setState({
          status: 'error',
          message: `No se pudo cargar la configuración (${result.reason}).`,
        });
        return;
      }
      setState({
        status: 'ready',
        config: {
          configVersion:    result.configVersion,
          nombreInventario: result.nombreInventario,
          estados:          result.estados,
          responsables:     result.responsables,
          formularios:      result.formularios,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setState({ status: 'error', message: msg });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (state.status === 'loading') {
    return (
      <View style={s.center}>
        <ActivityIndicator color={BLUE} size="large" />
        <Text style={s.hint}>Cargando configuración…</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>{state.message}</Text>
        <Pressable style={s.btn} onPress={load}>
          <Text style={s.btnText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ConfigContext.Provider value={state.config}>
      {children}
    </ConfigContext.Provider>
  );
}

const s = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  hint: { marginTop: 12, color: '#666', fontSize: 15 },
  errorText: { textAlign: 'center', color: '#B00020', fontSize: 15, marginBottom: 20 },
  btn: { backgroundColor: BLUE, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 8 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
