import 'package:flutter/widgets.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:shared_preferences/shared_preferences.dart';

part 'settings_controller.g.dart';

class SettingsState {
  const SettingsState({required this.language});
  final String language; // 'ko' | 'en'

  Locale get locale => Locale(language);

  SettingsState copyWith({String? language}) =>
      SettingsState(language: language ?? this.language);
}

const _kLanguageKey = 'language';

@Riverpod(keepAlive: true)
class SettingsController extends _$SettingsController {
  @override
  SettingsState build() {
    // 부팅 시 비동기 로드 trigger.
    Future.microtask(_load);
    return const SettingsState(language: 'ko');
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final v = prefs.getString(_kLanguageKey);
    if (v != null && v != state.language) {
      state = state.copyWith(language: v);
    }
  }

  Future<void> setLanguage(String lang) async {
    state = state.copyWith(language: lang);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kLanguageKey, lang);
  }
}
