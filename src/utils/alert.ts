import { Alert, AlertButton, Platform } from 'react-native';

// Drop-in replacement for Alert.alert. React Native Web's Alert.alert is a
// no-op, so on web the request is forwarded to <WebAlertHost /> (mounted in
// App.tsx), which renders it as an in-app dialog.

export type WebAlertRequest = {
  title: string;
  message?: string;
  buttons: AlertButton[];
};

type Listener = (request: WebAlertRequest) => void;

let webListener: Listener | null = null;

export function registerWebAlertListener(listener: Listener | null) {
  webListener = listener;
}

export function showAlert(title: string, message?: string, buttons?: AlertButton[]) {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }

  const resolvedButtons = buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }];

  if (webListener) {
    webListener({ title, message, buttons: resolvedButtons });
    return;
  }

  // Host not mounted yet — fall back to native browser dialogs.
  const text = message ? `${title}\n\n${message}` : title;
  const actionable = resolvedButtons.filter((b) => b.style !== 'cancel');
  if (resolvedButtons.length === 1) {
    window.alert(text);
    resolvedButtons[0].onPress?.();
    return;
  }
  if (window.confirm(text)) {
    actionable[0]?.onPress?.();
  } else {
    resolvedButtons.find((b) => b.style === 'cancel')?.onPress?.();
  }
}
