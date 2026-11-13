import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StatusBar,
  Alert,
  ActivityIndicator,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import * as RuStorePay from './RuStorePay';
import * as Notifications from 'expo-notifications';

// Нативные голосовые модули подключаем ТОЛЬКО при нажатии на микрофон
let VoskCtor = null;
let voskLoadAttempted = false;

function getVosk() {
  if (voskLoadAttempted) return VoskCtor;
  voskLoadAttempted = true;
  try {
    VoskCtor = require('react-native-vosk').default;
  } catch (_) {
    VoskCtor = null;
  }
  return VoskCtor;
}

function getSpeechModule() {
  try {
    const speech = require('expo-speech-recognition');
    return speech.ExpoSpeechRecognitionModule || null;
  } catch (_) {
    return null;
  }
}

const VOSK_MODEL = 'model-ru';

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch (_) {}

const REMINDER_EVENING_HOUR = 20;
const REMINDER_MORNING_HOUR = 9;

async function ensureNotificationPermissions() {
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (cur.status === 'granted') return true;
    const req = await Notifications.requestPermissionsAsync();
    return req.status === 'granted';
  } catch (_) {
    return false;
  }
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('tasks', {
      name: 'Напоминания о задачах',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'default',
    });
  } catch (_) {}
}

function parseTaskDay(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr).trim().slice(0, 10))) return null;
  const d = String(dateStr).trim().slice(0, 10);
  const day = new Date(d + 'T12:00:00');
  if (Number.isNaN(day.getTime())) return null;
  return day;
}

function atHourOnDay(baseDay, hour, minute) {
  const x = new Date(baseDay);
  x.setHours(hour, minute || 0, 0, 0);
  return x;
}

async function scheduleOneNotification(title, body, when, taskId) {
  if (!when || when.getTime() <= Date.now() + 10000) return null;
  try {
    return await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { taskId: taskId || null }, sound: true },
      trigger: { type: 'date', date: when, channelId: 'tasks' },
    });
  } catch (_) {
    try {
      return await Notifications.scheduleNotificationAsync({
        content: { title, body, data: { taskId: taskId || null } },
        trigger: when,
      });
    } catch (_) {
      return null;
    }
  }
}

async function scheduleTaskReminder(task) {
  try {
    if (!task || task.completed || !task.date) return [];
    const day = parseTaskDay(task.date);
    if (!day) return [];
    await ensureAndroidChannel();
    const ok = await ensureNotificationPermissions();
    if (!ok) return [];

    const oldIds = [].concat(task.notificationIds || [], task.notificationId ? [task.notificationId] : []);
    for (const nid of oldIds) {
      try { if (nid) await Notifications.cancelScheduledNotificationAsync(nid); } catch (_) {}
    }

    const title = task.title || 'Задача';
    const ids = [];

    const evening = atHourOnDay(day, REMINDER_EVENING_HOUR, 0);
    evening.setDate(evening.getDate() - 1);
    const idEve = await scheduleOneNotification('Завтра есть дело', 'Завтра: ' + title, evening, task.id);
    if (idEve) ids.push(idEve);

    const morning = atHourOnDay(day, REMINDER_MORNING_HOUR, 0);
    const idMorn = await scheduleOneNotification('Напоминание на сегодня', 'Сегодня: ' + title, morning, task.id);
    if (idMorn) ids.push(idMorn);

    if (task.time && /^\d{1,2}:\d{2}$/.test(String(task.time).trim())) {
      const parts = String(task.time).trim().split(':');
      const hh = parseInt(parts[0], 10);
      const mm = parseInt(parts[1], 10);
      if (!(hh === REMINDER_MORNING_HOUR && mm === 0)) {
        const exact = atHourOnDay(day, hh, mm);
        const idT = await scheduleOneNotification('Пора', title, exact, task.id);
        if (idT) ids.push(idT);
      }
    }
    return ids;
  } catch (_) {
    return [];
  }
}

async function cancelTaskReminder(taskOrIds) {
  try {
    let ids = [];
    if (Array.isArray(taskOrIds)) ids = taskOrIds;
    else if (taskOrIds && typeof taskOrIds === 'object') {
      ids = [].concat(taskOrIds.notificationIds || [], taskOrIds.notificationId ? [taskOrIds.notificationId] : []);
    } else if (typeof taskOrIds === 'string') ids = [taskOrIds];
    
    for (const nid of ids) {
      try { if (nid) await Notifications.cancelScheduledNotificationAsync(nid); } catch (_) {}
    }
  } catch (_) {}
}

const COLORS = {
  primary: '#4F46E5',
  primaryLight: '#818CF8',
  secondary: '#10B981',
  danger: '#EF4444',
  warning: '#F59E0B',
  background: '#F8FAFC',
  surface: '#FFFFFF',
  text: '#1E293B',
  textSecondary: '#64748B',
  border: '#E2E8F0',
  today: '#EEF2FF',
  chip: { low: '#DCFCE7', medium: '#FEF3C7', high: '#FEE2E2' },
  priority: { low: '#22C55E', medium: '#F59E0B', high: '#EF4444' },
};

const STORAGE_KEY = '@voicetask_tasks_v1';
const EXAMPLES_KEY = '@voicetask_examples_dismissed_v1';
const PRO_KEY = '@voicetask_pro_v1';
const PROMO_CODE = 'DRUZIA2026';
const YOOKASSA_PAY_URL = 'https://yookassa.ru/my/i/REPLACE_WITH_YOUR_PAYMENT_LINK';
const PAID_PRO_CODE = 'PRO99';
const ONBOARDING_KEY = '@voicetask_onboarding_v1';
const APP_VERSION = '1.5.7';

const ONBOARDING_STEPS = [
  { icon: '🎙️', title: 'Задачи голосом', text: 'Нажмите на микрофон и продиктуйте задачу — текст появится сам.' },
  { icon: '📅', title: 'Умные даты', text: '«Завтра», «в пятницу», «пятое ноября» — задача сама встанет в календарь.' },
  { icon: '✅', title: 'Планируйте и отмечайте', text: 'Смотрите задачи по дням, отмечайте выполненные, ставьте приоритеты.' },
];

const DEFAULT_EXAMPLES = [
  'Купить молоко завтра в 10', 'Срочно позвонить клиенту в четверг',
  'Тренировка в пятницу в 18:00', 'Через 2 дня сдать отчёт',
  'Встреча послезавтра в 14:30', 'В понедельник подготовить презентацию',
  'Позвонить в среду', 'В субботу в магазин',
];

const FREE_LIMITS = { maxActiveTasks: 3, voiceUses: 3 };
const VOICE_USES_KEY = '@voicetask_voice_uses_v1';
const TOP_INSET = Platform.OS === 'android' ? 36 : 50;
const WEEK_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function normalizeRu(text) {
  return String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/[''`]/g, '').replace(/[.,;:!?…]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasWord(text, word) {
  const t = normalizeRu(text);
  const w = normalizeRu(word);
  if (!w) return false;
  const re = new RegExp('(?:^|[^а-яa-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[^а-яa-z0-9]|$)', 'i');
  return re.test(t);
}

function removeWord(text, word) {
  const w = normalizeRu(word);
  const re = new RegExp('(?:^|[^а-яa-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[^а-яa-z0-9]|$)', 'gi');
  return normalizeRu(text).replace(re, ' ').replace(/\s+/g, ' ').trim();
}

const WEEKDAYS = {
  воскресенье: 0, вс: 0, понедельник: 1, пн: 1, вторник: 2, вт: 2,
  среда: 3, среду: 3, среды: 3, ср: 3, четверг: 4, чт: 4,
  пятница: 5, пятницу: 5, пятницы: 5, пт: 5, суббота: 6, субботу: 6, субботы: 6, сб: 6,
};

const DAY_ORDINALS = {
  первое: 1, первого: 1, второе: 2, второго: 2, третье: 3, третьего: 3,
  четвертое: 4, четвертого: 4, пятое: 5, пятого: 5, шестое: 6, шестого: 6,
  седьмое: 7, седьмого: 7, восьмое: 8, восьмого: 8, девятое: 9, девятого: 9,
  десятое: 10, десятого: 10, одиннадцатое: 11, одиннадцатого: 11, двенадцатое: 12, двенадцатого: 12,
  тринадцатое: 13, тринадцатого: 13, четырнадцатое: 14, четырнадцатого: 14, пятнадцатое: 15, пятнадцатого: 15,
  шестнадцатое: 16, шестнадцатого: 16, семнадцатое: 17, семнадцатого: 17, восемнадцатое: 18, восемнадцатого: 18,
  девятнадцатое: 19, девятнадцатого: 19, двадцатое: 20, двадцатого: 20,
  'двадцать первое': 21, 'двадцать первого': 21, 'двадцать второе': 22, 'двадцать второго': 22,
  'двадцать третье': 23, 'двадцать третьего': 23, 'двадцать четвертое': 24, 'двадцать четвертого': 24,
  'двадцать пятое': 25, 'двадцать пятого': 25, 'двадцать шестое': 26, 'двадцать седьмое': 27,
  'двадцать восьмое': 28, 'двадцать девятое': 29, тридцатое: 30, тридцатого: 30,
  'тридцать первое': 31, 'тридцать первого': 31,
};

const MONTHS = {
  января: 0, январь: 0, февраля: 1, февраль: 1, марта: 2, март: 2,
  апреля: 3, апрель: 3, мая: 4, май: 4, июня: 5, июнь: 5,
  июля: 6, июль: 6, августа: 7, август: 7, сентября: 8, сентябрь: 8,
  октября: 9, октябрь: 9, ноября: 10, ноябрь: 10, декабря: 11, декабрь: 11,
};

const PRIORITY_KW = {
  high: ['срочно', 'важно', 'критично', 'немедленно'],
  low: ['неважно', 'когда-нибудь', 'низкий', 'можно позже'],
};

const CATEGORY_KW = {
  работа: ['работа', 'офис', 'проект', 'встреча', 'созвон', 'дедлайн'],
  личное: ['личное', 'дом', 'семья', 'друзья'],
  покупки: ['купить', 'покупки', 'магазин', 'заказать'],
  здоровье: ['врач', 'спорт', 'тренировка', 'лекарство'],
  учёба: ['учёба', 'учеба', 'экзамен', 'лекция', 'урок'],
};

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function nextWeekday(from, dayNum) {
  const d = new Date(from);
  let diff = dayNum - d.getDay();
  if (diff <= 0) diff += 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function parseTask(text) {
  if (!text || typeof text !== 'string') {
    return { title: '', date: null, time: null, priority: 'medium', category: null, raw: text || '' };
  }
  const original = text.trim();
  let remaining = normalizeRu(original);
  let priority = 'medium';
  let category = null;
  let date = null;
  let time = null;
  const now = new Date();

  for (const [level, kws] of Object.entries(PRIORITY_KW)) {
    for (const kw of kws) {
      if (hasWord(remaining, kw)) {
        priority = level;
        remaining = removeWord(remaining, kw);
        break;
      }
    }
  }

  for (const [cat, kws] of Object.entries(CATEGORY_KW)) {
    for (const kw of kws) {
      if (hasWord(remaining, kw)) { category = cat; break; }
    }
    if (category) break;
  }

  if (hasWord(remaining, 'послезавтра')) {
    const d = new Date(now); d.setDate(d.getDate() + 2);
    date = formatDate(d); remaining = removeWord(remaining, 'послезавтра');
  } else if (hasWord(remaining, 'сегодня')) {
    date = formatDate(now); remaining = removeWord(remaining, 'сегодня');
  } else if (hasWord(remaining, 'завтра')) {
    const d = new Date(now); d.setDate(d.getDate() + 1);
    date = formatDate(d); remaining = removeWord(remaining, 'завтра');
  }

  if (!date && /через\s+неделю/.test(remaining)) {
    const d = new Date(now); d.setDate(d.getDate() + 7);
    date = formatDate(d); remaining = remaining.replace(/через\s+неделю/g, ' ').replace(/\s+/g, ' ').trim();
  }

  if (!date) {
    const throughDays = remaining.match(/через\s+(\d+)\s*(?:дн(?:я|ей)?|день)/);
    if (throughDays) {
      const d = new Date(now); d.setDate(d.getDate() + parseInt(throughDays[1], 10));
      date = formatDate(d); remaining = remaining.replace(throughDays[0], ' ').replace(/\s+/g, ' ').trim();
    }
  }

  if (!date) {
    const throughHours = remaining.match(/через\s+(\d+)\s*(?:час(?:а|ов)?)/);
    if (throughHours) {
      const d = new Date(now); d.setHours(d.getHours() + parseInt(throughHours[1], 10));
      date = formatDate(d); time = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      remaining = remaining.replace(throughHours[0], ' ').replace(/\s+/g, ' ').trim();
    }
  }

  if (!date) {
    const names = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length);
    for (const name of names) {
      const rePref = new RegExp('(?:^|[^а-яa-z0-9])(?:в|на|во)\s+' + name + '(?=[^а-яa-z0-9]|$)', 'i');
      const reBare = new RegExp('(?:^|[^а-яa-z0-9])' + name + '(?=[^а-яa-z0-9]|$)', 'i');
      if (rePref.test(remaining) || reBare.test(remaining)) {
        date = formatDate(nextWeekday(now, WEEKDAYS[name]));
        remaining = remaining.replace(rePref, ' ').replace(reBare, ' ').replace(/\s+/g, ' ').trim();
        break;
      }
    }
  }

  if (!date) {
    const monthNames = 'января|январь|февраля|февраль|марта|март|апреля|апрель|мая|май|июня|июнь|июля|июль|августа|август|сентября|сентябрь|октября|октябрь|ноября|ноябрь|декабря|декабрь';
    let ordMatch = remaining.match(new RegExp('(двадцать|тридцать)\s+(первое|первого|второе|второго|третье|третьего|четвертое|четвертого|пятое|пятого|шестое|шестого|седьмое|седьмого|восьмое|восьмого|девятое|девятого)\s+(' + monthNames + ')'));
    if (ordMatch) {
      const tens = ordMatch[1] === 'тридцать' ? 30 : 20;
      const onesMap = { первое: 1, первого: 1, второе: 2, второго: 2, третье: 3, третьего: 3, четвертое: 4, четвертого: 4, пятое: 5, пятого: 5, шестое: 6, шестого: 6, седьмое: 7, седьмого: 7, восьмое: 8, восьмого: 8, девятое: 9, девятого: 9 };
      const day = tens + (onesMap[ordMatch[2]] || 0);
      const month = MONTHS[ordMatch[3]];
      if (day >= 1 && day <= 31 && month != null) {
        const d = new Date(now.getFullYear(), month, day);
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (d < todayStart) d.setFullYear(d.getFullYear() + 1);
        date = formatDate(d); remaining = remaining.replace(ordMatch[0], ' ').replace(/\s+/g, ' ').trim();
      }
    }
  }

  if (!date) {
    const monthNames = 'января|январь|февраля|февраль|марта|март|апреля|апрель|мая|май|июня|июнь|июля|июль|августа|август|сентября|сентябрь|октября|октябрь|ноября|ноябрь|декабря|декабрь';
    const simpleOrd = remaining.match(new RegExp('(первое|первого|второе|второго|третье|третьего|четвертое|четвертого|пятое|пятого|шестое|шестого|седьмое|седьмого|восьмое|восьмого|девятое|девятого|десятое|десятого|одиннадцатое|одиннадцатого|двенадцатое|двенадцатого|тринадцатое|тринадцатого|четырнадцатое|четырнадцатого|пятнадцатое|пятнадцатого|шестнадцатое|шестнадцатого|семнадцатое|семнадцатого|восемнадцатое|восемнадцатого|девятнадцатое|девятнадцатого|двадцатое|двадцатого|тридцатое|тридцатого)\s+(' + monthNames + ')'));
    if (simpleOrd) {
      const day = DAY_ORDINALS[simpleOrd[1]];
      const month = MONTHS[simpleOrd[2]];
      if (day && month != null) {
        const d = new Date(now.getFullYear(), month, day);
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (d < todayStart) d.setFullYear(d.getFullYear() + 1);
        date = formatDate(d); remaining = remaining.replace(simpleOrd[0], ' ').replace(/\s+/g, ' ').trim();
      }
    }
  }

  if (!date) {
    const dateMatch = remaining.match(/(\d{1,2})\s+(января|январь|февраля|февраль|марта|март|апреля|апрель|мая|май|июня|июнь|июля|июль|августа|август|сентября|сентябрь|октября|октябрь|ноября|ноябрь|декабря|декабрь)/);
    if (dateMatch) {
      const day = parseInt(dateMatch[1], 10);
      const month = MONTHS[dateMatch[2]];
      const d = new Date(now.getFullYear(), month, day);
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (d < todayStart) d.setFullYear(d.getFullYear() + 1);
      date = formatDate(d); remaining = remaining.replace(dateMatch[0], ' ').replace(/\s+/g, ' ').trim();
    }
  }

  if (!date) {
    const dateMatch2 = remaining.match(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/);
    if (dateMatch2) {
      const day = parseInt(dateMatch2[1], 10);
      const month = parseInt(dateMatch2[2], 10) - 1;
      let year = dateMatch2[3] ? parseInt(dateMatch2[3], 10) : now.getFullYear();
      if (year < 100) year += 2000;
      if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
        date = formatDate(new Date(year, month, day));
        remaining = remaining.replace(dateMatch2[0], ' ').replace(/\s+/g, ' ').trim();
      }
    }
  }

  let timeMatch = remaining.match(/(?:^|\s)(?:в\s+)?(\d{1,2}):(\d{2})(?=\s|$)/);
  if (timeMatch) {
    const h = parseInt(timeMatch[1], 10);
    const m = parseInt(timeMatch[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      time = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      remaining = remaining.replace(timeMatch[0], ' ').replace(/\s+/g, ' ').trim();
    }
  }

  if (!time) {
    timeMatch = remaining.match(/(?:^|[^а-яa-z0-9])в\s+(\d{1,2})(?:\s*(?:час(?:а|ов)?|утра|дня|вечера))?(?=[^а-яa-z0-9]|$)/);
    if (timeMatch) {
      let h = parseInt(timeMatch[1], 10);
      const frag = timeMatch[0];
      if (/вечера/.test(frag) && h < 12) h += 12;
      if (h >= 0 && h <= 23) {
        time = String(h).padStart(2, '0') + ':00';
        remaining = remaining.replace(timeMatch[0], ' ').replace(/\s+/g, ' ').trim();
      }
    }
  }

  let title = remaining.replace(/\s+/g, ' ').replace(/^[\s,.]+|[\s,.]+$/g, '').trim();
  if (!title) title = 'Новая задача';
  else title = title.charAt(0).toUpperCase() + title.slice(1);
  return { title, date, time, priority, category, raw: original };
}

function formatDisplayDate(isoDate, time) {
  if (!isoDate) return 'Без даты';
  const d = new Date(isoDate + 'T12:00:00');
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  let label = '';
  if (formatDate(d) === formatDate(today)) label = 'Сегодня';
  else if (formatDate(d) === formatDate(tomorrow)) label = 'Завтра';
  else label = d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
  if (time) label += ', ' + time;
  return label;
}

async function loadTasks() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) { return []; }
}

async function saveTasks(tasks) {
  try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); } catch (e) { console.error(e); }
}

function MonthCalendar({ year, month, tasksByDate, selectedDate, onSelectDate, onPrev, onNext }) {
  const firstDay = new Date(year, month, 1);
  let startWeekday = firstDay.getDay() - 1;
  if (startWeekday < 0) startWeekday = 6;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = formatDate(new Date());
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <View style={cal.wrap}>
      <View style={cal.header}>
        <TouchableOpacity onPress={onPrev} style={cal.navBtn}><Text style={cal.navText}>‹</Text></TouchableOpacity>
        <Text style={cal.monthTitle}>{MONTH_NAMES[month]} {year}</Text>
        <TouchableOpacity onPress={onNext} style={cal.navBtn}><Text style={cal.navText}>›</Text></TouchableOpacity>
      </View>
      <View style={cal.weekRow}>
        {WEEK_LABELS.map((d) => (
          <View key={d} style={cal.weekCell}><Text style={cal.weekText}>{d}</Text></View>
        ))}
      </View>
      <View style={cal.grid}>
        {cells.map((day, idx) => {
          if (day === null) return <View key={'e' + idx} style={cal.cell} />;
          const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDate;
          const dayList = tasksByDate[dateStr] || [];
          const count = dayList.length;
          
          return (
            <TouchableOpacity
              key={dateStr}
              style={[cal.cell, isToday && !isSelected && cal.cellToday, isSelected && cal.cellSelected]}
              onPress={() => onSelectDate(dateStr)}
              activeOpacity={0.6}
            >
              <Text style={[cal.dayNum, isToday && !isSelected && cal.dayNumToday, isSelected && cal.dayNumSelected]}>{day}</Text>
              {count > 0 ? (
                <View style={cal.dotsRow}>
                  {dayList.slice(0, 3).map((t, i) => (
                    <View key={i} style={[cal.dotMark, { backgroundColor: isSelected ? '#fff' : (COLORS.priority[t.priority] || COLORS.priority.medium) }]} />
                  ))}
                </View>
              ) : <View style={cal.dotsRow} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const cal = StyleSheet.create({
  wrap: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 12, marginBottom: 16, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  navBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' },
  navText: { fontSize: 28, color: COLORS.primary, fontWeight: '600', lineHeight: 30 },
  monthTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  weekRow: { flexDirection: 'row', marginBottom: 6 },
  weekCell: { width: '14.28%', alignItems: 'center' },
  weekText: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12, paddingVertical: 4 },
  cellToday: { backgroundColor: COLORS.today },
  cellSelected: { backgroundColor: COLORS.primary },
  dayNum: { fontSize: 15, fontWeight: '500', color: COLORS.text },
  dayNumToday: { color: COLORS.primary, fontWeight: '700' },
  dayNumSelected: { color: '#fff', fontWeight: '700' },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', height: 10, marginTop: 2, gap: 3 },
  dotMark: { width: 7, height: 7, borderRadius: 4 },
});

function TaskCard({ task, onToggle, onDelete }) {
  return (
    <TouchableOpacity
      style={[s.card, task.completed && s.cardCompleted]}
      onLongPress={() => {
        Alert.alert('Удалить?', task.title, [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Удалить', style: 'destructive', onPress: () => onDelete(task.id) },
        ]);
      }}
      activeOpacity={0.7}
    >
      <TouchableOpacity style={[s.checkbox, task.completed && s.checkboxChecked]} onPress={() => onToggle(task.id)}>
        {task.completed ? <Text style={s.checkmark}>✓</Text> : null}
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={[s.taskTitle, task.completed && s.taskTitleDone]} numberOfLines={2}>{task.title}</Text>
        <View style={s.meta}>
          {task.date || task.time ? <Text style={s.dateText}>{formatDisplayDate(task.date, task.time)}</Text> : null}
          {task.category ? <View style={s.catChip}><Text style={s.catText}>{task.category}</Text></View> : null}
        </View>
      </View>
      <View style={[s.priorityDot, { backgroundColor: COLORS.priority[task.priority] || COLORS.priority.medium }]} />
    </TouchableOpacity>
  );
}

function PriorityChips({ value, onChange }) {
  const opts = [
    { value: 'low', label: 'Низкий', color: COLORS.priority.low },
    { value: 'medium', label: 'Средний', color: COLORS.priority.medium },
    { value: 'high', label: 'Высокий', color: COLORS.priority.high },
  ];
  return (
    <View style={s.chipsRow}>
      {opts.map((o) => (
        <TouchableOpacity
          key={o.value}
          style={[s.chip, value === o.value && { backgroundColor: o.color + '25', borderColor: o.color }]}
          onPress={() => onChange(o.value)}
        >
          <View style={[s.dotSmall, { backgroundColor: o.color }]} />
          <Text style={[s.chipLabel, value === o.value && { color: o.color, fontWeight: '600' }]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function VersionBlock({ otaInfo, onCheckUpdate }) {
  return (
    <View style={s.versionBlock}>
      <Text style={s.versionText}>Версия {APP_VERSION}</Text>
      <TouchableOpacity onPress={onCheckUpdate} hitSlop={{ top: 10, bottom: 10, left: 16, right: 16 }}>
        <Text style={s.otaBtn}>Проверить обновления</Text>
      </TouchableOpacity>
    </View>
  );
}

function HomeScreen({ tasks, onToggle, onDelete, onAdd, otaInfo, onCheckUpdate, isPro, onOpenPro, onOpenTips }) {
  const [tab, setTab] = useState('active');
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState(formatDate(now));
  
  const active = useMemo(() => tasks.filter((t) => !t.completed), [tasks]);
  const done = useMemo(() => tasks.filter((t) => t.completed), [tasks]);
  const listData = tab === 'done' ? done : active;
  
  const tasksByDate = useMemo(() => {
    const map = {};
    active.forEach((t) => {
      let key = t.date;
      if (!key || typeof key !== 'string') return;
      key = key.trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
      if (!map[key]) map[key] = [];
      map[key].push(t);
    });
    return map;
  }, [active]);

  const undatedTasks = useMemo(() => active.filter((t) => {
    if (!t.date || typeof t.date !== 'string') return true;
    return !/^\d{4}-\d{2}-\d{2}$/.test(t.date.trim().slice(0, 10));
  }), [active]);

  const dayTasks = useMemo(() => tasksByDate[selectedDate] || [], [tasksByDate, selectedDate]);

  const prevMonth = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1); }
    else setCalMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1); }
    else setCalMonth((m) => m + 1);
  };

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} translucent={false} hidden={false} />
      <View style={s.header}>
        <View style={s.headerRow}>
          <Text style={s.logo} numberOfLines={1}>Голосовые заметки</Text>
          <View style={s.headerActions}>
            <TouchableOpacity onPress={onOpenTips} style={s.tipsBadge} accessibilityLabel="Подсказки">
              <Text style={s.tipsBadgeText}>?</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onOpenPro} style={s.proBadge} accessibilityLabel="Pro">
              <Text style={s.proBadgeText}>{isPro ? 'Pro' : 'Free'}</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={s.subtitle} numberOfLines={1}>Заметки и задачи голосом · офлайн</Text>
      </View>
      
      <View style={s.tabs}>
        {[
          { key: 'active', label: 'Активные' },
          { key: 'calendar', label: 'Календарь' },
          { key: 'done', label: 'Готово' },
        ].map((t) => (
          <TouchableOpacity key={t.key} style={[s.tab, tab === t.key && s.tabActive]} onPress={() => setTab(t.key)}>
            <Text style={[s.tabText, tab === t.key && s.tabTextActive]}>{t.label}</Text>
            {t.key === 'active' && active.length > 0 ? (
              <View style={s.tabBadge}><Text style={s.tabBadgeText}>{active.length}</Text></View>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'calendar' ? (
        <ScrollView contentContainerStyle={s.list} keyboardShouldPersistTaps="handled">
          <MonthCalendar year={calYear} month={calMonth} tasksByDate={tasksByDate} selectedDate={selectedDate} onSelectDate={setSelectedDate} onPrev={prevMonth} onNext={nextMonth} />
          <View style={s.dayHeader}>
            <Text style={s.dayTitle}>{formatDisplayDate(selectedDate)}</Text>
            <Text style={s.dayCount}>
              {dayTasks.length === 0 ? 'нет задач' : dayTasks.length === 1 ? '1 задача' : dayTasks.length < 5 ? dayTasks.length + ' задачи' : dayTasks.length + ' задач'}
            </Text>
          </View>
          {dayTasks.length === 0 ? (
            <View style={s.emptyDay}>
              <Text style={s.empty}>На этот день задач нет</Text>
              <Text style={[s.empty, { marginTop: 4, fontSize: 13 }]}>Добавьте задачу со словом «завтра», «в четверг» и т.д.</Text>
            </View>
          ) : (
            dayTasks.map((task) => <TaskCard key={task.id} task={task} onToggle={onToggle} onDelete={onDelete} />)
          )}
          {undatedTasks.length > 0 ? (
            <View style={{ marginTop: 24 }}>
              <Text style={s.dayTitle}>Без даты ({undatedTasks.length})</Text>
              <Text style={[s.empty, { textAlign: 'left', marginBottom: 8, fontSize: 13 }]}>Нет слов «завтра / в пятницу» — метки на календаре не ставятся</Text>
              {undatedTasks.map((task) => <TaskCard key={task.id} task={task} onToggle={onToggle} onDelete={onDelete} />)}
            </View>
          ) : null}
          <VersionBlock otaInfo={otaInfo} onCheckUpdate={onCheckUpdate} />
          <View style={{ height: 100 }} />
        </ScrollView>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.list}
          ListEmptyComponent={
            <View style={s.emptyBox}>
              <Text style={{ fontSize: 48, marginBottom: 12 }}>🎙️</Text>
              <Text style={s.empty}>{tab === 'done' ? 'Пока нет выполненных задач' : 'Напишите первую задачу'}</Text>
            </View>
          }
          renderItem={({ item }) => <TaskCard task={item} onToggle={onToggle} onDelete={onDelete} />}
          ListFooterComponent={
            <View>
              <VersionBlock otaInfo={otaInfo} onCheckUpdate={onCheckUpdate} />
              <View style={{ height: 100 }} />
            </View>
          }
        />
      )}
      
      <TouchableOpacity style={s.fab} onPress={onAdd} activeOpacity={0.85}>
        <Text style={s.fabText}>+</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

function AddTaskScreen({ onSave, onCancel, isPro, onNeedPro }) {
  const [text, setText] = useState('');
  const [priority, setPriority] = useState('medium');
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState(null);
  const lockRef = React.useRef(false);
  const voskRef = React.useRef(null);
  const voskListenersRef = React.useRef([]);
  const voskReadyRef = React.useRef(false);
  const startingRef = React.useRef(false);
  const micTimerRef = React.useRef(null);
  const voskCommittedRef = React.useRef('');
  const voskPartialRef = React.useRef('');
  const [examples, setExamples] = useState([]);
  const [examplesReady, setExamplesReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(EXAMPLES_KEY);
        const dismissed = raw ? JSON.parse(raw) : [];
        setExamples(DEFAULT_EXAMPLES.filter((ex) => !dismissed.includes(ex)));
      } catch { setExamples([...DEFAULT_EXAMPLES]); }
      setExamplesReady(true);
    })();
  }, []);

  const dismissExample = async (ex) => {
    setText(ex);
    setExamples((prev) => prev.filter((x) => x !== ex));
    try {
      const raw = await AsyncStorage.getItem(EXAMPLES_KEY);
      const dismissed = raw ? JSON.parse(raw) : [];
      if (!dismissed.includes(ex)) {
        dismissed.push(ex);
        await AsyncStorage.setItem(EXAMPLES_KEY, JSON.stringify(dismissed));
      }
    } catch (_) {}
  };

  useEffect(() => {
    if (text.trim()) {
      const p = parseTask(text);
      setPreview(p);
      if (p.priority !== 'medium') setPriority(p.priority);
    } else {
      setPreview(null);
    }
  }, [text]);

  useEffect(() => {
    return () => { lockRef.current = false; };
  }, []);

  const clearMicTimer = () => {
    if (micTimerRef.current) { clearTimeout(micTimerRef.current); micTimerRef.current = null; }
  };

  const cleanupVoskListeners = () => {
    try {
      (voskListenersRef.current || []).forEach((sub) => {
        try { if (sub && typeof sub.remove === 'function') sub.remove(); } catch (_) {}
      });
    } catch (_) {}
    voskListenersRef.current = [];
  };

  const stopVoskSafe = () => {
    clearMicTimer();
    cleanupVoskListeners();
    try {
      if (voskRef.current) {
        try { if (typeof voskRef.current.stop === 'function') voskRef.current.stop(); } catch (_) {}
      }
    } catch (_) {}
    try {
      const Speech = getSpeechModule();
      if (Speech && typeof Speech.stop === 'function') Speech.stop();
    } catch (_) {}
    lockRef.current = false;
    startingRef.current = false;
    setListening(false);
  };

  const ensureVosk = async () => {
    const Ctor = getVosk();
    if (!Ctor) return null;
    if (voskRef.current && voskReadyRef.current) return voskRef.current;
    const v = voskRef.current || new Ctor();
    voskRef.current = v;
    if (!voskReadyRef.current) {
      const candidates = [VOSK_MODEL, 'model-ru', 'vosk-model-small-ru-0.22'];
      let lastErr = null;
      let loaded = false;
      for (const name of candidates) {
        try { await v.loadModel(name); loaded = true; break; } catch (e) { lastErr = e; }
      }
      if (!loaded) throw new Error('Модель не найдена в APK. ' + (lastErr && lastErr.message ? lastErr.message : ''));
      voskReadyRef.current = true;
    }
    return v;
  };

  const pickVoskText = (res) => {
    if (res == null) return '';
    if (typeof res === 'string') return res.trim();
    if (typeof res === 'object') return String(res.text || res.phrase || res.result || res.partial || '').trim();
    return String(res).trim();
  };

  const onMicPress = async () => {
    if (startingRef.current) return;
    if (lockRef.current || listening) {
      try { stopVoskSafe(); setSpeechError(null); } catch (_) { lockRef.current = false; setListening(false); }
      return;
    }
    
    if (!isPro) {
      try {
        const raw = await AsyncStorage.getItem(VOICE_USES_KEY);
        const used = raw ? parseInt(raw, 10) || 0 : 0;
        if (used >= FREE_LIMITS.voiceUses) {
          setSpeechError('Лимит голоса Free: ' + FREE_LIMITS.voiceUses + ' раз. Оформите Pro или введите текст.');
          if (onNeedPro) onNeedPro('voice');
          else Alert.alert('Лимит голоса', 'В бесплатной версии до ' + FREE_LIMITS.voiceUses + ' голосовых вводов. Дальше — текст или Pro.', [{ text: 'OK' }]);
          return;
        }
      } catch (_) {}
    }

    startingRef.current = true;
    lockRef.current = true;
    setSpeechError(null);

    if (getVosk()) {
      try {
        try { if (voskRef.current && typeof voskRef.current.stop === 'function') voskRef.current.stop(); } catch (_) {}
        cleanupVoskListeners();
        await new Promise((r) => setTimeout(r, 400));
        const v = await ensureVosk();
        const subs = [];
        voskCommittedRef.current = (text || '').trim();
        voskPartialRef.current = '';
        
        const paintText = () => {
          const a = (voskCommittedRef.current || '').trim();
          const b = (voskPartialRef.current || '').trim();
          const full = (a && b ? a + ' ' + b : a || b).trim();
          if (full) setText(full);
        };
        
        const finish = () => {
          clearMicTimer();
          lockRef.current = false;
          startingRef.current = false;
          setListening(false);
          try { v.stop(); } catch (_) {}
          cleanupVoskListeners();
        };

        subs.push(v.onPartialResult((res) => {
          const t = pickVoskText(res);
          if (t) { voskPartialRef.current = t; paintText(); }
        }));
        
        subs.push(v.onResult((res) => {
          const t = pickVoskText(res);
          if (t) {
            const prev = (voskCommittedRef.current || '').trim();
            voskCommittedRef.current = (prev ? prev + ' ' + t : t).trim();
            voskPartialRef.current = '';
            paintText();
          }
        }));
        
        subs.push(v.onFinalResult((res) => {
          const t = pickVoskText(res);
          if (t) {
            const prev = (voskCommittedRef.current || '').trim();
            if (!prev.endsWith(t)) voskCommittedRef.current = (prev ? prev + ' ' + t : t).trim();
            voskPartialRef.current = '';
            paintText();
          }
          finish();
        }));
        
        subs.push(v.onError((err) => {
          const msg = String(err || '');
          finish();
          if (/already in use/i.test(msg)) setSpeechError('Микрофон занят. Нажмите ещё раз через секунду.');
          else setSpeechError(msg || 'Ошибка Vosk');
        }));
        
        subs.push(v.onTimeout(() => { finish(); }));
        voskListenersRef.current = subs;
        
        await v.start({ timeout: 120000 });
        setListening(true);
        startingRef.current = false;
        
        if (!isPro) {
          try {
            const raw = await AsyncStorage.getItem(VOICE_USES_KEY);
            const used = raw ? parseInt(raw, 10) || 0 : 0;
            await AsyncStorage.setItem(VOICE_USES_KEY, String(used + 1));
          } catch (_) {}
        }
        
        clearMicTimer();
        micTimerRef.current = setTimeout(() => { try { finish(); } catch (_) {} }, 125000);
        return;
      } catch (e) {
        stopVoskSafe();
        setSpeechError('Vosk: ' + (e && e.message ? e.message : String(e)));
      }
    }

    try {
      const Speech = getSpeechModule();
      if (!Speech) { stopVoskSafe(); setSpeechError('Голосовой модуль недоступен. Можно ввести задачу текстом.'); return; }
      const perm = await Speech.requestPermissionsAsync();
      if (!perm?.granted) {
        stopVoskSafe();
        setSpeechError('Нет доступа к микрофону');
        Alert.alert('Микрофон', 'Разрешите доступ в настройках приложения');
        return;
      }
      let onDevice = false;
      try { onDevice = !!(Speech.supportsOnDeviceRecognition && Speech.supportsOnDeviceRecognition()); } catch (_) {}
      
      Speech.start({
        lang: 'ru-RU', interimResults: true, continuous: true, requiresOnDeviceRecognition: onDevice,
        androidIntentOptions: {
          EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 8000,
          EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 8000,
          EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 2000,
          EXTRA_LANGUAGE_MODEL: 'free_form', EXTRA_PREFER_OFFLINE: true,
        },
      });
      setListening(true);
      startingRef.current = false;
      
      if (!isPro) {
        try {
          const raw = await AsyncStorage.getItem(VOICE_USES_KEY);
          const used = raw ? parseInt(raw, 10) || 0 : 0;
          await AsyncStorage.setItem(VOICE_USES_KEY, String(used + 1));
        } catch (_) {}
      }
      
      clearMicTimer();
      micTimerRef.current = setTimeout(() => { stopVoskSafe(); }, 45000);
    } catch (e) {
      stopVoskSafe();
      setSpeechError((e && e.message) || 'Голос недоступен. Введите текст.');
    }
  };

  const handleSave = async () => {
    if (!text.trim()) { Alert.alert('Пусто', 'Введите или надиктуйте задачу'); return; }
    setSaving(true);
    try {
      setListening(false);
      lockRef.current = false;
      const p = parseTask(text);
      await onSave({ title: p.title, date: p.date, time: p.time, priority: priority || p.priority, category: p.category, raw: text });
    } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.addHeader}>
          <TouchableOpacity onPress={onCancel}><Text style={s.cancelBtn}>Отмена</Text></TouchableOpacity>
          <Text style={s.addTitle}>Новая задача</Text>
          <TouchableOpacity onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color={COLORS.primary} /> : <Text style={s.saveBtn}>Готово</Text>}
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={[s.voiceBox, listening && s.voiceBoxActive]} onPress={onMicPress} activeOpacity={0.8}>
            <View style={[s.micCircle, listening && s.micCircleActive]}>
              {listening ? <View style={s.micPulse} /> : null}
              <Text style={{ fontSize: 22 }}>🎙️</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: listening ? COLORS.secondary : COLORS.text, fontSize: 15, fontWeight: '600' }}>
                {listening ? 'Идёт запись… говорите' : 'Голосовой набор'}
              </Text>
              <Text style={{ color: COLORS.textSecondary, fontSize: 13, marginTop: 2 }}>
                {listening ? 'Слушаю… можно делать паузы; стоп — повторное нажатие на микрофон' : 'Нажмите и говорите. Стоп — повторное нажатие'}
              </Text>
            </View>
          </TouchableOpacity>
          {speechError ? <Text style={{ color: COLORS.danger, marginBottom: 12, fontSize: 13 }}>{speechError}</Text> : null}
          <TextInput
            style={s.input}
            placeholder="Голосовой набор или ввод: Купить молоко завтра в 10"
            placeholderTextColor={COLORS.textSecondary}
            value={text}
            onChangeText={setText}
            multiline
            autoFocus={false}
          />
          {preview ? (
            <View style={{ marginBottom: 20 }}>
              <Text style={s.sectionLabel}>Распознано автоматически:</Text>
              <View style={s.chipsRow}>
                {preview.date ? (
                  <View style={s.previewChip}><Text style={s.previewChipText}>📅 {formatDisplayDate(preview.date, preview.time)}</Text></View>
                ) : (
                  <View style={[s.previewChip, { backgroundColor: '#FEE2E2' }]}><Text style={s.previewChipText}>📅 дата не найдена</Text></View>
                )}
                {preview.category ? <View style={s.previewChip}><Text style={s.previewChipText}>🏷 {preview.category}</Text></View> : null}
                <View style={[s.previewChip, { backgroundColor: COLORS.chip[priority] }]}>
                  <Text style={s.previewChipText}>{priority === 'high' ? '🔥 Важно' : priority === 'low' ? '↓ Низкий' : '• Средний'}</Text>
                </View>
              </View>
            </View>
          ) : null}
          <Text style={s.sectionLabel}>Приоритет</Text>
          <PriorityChips value={priority} onChange={setPriority} />
          {examplesReady && examples.length > 0 ? (
            <>
              <Text style={[s.sectionLabel, { marginTop: 20 }]}>Примеры (нажми — подставится и скроется)</Text>
              {examples.map((ex) => (
                <TouchableOpacity key={ex} style={s.example} onPress={() => dismissExample(ex)}>
                  <Text style={s.exampleText}>{ex}</Text>
                </TouchableOpacity>
              ))}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

async function runOTACheck() {
  const meta = { channel: Updates.channel || null, runtime: Updates.runtimeVersion || null, updateId: Updates.updateId || null, enabled: Updates.isEnabled };
  if (__DEV__) return { ok: false, reason: 'Dev-режим: OTA отключён', ...meta };
  if (!Updates.isEnabled) return { ok: false, reason: 'Updates.isEnabled=false — пересоберите APK с channel preview', ...meta };
  
  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) return { ok: true, reason: 'Актуально', ...meta };
    
    let lastErr = null;
    for (let i = 0; i < 3; i++) {
      try {
        if (i > 0) await new Promise((r) => setTimeout(r, 1500 * i));
        const fetched = await Updates.fetchUpdateAsync();
        if (fetched?.isNew) {
          await Updates.reloadAsync();
          return { ok: true, reason: 'Обновление установлено', ...meta };
        }
        return { ok: true, reason: 'Скачано, перезапустите приложение', ...meta };
      } catch (e) { lastErr = e; }
    }
    const msg = lastErr?.message || String(lastErr) || 'Failed to download';
    return { ok: false, reason: 'Не удалось скачать (сеть). Wi‑Fi, ещё раз, или поставьте новый APK. ' + msg.slice(0, 80), ...meta };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e), ...meta };
  }
}

function LimitPaywallScreen({ reason, onClose, onBuyPro, onOpenPro, proLoading }) {
  const isVoice = reason === 'voice';
  const title = isVoice ? 'Лимит голосового ввода' : 'Лимит задач';
  const body = isVoice
    ? 'В бесплатной версии доступно ' + FREE_LIMITS.voiceUses + ' голосовых ввода. Текст по-прежнему можно вводить без ограничений.\n\nPro — безлимитный голос и задачи за 99 ₽ один раз.'
    : 'В бесплатной версии до ' + FREE_LIMITS.maxActiveTasks + ' активных задач. Завершите старые или оформите Pro.\n\nPro — без ограничений за 99 ₽, без подписки.';

  return (
    <SafeAreaView style={s.container}>
      <View style={s.addHeader}>
        <TouchableOpacity onPress={onClose}><Text style={s.cancelBtn}>Закрыть</Text></TouchableOpacity>
        <Text style={s.addTitle}>Free</Text>
        <View style={{ width: 64 }} />
      </View>
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <Text style={{ fontSize: 48, textAlign: 'center', marginBottom: 12 }}>{isVoice ? '🎙️' : '📋'}</Text>
        <Text style={{ fontSize: 22, fontWeight: '700', color: COLORS.text, textAlign: 'center', marginBottom: 12 }}>{title}</Text>
        <Text style={{ fontSize: 16, lineHeight: 24, color: COLORS.textSecondary, textAlign: 'center', marginBottom: 28 }}>{body}</Text>
        <TouchableOpacity style={s.proBtn} onPress={onBuyPro} disabled={proLoading} activeOpacity={0.85}>
          {proLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.proBtnText}>Купить Pro · 99 ₽</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={onOpenPro} style={{ marginTop: 16, alignSelf: 'center' }}>
          <Text style={{ color: COLORS.primary, fontWeight: '600' }}>Подробнее о Pro</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose} style={{ marginTop: 20, alignSelf: 'center' }}>
          <Text style={{ color: COLORS.textSecondary }}>Позже</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function ProScreen({ isPro, onClose, onActivatePromo, onBuyPro, onRestorePro, proLoading, proError }) {
  const [code, setCode] = useState('');
  const [promoError, setPromoError] = useState(null);
  const [showPromo, setShowPromo] = useState(false);

  const submitPromo = () => {
    const entered = (code || '').trim().toUpperCase();
    const friends = String(PROMO_CODE || '').trim().toUpperCase();
    const paid = String(PAID_PRO_CODE || '').trim().toUpperCase();
    if (!entered) { setPromoError('Введите код'); return; }
    if (entered === friends || entered === paid) {
      setPromoError(null);
      onActivatePromo && onActivatePromo();
    } else {
      setPromoError('Неверный код');
    }
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.addHeader}>
        <TouchableOpacity onPress={onClose}><Text style={s.cancelBtn}>Закрыть</Text></TouchableOpacity>
        <Text style={s.addTitle}>Pro</Text>
        <View style={{ width: 64 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: COLORS.text, marginBottom: 8 }}>Голосовые заметки Pro</Text>
        <Text style={{ color: COLORS.textSecondary, marginBottom: 16, lineHeight: 22 }}>
          Бесплатно: {FREE_LIMITS.maxActiveTasks} активные задачи и {FREE_LIMITS.voiceUses} голосовых ввода.{'\n\n'}
          Pro — без ограничений на задачи и голос. Оплата один раз, без подписки.
        </Text>
        <View style={s.proCard}>
          <Text style={s.proPrice}>99 ₽</Text>
          <Text style={{ color: COLORS.textSecondary, marginTop: 4 }}>разовая покупка · навсегда</Text>
        </View>
        {isPro ? (
          <Text style={{ color: COLORS.secondary, fontWeight: '600', marginBottom: 16 }}>Pro активен · без ограничений</Text>
        ) : (
          <>
            <TouchableOpacity style={s.proBtn} onPress={onBuyPro} disabled={proLoading}>
              {proLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.proBtnText}>Купить Pro · 99 ₽</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={onRestorePro} disabled={proLoading} style={{ marginTop: 14, alignSelf: 'center' }}>
              <Text style={{ color: COLORS.primary, fontWeight: '600' }}>Восстановить покупку</Text>
            </TouchableOpacity>
            {proError ? <Text style={{ color: COLORS.danger, marginTop: 10, textAlign: 'center', fontSize: 13 }}>{proError}</Text> : null}
            <TouchableOpacity onPress={() => setShowPromo((v) => !v)} style={{ marginTop: 20 }}>
              <Text style={{ color: COLORS.primary, textAlign: 'center', fontWeight: '600' }}>{showPromo ? 'Скрыть' : 'Есть код активации?'}</Text>
            </TouchableOpacity>
            {showPromo ? (
              <View style={{ marginTop: 12 }}>
                <TextInput
                  style={[s.input, { marginBottom: 8 }]}
                  placeholder="Код активации"
                  value={code}
                  onChangeText={(t) => { setCode(t); setPromoError(null); }}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
                {promoError ? <Text style={{ color: COLORS.danger, marginBottom: 8 }}>{promoError}</Text> : null}
                <TouchableOpacity style={[s.proBtn, { backgroundColor: COLORS.text }]} onPress={submitPromo}>
                  <Text style={s.proBtnText}>Активировать</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function OnboardingScreen({ onDone }) {
  const [step, setStep] = useState(0);
  const last = step >= ONBOARDING_STEPS.length - 1;
  const item = ONBOARDING_STEPS[step];
  const next = () => {
    if (last) onDone();
    else setStep((s) => s + 1);
  };

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      <View style={s.onboardWrap}>
        <Text style={s.onboardSkip} onPress={onDone}>Пропустить</Text>
        <View style={s.onboardCard}>
          <Text style={s.onboardIcon}>{item.icon}</Text>
          <Text style={s.onboardTitle}>{item.title}</Text>
          <Text style={s.onboardText}>{item.text}</Text>
        </View>
        <View style={s.onboardDots}>
          {ONBOARDING_STEPS.map((_, i) => <View key={i} style={[s.onboardDot, i === step && s.onboardDotActive]} />)}
        </View>
        <TouchableOpacity style={s.onboardBtn} onPress={next} activeOpacity={0.85}>
          <Text style={s.onboardBtnText}>{last ? 'Начать' : 'Далее'}</Text>
        </TouchableOpacity>
        <Text style={s.onboardHint}>Шаг {step + 1} из {ONBOARDING_STEPS.length}</Text>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState('home');
  const [limitReason, setLimitReason] = useState('tasks');
  const [otaInfo, setOtaInfo] = useState('');
  const [isPro, setIsPro] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [proLoading, setProLoading] = useState(false);
  const [proError, setProError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        try {
          const pro = await AsyncStorage.getItem(PRO_KEY);
          if (!cancelled) setIsPro(pro === '1');
        } catch (_) {}
        
        try {
          const owned = await RuStorePay.getOwnedProductIds();
          if (!cancelled && owned.indexOf(RuStorePay.PRO_PRODUCT_ID) !== -1) {
            setIsPro(true);
            try { await AsyncStorage.setItem(PRO_KEY, '1'); } catch (_) {}
          }
        } catch (_) {}
        
        try {
          const seen = await AsyncStorage.getItem(ONBOARDING_KEY);
          if (!cancelled) setShowOnboarding(seen !== '1');
        } catch (_) { if (!cancelled) setShowOnboarding(true); }
        
        try {
          const data = await loadTasks();
          if (!cancelled) setTasks(Array.isArray(data) ? data : []);
        } catch (_) { if (!cancelled) setTasks([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }

      try {
        const enabled = !__DEV__ && !!(Updates && Updates.isEnabled);
        const meta = 'ch:' + ((Updates && Updates.channel) || '—') + ' · rt:' + ((Updates && Updates.runtimeVersion) || '—');
        if (!cancelled) setOtaInfo(enabled ? meta : 'OTA off · ' + meta);
        if (enabled) {
          setTimeout(() => {
            runOTACheck()
              .then((r) => {
                if (cancelled || !r || !r.reason || r.reason === 'Актуально') return;
                setOtaInfo((prev) => prev + ' · ' + r.reason);
              })
              .catch(() => {});
          }, 2000);
        }
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, []);

  const persist = useCallback(async (next) => {
    setTasks(next);
    await saveTasks(next);
  }, []);

  const addTask = async (data) => {
    const activeCount = tasks.filter((t) => !t.completed).length;
    if (!isPro && activeCount >= FREE_LIMITS.maxActiveTasks) {
      setLimitReason('tasks');
      setScreen('limit');
      Alert.alert('Лимит бесплатной версии', 'До ' + FREE_LIMITS.maxActiveTasks + ' активных задач. Оформите Pro или завершите старые.', [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Pro', onPress: () => setScreen('pro') },
      ]);
      return;
    }
    const newTask = {
      id: Date.now().toString() + Math.random().toString(36).slice(2, 7),
      createdAt: new Date().toISOString(),
      completed: false,
      ...data,
    };
    try {
      const nids = await scheduleTaskReminder(newTask);
      if (nids && nids.length) newTask.notificationIds = nids;
    } catch (_) {}
    await persist([newTask, ...tasks]);
    setScreen('home');
  };

  const activateProDemo = async () => {
    await AsyncStorage.setItem(PRO_KEY, '1');
    setIsPro(true);
    Alert.alert('Pro', 'Безлимитный доступ активирован');
    setScreen('home');
  };

  const unlockPro = async () => {
    try { await AsyncStorage.setItem(PRO_KEY, '1'); } catch (_) {}
    setIsPro(true);
  };

  const buyPro = async () => {
    const url = (YOOKASSA_PAY_URL || '').trim();
    if (!url || url.indexOf('REPLACE_WITH') !== -1) {
      Alert.alert('Оплата', 'Ссылка на оплату ещё не настроена. Напишите разработчику или введите код активации в разделе Pro.');
      return;
    }
    try {
      const can = await Linking.canOpenURL(url);
      if (!can) { Alert.alert('Оплата', 'Не удалось открыть ссылку. Попробуйте позже.'); return; }
      await Linking.openURL(url);
      Alert.alert('После оплаты', 'Когда платёж пройдёт, введите код активации в «Есть код активации?» на этом экране.', [{ text: 'Понятно' }]);
    } catch (e) { Alert.alert('Оплата', 'Не удалось открыть страницу оплаты.'); }
  };

  const restorePro = async () => {
    if (proLoading) return;
    setProLoading(true);
    setProError(null);
    try {
      const owned = await RuStorePay.getOwnedProductIds();
      if (owned.indexOf(RuStorePay.PRO_PRODUCT_ID) !== -1) {
        await unlockPro();
        Alert.alert('Pro', 'Покупка восстановлена');
      } else {
        Alert.alert('Pro', 'Покупок не найдено');
      }
    } catch (_) { setProError('Не удалось восстановить покупку'); }
    finally { setProLoading(false); }
  };

  const toggleComplete = async (id) => {
    const next = [];
    for (const t of tasks) {
      if (t.id !== id) { next.push(t); continue; }
      const becomingDone = !t.completed;
      let notificationIds = t.notificationIds || (t.notificationId ? [t.notificationId] : []);
      if (becomingDone) {
        await cancelTaskReminder(t);
        notificationIds = [];
      } else if (t.date) {
        notificationIds = (await scheduleTaskReminder({ ...t, completed: false, notificationIds: [], notificationId: null })) || [];
      }
      next.push({ ...t, completed: becomingDone, completedAt: becomingDone ? new Date().toISOString() : null, notificationIds, notificationId: null });
    }
    await persist(next);
  };

  const deleteTask = async (id) => {
    const t = tasks.find((x) => x.id === id);
    if (t) await cancelTaskReminder(t);
    await persist(tasks.filter((x) => x.id !== id));
  };

  const finishOnboarding = async () => {
    try { await AsyncStorage.setItem(ONBOARDING_KEY, '1'); } catch (_) {}
    setShowOnboarding(false);
  };

  if (loading) {
    return (
      <View style={[s.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (showOnboarding) return <OnboardingScreen onDone={finishOnboarding} />;

  if (screen === 'add') {
    return (
      <AddTaskScreen
        onSave={addTask}
        onCancel={() => setScreen('home')}
        isPro={isPro}
        onNeedPro={(reason) => { setLimitReason(reason || 'voice'); setScreen('limit'); }}
      />
    );
  }

  if (screen === 'limit') {
    return (
      <LimitPaywallScreen
        reason={limitReason}
        onClose={() => setScreen('home')}
        onBuyPro={buyPro}
        onOpenPro={() => setScreen('pro')}
        proLoading={proLoading}
      />
    );
  }

  if (screen === 'pro') {
    return (
      <ProScreen
        isPro={isPro}
        onClose={() => setScreen('home')}
        onActivatePromo={activateProDemo}
        onBuyPro={buyPro}
        onRestorePro={restorePro}
        proLoading={proLoading}
        proError={proError}
      />
    );
  }

  const onCheckUpdate = async () => {
    setOtaInfo('Проверка…');
    const r = await runOTACheck();
    const msg = r.reason || 'готово';
    setOtaInfo((r.channel ? 'ch:' + r.channel + ' · ' : '') + (r.runtime ? 'rt:' + r.runtime + ' · ' : '') + msg);
    if (!r.ok) Alert.alert('Обновление', msg);
    else if (r.reason === 'Актуально') Alert.alert('Обновление', 'У вас актуальная версия');
  };

  return (
    <HomeScreen
      tasks={tasks}
      onToggle={toggleComplete}
      onDelete={deleteTask}
      onAdd={() => setScreen('add')}
      otaInfo={otaInfo}
      onCheckUpdate={onCheckUpdate}
      isPro={isPro}
      onOpenPro={() => setScreen('pro')}
      onOpenTips={() => setShowOnboarding(true)}
    />
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: 24, paddingTop: 36, paddingBottom: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', alignItems: 'center', flexShrink: 0, marginLeft: 8 },
  logo: { fontSize: 26, fontWeight: '700', color: COLORS.primary, flexShrink: 1, marginRight: 8 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginTop: 2 },
  tabs: { flexDirection: 'row', paddingHorizontal: 24, marginBottom: 12, gap: 8 },
  tab: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: COLORS.surface },
  tabActive: { backgroundColor: COLORS.primary },
  tabText: { fontSize: 14, fontWeight: '500', color: COLORS.textSecondary },
  tabTextActive: { color: '#fff' },
  tabBadge: { backgroundColor: '#fff', borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  tabBadgeText: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  list: { paddingHorizontal: 24, paddingBottom: 200, flexGrow: 1 },
  emptyBox: { alignItems: 'center', marginTop: 60 },
  empty: { textAlign: 'center', color: COLORS.textSecondary, fontSize: 16 },
  emptyDay: { alignItems: 'center', paddingVertical: 24 },
  dayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  dayTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  dayCount: { fontSize: 14, color: COLORS.textSecondary },
  versionBlock: { marginTop: 28, marginBottom: 8, paddingVertical: 16, paddingHorizontal: 12, alignItems: 'center', borderTopWidth: 1, borderTopColor: COLORS.border },
  versionFooter: { position: 'absolute', bottom: 12, left: 12, right: 88, alignItems: 'center', zIndex: 1, backgroundColor: 'rgba(248,250,252,0.92)', paddingVertical: 6, borderRadius: 10 },
  versionText: { fontSize: 12, color: COLORS.textSecondary, textAlign: 'center' },
  otaText: { fontSize: 10, color: COLORS.textSecondary, textAlign: 'center', marginTop: 2, opacity: 0.7 },
  otaBtn: { fontSize: 13, color: COLORS.primary, fontWeight: '600', marginTop: 8, textAlign: 'center' },
  tipsBadge: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', marginRight: 8, opacity: 0.85 },
  tipsBadgeText: { fontSize: 16, fontWeight: '700', color: COLORS.primary },
  onboardWrap: { flex: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 32, justifyContent: 'center' },
  onboardSkip: { alignSelf: 'flex-end', color: COLORS.textSecondary, fontSize: 15, marginBottom: 12, padding: 8 },
  onboardCard: { backgroundColor: COLORS.surface, borderRadius: 20, padding: 28, minHeight: 280, justifyContent: 'center', elevation: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  onboardIcon: { fontSize: 48, textAlign: 'center', marginBottom: 16 },
  onboardTitle: { fontSize: 22, fontWeight: '700', color: COLORS.text, textAlign: 'center', marginBottom: 12 },
  onboardText: { fontSize: 16, lineHeight: 24, color: COLORS.textSecondary, textAlign: 'center' },
  onboardDots: { flexDirection: 'row', justifyContent: 'center', marginTop: 24, marginBottom: 20, gap: 8 },
  onboardDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.border },
  onboardDotActive: { backgroundColor: COLORS.primary, width: 20 },
  onboardBtn: { backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  onboardBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  onboardHint: { textAlign: 'center', color: COLORS.textSecondary, fontSize: 13, marginTop: 12 },
  proBadge: { backgroundColor: COLORS.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, minWidth: 52, alignItems: 'center', flexShrink: 0 },
  proBadgeText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  proCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: COLORS.border },
  proPrice: { fontSize: 28, fontWeight: '700', color: COLORS.primary },
  proBtn: { backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  proBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  fab: { position: 'absolute', right: 24, bottom: 96, width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8 },
  fabText: { fontSize: 32, color: '#fff', fontWeight: '300', marginTop: -2 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, marginBottom: 8, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
  cardCompleted: { opacity: 0.6 },
  checkbox: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: COLORS.border, marginRight: 14, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: COLORS.secondary, borderColor: COLORS.secondary },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  taskTitle: { fontSize: 16, fontWeight: '500', color: COLORS.text, marginBottom: 4 },
  taskTitleDone: { textDecorationLine: 'line-through', color: COLORS.textSecondary },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  dateText: { fontSize: 13, color: COLORS.textSecondary },
  catChip: { backgroundColor: COLORS.primaryLight + '30', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  catText: { fontSize: 12, color: COLORS.primary, fontWeight: '500' },
  priorityDot: { width: 10, height: 10, borderRadius: 5, marginLeft: 8 },
  addHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: TOP_INSET, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  cancelBtn: { fontSize: 16, color: COLORS.textSecondary },
  addTitle: { fontSize: 17, fontWeight: '600', color: COLORS.text },
  saveBtn: { fontSize: 16, fontWeight: '600', color: COLORS.primary },
  voiceBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 16, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: COLORS.border },
  voiceBoxActive: { borderColor: COLORS.secondary, backgroundColor: '#ECFDF5' },
  micCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center', marginRight: 12, borderWidth: 2, borderColor: COLORS.border },
  micCircleActive: { backgroundColor: COLORS.secondary, borderColor: COLORS.secondary },
  micPulse: { position: 'absolute', width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.secondary, opacity: 0.35 },
  input: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, fontSize: 17, color: COLORS.text, minHeight: 100, textAlignVertical: 'top', marginBottom: 20 },
  sectionLabel: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 10 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  dotSmall: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  chipLabel: { fontSize: 14, color: COLORS.textSecondary },
  previewChip: { backgroundColor: COLORS.primaryLight + '30', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  previewChipText: { fontSize: 13, color: COLORS.text },
  example: { backgroundColor: COLORS.surface, padding: 12, borderRadius: 12, marginBottom: 8 },
  exampleText: { fontSize: 14, color: COLORS.textSecondary },
});