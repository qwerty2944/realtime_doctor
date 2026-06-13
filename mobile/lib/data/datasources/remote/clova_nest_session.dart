import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:grpc/grpc.dart';

import '../../../core/utils/logger.dart';
import 'clova_nest_proto.dart';
import 'realtime_transcriber.dart';

/// CLOVA Speech NEST gRPC bidi streaming 클라이언트.
///
/// 일렉트론의 `src/main/clovaStream.ts` 와 동일한 protocol:
/// 1. CONFIG 메시지로 transcription 옵션 + EPD(end-point detection) 옵션 보냄.
/// 2. DATA 메시지로 PCM 16-bit mono 청크 + JSON({seqId, epFlag}) 누적 송신.
/// 3. server 가 NestResponse.contents = JSON string 으로 응답:
///    - `responseType: ["transcription"]` + `transcription.{text, epdType}`
///    - epdType in {endPoint, period, durationThreshold} → final
///    - epdType == 'gap' → partial
class ClovaNestSession implements RealtimeTranscriber {
  ClovaNestSession({
    required this.secret,
    required this.sampleRate,
    this.language = 'ko',
  });

  final String secret;
  final int sampleRate;
  final String language;

  ClientChannel? _channel;
  ClientCall<List<int>, List<int>>? _call;
  StreamController<List<int>>? _requests;
  StreamSubscription<List<int>>? _responseSub;
  final StreamController<TranscribeEvent> _events =
      StreamController<TranscribeEvent>.broadcast();
  int _seq = 0;
  bool _closed = false;

  @override
  Stream<TranscribeEvent> get events => _events.stream;

  @override
  Future<void> open() async {
    if (secret.isEmpty || secret == 'REPLACE_ME') {
      throw const FormatException(
        'CLOVA_SPEECH_SECRET 가 설정되지 않았습니다. .env 를 확인하세요.',
      );
    }
    _channel = ClientChannel(
      'clovaspeech-gw.ncloud.com',
      port: 50051,
      options: const ChannelOptions(
        credentials: ChannelCredentials.secure(),
        idleTimeout: Duration(minutes: 1),
      ),
    );

    final method = ClientMethod<List<int>, List<int>>(
      '/com.nbp.cdncp.nest.grpc.proto.v1.NestService/recognize',
      (req) => req,
      (bytes) => bytes,
    );

    _requests = StreamController<List<int>>();

    _call = _channel!.createCall<List<int>, List<int>>(
      method,
      _requests!.stream,
      CallOptions(
        metadata: {'authorization': 'Bearer $secret'},
        timeout: const Duration(hours: 1),
      ),
    );
    _responseSub = _call!.response
        .listen(_onResponse, onError: _onError, onDone: _onDone);

    // 1) CONFIG 송신 — transcription + EPD 옵션.
    final config = jsonEncode({
      'transcription': {'language': language},
      'semanticEpd': {
        'skipEmptyText': false,
        'useWordEpd': false,
        'usePeriodEpd': true,
        'gapThreshold': 500,
        'durationThreshold': 20000,
        'syllableThreshold': 0,
      },
      'audioInput': {
        'sampleRate': sampleRate,
        'encoding': 'LINEAR16',
        'channel': 1,
      },
    });
    _requests!.add(NestProto.encodeRequest(type: 0, config: config));
  }

  void _onResponse(List<int> raw) {
    if (_closed) return;
    final contents = NestProto.decodeResponse(raw);
    if (contents == null || contents.isEmpty) return;
    Map<String, dynamic> parsed;
    try {
      parsed = jsonDecode(contents) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    final types = (parsed['responseType'] as List?)?.cast<String>() ?? const [];
    if (types.contains('transcription')) {
      final t = parsed['transcription'] as Map<String, dynamic>?;
      if (t == null) return;
      final text = (t['text'] as String?) ?? '';
      if (text.isEmpty) return;
      final epd = t['epdType'] as String?;
      final isFinal = epd != null && epd != 'gap';
      final itemId = 'clova-${DateTime.now().millisecondsSinceEpoch}-$_seq';
      if (!_events.isClosed) {
        _events.add(TranscribeEvent(
          itemId: itemId,
          text: text,
          isFinal: isFinal,
        ));
      }
    } else if (types.contains('recognize')) {
      final r = parsed['recognize'] as Map<String, dynamic>?;
      final status = r?['status'];
      if (status != null) {
        appLogger.w('CLOVA NEST status: $status');
      }
    }
  }

  void _onError(Object err) {
    appLogger.e('CLOVA NEST stream error', error: err);
    if (!_events.isClosed) _events.addError(err);
  }

  void _onDone() {
    appLogger.i('CLOVA NEST stream closed');
  }

  @override
  void sendAudio(Uint8List pcm) {
    if (_closed || _requests == null) return;
    final extra = jsonEncode({'seqId': _seq++, 'epFlag': false});
    _requests!.add(NestProto.encodeRequest(
      type: 1,
      chunk: pcm,
      extra: extra,
    ));
  }

  @override
  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    // 마지막 epFlag=true 신호 — 서버가 남은 partial 을 final 로 flush 하게 한다.
    try {
      _requests?.add(NestProto.encodeRequest(
        type: 1,
        chunk: Uint8List(0),
        extra: jsonEncode({'seqId': -1, 'epFlag': true}),
      ));
    } catch (_) {}
    try {
      await _requests?.close();
    } catch (_) {}
    _requests = null;
    // 서버가 tail 전달할 시간 (~1.5s) 후 channel shutdown.
    await Future<void>.delayed(const Duration(milliseconds: 1500));
    try {
      await _responseSub?.cancel();
    } catch (_) {}
    _responseSub = null;
    try {
      await _call?.cancel();
    } catch (_) {}
    _call = null;
    try {
      await _channel?.shutdown();
    } catch (_) {}
    _channel = null;
    if (!_events.isClosed) await _events.close();
  }
}
