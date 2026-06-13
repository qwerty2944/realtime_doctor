import 'package:flutter/material.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:shared_preferences/shared_preferences.dart';

part 'settings_controller.g.dart';

class SettingsState {
  const SettingsState({required this.language, required this.themeMode});
  final String language; // 'ko' | 'en'
  final ThemeMode themeMode;

  Locale get locale => Locale(language);

  SettingsState copyWith({String? language, ThemeMode? themeMode}) =>
      SettingsState(
        language: language ?? this.language,
        themeMode: themeMode ?? this.themeMode,
      );
}

const _kLanguageKey = 'language';
const _kThemeModeKey = 'themeMode';

@Riverpod(keepAlive: true)
class SettingsController extends _$SettingsController {
  @override
  SettingsState build() {
    // 부팅 시 비동기 로드 trigger.
    Future.microtask(_load);
    return const SettingsState(language: 'ko', themeMode: ThemeMode.system);
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final lang = prefs.getString(_kLanguageKey);
    final theme = prefs.getString(_kThemeModeKey);
    state = state.copyWith(
      language: lang,
      themeMode: theme == null
          ? null
          : ThemeMode.values.asNameMap()[theme] ?? ThemeMode.system,
    );
  }

  Future<void> setLanguage(String lang) async {
    state = state.copyWith(language: lang);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kLanguageKey, lang);
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    state = state.copyWith(themeMode: mode);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kThemeModeKey, mode.name);
  }
}
