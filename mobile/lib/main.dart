import 'package:audio_session/audio_session.dart';
import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app/app.dart';

/// iOS 공유 AVAudioSession 을 앱 전체에서 단일 설정(playAndRecord)으로 통일.
///
/// just_audio(재생)와 record(녹음)가 각자 세션 카테고리를 바꾸며 setActive 를
/// 호출하면 "Session activation failed" 로 녹음 시작이 실패한다. 여기서 한 번
/// 설정해 두면 just_audio 는 이 설정을 그대로 따르고, record 쪽 세션 관리는
/// AudioRecorderService 에서 끈다.
Future<void> _configureAudioSession() async {
  final session = await AudioSession.instance;
  await session.configure(AudioSessionConfiguration(
    avAudioSessionCategory: AVAudioSessionCategory.playAndRecord,
    avAudioSessionCategoryOptions: AVAudioSessionCategoryOptions.defaultToSpeaker |
        AVAudioSessionCategoryOptions.allowBluetooth |
        AVAudioSessionCategoryOptions.allowBluetoothA2dp,
    avAudioSessionMode: AVAudioSessionMode.defaultMode,
    avAudioSessionSetActiveOptions:
        AVAudioSessionSetActiveOptions.notifyOthersOnDeactivation,
    androidAudioAttributes: const AndroidAudioAttributes(
      contentType: AndroidAudioContentType.speech,
      usage: AndroidAudioUsage.media,
    ),
    androidAudioFocusGainType: AndroidAudioFocusGainType.gain,
    androidWillPauseWhenDucked: true,
  ));
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await dotenv.load(fileName: '.env');
  await _configureAudioSession();

  final url = dotenv.env['SUPABASE_URL'] ?? '';
  final anon = dotenv.env['SUPABASE_ANON_KEY'] ?? '';
  if (url.isNotEmpty && anon.isNotEmpty && !anon.contains('REPLACE_ME')) {
    await Supabase.initialize(
      url: url,
      anonKey: anon,
      authOptions: const FlutterAuthClientOptions(
        authFlowType: AuthFlowType.pkce,
      ),
    );
  }

  runApp(const ProviderScope(child: App()));
}
