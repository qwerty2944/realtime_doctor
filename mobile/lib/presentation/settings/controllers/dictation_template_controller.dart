import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../domain/entities/dictation.dart';

part 'dictation_template_controller.g.dart';

const _kPrefsKey = 'dictationTemplate';

/// 사용자가 마지막에 선택한 받아쓰기 템플릿을 보존.
/// Capture 의 live dictation 과 Session detail 의 Dictation 탭이 공유.
@Riverpod(keepAlive: true)
class DictationTemplateController extends _$DictationTemplateController {
  @override
  DictationTemplate build() {
    Future.microtask(_load);
    return DictationTemplate.soap;
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final v = prefs.getString(_kPrefsKey);
    if (v != null) {
      final parsed = DictationTemplate.fromString(v);
      if (parsed != state) state = parsed;
    }
  }

  Future<void> setTemplate(DictationTemplate t) async {
    if (t == state) return;
    state = t;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kPrefsKey, t.wire);
  }
}
