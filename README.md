# Голосовые заметки (VoiceTask)

Expo / React Native, Android, RuStore.

## Версия 1.2.3

- Задачи текстом и голосом (нужен Google Speech)
- Парсер дат: завтра, послезавтра, в четверг…
- Календарь с метками
- OTA: channel `preview`, runtime = app version

## Установка

```bash
npm install
npm install expo-speech-recognition@3.1.3 --save-exact
npx expo config --type public
```

## Сборка

```bash
set EAS_NO_VCS=1
eas build -p android --profile preview
```

## OTA (после установки APK 1.2.3)

В app.json version должна остаться 1.2.3.

```bash
set EAS_NO_VCS=1
eas update --channel preview --message "описание"
```
