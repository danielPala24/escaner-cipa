import { StatusBar } from 'expo-status-bar';
import ScannerScreen from './src/screens/ScannerScreen';

export default function App() {
  return (
    <>
      <ScannerScreen />
      <StatusBar style="light" />
    </>
  );
}
