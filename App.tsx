import { StatusBar } from 'expo-status-bar';
import ScannerScreen from './src/screens/ScannerScreen';
import { ConfigProvider } from './src/context/ConfigContext';

export default function App() {
  return (
    <ConfigProvider>
      <ScannerScreen />
      <StatusBar style="light" />
    </ConfigProvider>
  );
}
