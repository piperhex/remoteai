import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Modal } from '../components/Modal';
import { useTotpStyles as useStyles } from './styles';

interface TotpQrScannerProps {
  onClose: () => void;
  onScan: (value: string) => void;
  visible: boolean;
}

export function TotpQrScanner({ onClose, onScan, visible }: TotpQrScannerProps) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setScanned(false);
  }, [visible]);

  const scan = (value: string) => {
    if (scanned) return;
    setScanned(true);
    onScan(value);
  };

  return <Modal visible={visible} animationType="fade" onRequestClose={onClose}
    statusBarStyle={permission?.granted ? 'light' : undefined}
    supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}>
    {!permission ? <View style={styles.permissionBox}><ActivityIndicator color={color("#18af8c", 'accent')} /></View>
      : !permission.granted ? <View style={styles.permissionBox}>
        <Text style={styles.permissionTitle}>{t("client.mobile.cameraAccessRequired")}</Text>
        <Text style={styles.permissionText}>{t("client.mobile.allowCameraAccessToScanA2faQrCode")}</Text>
        {permission.canAskAgain ? <Pressable style={styles.qrButton} onPress={() => void requestPermission()}>
          <Text style={styles.qrButtonText}>{t("client.mobile.allowCameraAccess")}</Text>
        </Pressable> : null}
        <Pressable style={styles.cameraClose} onPress={onClose}>
          <Text style={styles.cameraCloseText}>{t("client.mobile.back")}</Text>
        </Pressable>
      </View> : <View style={styles.cameraRoot}>
        <CameraView style={styles.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(result) => scan(result.data)} />
        <View pointerEvents="box-none" style={styles.cameraOverlay}>
          <Text style={styles.cameraTitle}>{t("client.mobile.scan2faQrCode")}</Text>
          <View style={styles.scanFrame} />
          <View>
            <Text style={styles.cameraHint}>{t("client.mobile.fitTheEntireQrCodeInTheFrameToFill")}</Text>
            <Pressable style={styles.cameraClose} onPress={onClose}>
              <Text style={styles.cameraCloseText}>{t("client.mobile.cancelScan")}</Text>
            </Pressable>
          </View>
        </View>
      </View>}
  </Modal>;
}
