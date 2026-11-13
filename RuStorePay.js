// RuStore Pay — минимальная JS-обёртка над нативным модулем RuStoreReactPaySDKModule.
// Безопасна: если модуль отсутствует (Expo Go / сборка без SDK), все методы возвращают
// пустые значения или бросают понятную ошибку, не роняя приложение.

import { NativeModules } from 'react-native';

const NativeModule = NativeModules.RuStoreReactPaySDKModule || null;

// Идентификатор разового товара «Pro» — должен совпадать с товаром в RuStore Console.
export const PRO_PRODUCT_ID = 'voicetask_pro_unlock';

// Статусы, при которых нерасходуемая покупка считается купленной.
const OWNED_STATUSES = ['CONFIRMED', 'PAID', 'ACTIVE'];

export function isAvailable() {
  return !!NativeModule;
}

export async function getProducts(ids) {
  if (!NativeModule) return [];
  try {
    return (await NativeModule.getProducts(ids)) || [];
  } catch (_) {
    return [];
  }
}

// Возвращает список productId, которыми пользователь уже владеет.
export async function getOwnedProductIds() {
  if (!NativeModule) return [];
  try {
    const purchases = (await NativeModule.getPurchases(null, null, null)) || [];
    const owned = [];
    purchases.forEach((p) => {
      const item = p && (p.productPurchase || p.subscriptionPurchase);
      if (item && item.productId && OWNED_STATUSES.indexOf(item.status) !== -1) {
        owned.push(item.productId);
      }
    });
    return owned;
  } catch (_) {
    return [];
  }
}

// Покупка разового товара (одностадийная). Резолвится при успехе,
// при отмене/ошибке бросает объект { code, message }.
export async function purchase(productId) {
  if (!NativeModule) {
    throw new Error('RuStore Pay недоступен');
  }
  // purchase(productId, orderId, quantity, developerPayload, appUserId, appUserEmail,
  //          preferredPurchaseType, sdkTheme, purchaseEventListenerIds)
  return NativeModule.purchase(productId, null, null, null, null, null, null, null, null);
}

export async function isRuStoreInstalled() {
  if (!NativeModule) return false;
  try {
    return !!(await NativeModule.isRuStoreInstalled());
  } catch (_) {
    return false;
  }
}

export async function openRuStoreDownloadInstruction() {
  if (!NativeModule) return;
  try {
    await NativeModule.openRuStoreDownloadInstruction();
  } catch (_) {}
}
