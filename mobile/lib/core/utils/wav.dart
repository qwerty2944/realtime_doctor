import 'dart:typed_data';

import '../constants/app_constants.dart';

/// 16-bit PCM little-endian 바이트를 RIFF/WAV 컨테이너로 감싸 반환.
///
/// `sampleRate`/`channels`/`bitsPerSample` 는 AppConstants 기본값을 따른다.
/// Gemini chunk 전사 / Supabase Storage 업로드 모두에서 같은 인코딩 사용.
Uint8List pcm16ToWav(
  Uint8List pcm, {
  int sampleRate = AppConstants.audioSampleRate,
  int channels = AppConstants.audioChannels,
  int bitsPerSample = AppConstants.audioBitsPerSample,
}) {
  final dataLen = pcm.lengthInBytes;
  final byteRate = sampleRate * channels * bitsPerSample ~/ 8;
  final blockAlign = channels * bitsPerSample ~/ 8;
  final buf = ByteData(44 + dataLen);

  // RIFF header
  buf.setUint8(0, 0x52); // 'R'
  buf.setUint8(1, 0x49); // 'I'
  buf.setUint8(2, 0x46); // 'F'
  buf.setUint8(3, 0x46); // 'F'
  buf.setUint32(4, 36 + dataLen, Endian.little);
  buf.setUint8(8, 0x57); // 'W'
  buf.setUint8(9, 0x41); // 'A'
  buf.setUint8(10, 0x56); // 'V'
  buf.setUint8(11, 0x45); // 'E'

  // fmt sub-chunk
  buf.setUint8(12, 0x66); // 'f'
  buf.setUint8(13, 0x6D); // 'm'
  buf.setUint8(14, 0x74); // 't'
  buf.setUint8(15, 0x20); // ' '
  buf.setUint32(16, 16, Endian.little); // sub-chunk size
  buf.setUint16(20, 1, Endian.little); // PCM
  buf.setUint16(22, channels, Endian.little);
  buf.setUint32(24, sampleRate, Endian.little);
  buf.setUint32(28, byteRate, Endian.little);
  buf.setUint16(32, blockAlign, Endian.little);
  buf.setUint16(34, bitsPerSample, Endian.little);

  // data sub-chunk
  buf.setUint8(36, 0x64); // 'd'
  buf.setUint8(37, 0x61); // 'a'
  buf.setUint8(38, 0x74); // 't'
  buf.setUint8(39, 0x61); // 'a'
  buf.setUint32(40, dataLen, Endian.little);

  final out = buf.buffer.asUint8List();
  out.setRange(44, 44 + dataLen, pcm);
  return out;
}
