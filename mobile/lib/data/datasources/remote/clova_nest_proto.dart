import 'dart:convert';
import 'dart:typed_data';

/// CLOVA NEST gRPC 의 proto3 메시지 4개(NestRequest/NestConfig/NestData/NestResponse) 를
/// 핸드롤 인코더로 처리. protoc 툴체인 의존성을 안 깐다.
///
/// .proto 정의는 일렉트론 `src/main/clovaStream.ts` 의 `PROTO_SOURCE` 참고.
class NestProto {
  NestProto._();

  /// NestRequest 인코딩.
  /// type: 0=CONFIG, 1=DATA
  /// config: CONFIG 일 때 JSON 문자열 (transcription/epd 옵션)
  /// chunk: DATA 일 때 PCM bytes
  /// extra: DATA 일 때 {seqId, epFlag} JSON
  static Uint8List encodeRequest({
    required int type,
    String? config,
    Uint8List? chunk,
    String? extra,
  }) {
    final w = _Writer();
    // type (field 1, varint)
    w.writeVarintField(1, type);
    if (config != null) {
      // NestConfig { config = 1: string }
      final inner = _Writer()..writeStringField(1, config);
      w.writeBytesField(2, inner.take());
    }
    if (chunk != null || extra != null) {
      // NestData { chunk = 1: bytes, extra_contents = 2: string }
      final inner = _Writer();
      if (chunk != null) inner.writeBytesField(1, chunk);
      if (extra != null) inner.writeStringField(2, extra);
      w.writeBytesField(3, inner.take());
    }
    return w.take();
  }

  /// NestResponse { contents = 1: string }. field 1 만 읽으면 됨.
  static String? decodeResponse(List<int> bytes) {
    int i = 0;
    while (i < bytes.length) {
      final tag = bytes[i++];
      final fieldNum = tag >> 3;
      final wireType = tag & 0x07;
      if (fieldNum == 1 && wireType == 2) {
        final (len, next) = _readVarint(bytes, i);
        i = next;
        final raw = Uint8List.fromList(bytes.sublist(i, i + len));
        return utf8.decode(raw, allowMalformed: true);
      }
      i = _skipField(bytes, i, wireType);
    }
    return null;
  }

  static (int, int) _readVarint(List<int> bytes, int i) {
    int v = 0;
    int shift = 0;
    while (true) {
      final b = bytes[i++];
      v |= (b & 0x7F) << shift;
      if ((b & 0x80) == 0) return (v, i);
      shift += 7;
    }
  }

  static int _skipField(List<int> bytes, int i, int wireType) {
    switch (wireType) {
      case 0: // varint
        while ((bytes[i++] & 0x80) != 0) {}
        return i;
      case 1: // 64-bit
        return i + 8;
      case 2: // length-delimited
        final (len, next) = _readVarint(bytes, i);
        return next + len;
      case 5: // 32-bit
        return i + 4;
      default:
        // 알 수 없는 wire type. 안전하게 끝까지 스킵.
        return bytes.length;
    }
  }
}

class _Writer {
  final BytesBuilder _buf = BytesBuilder();

  void _writeVarint(int v) {
    while ((v & ~0x7F) != 0) {
      _buf.addByte((v & 0x7F) | 0x80);
      v >>>= 7;
    }
    _buf.addByte(v & 0x7F);
  }

  void _writeTag(int fieldNum, int wireType) {
    _writeVarint((fieldNum << 3) | wireType);
  }

  void writeVarintField(int fieldNum, int v) {
    _writeTag(fieldNum, 0);
    _writeVarint(v);
  }

  void writeBytesField(int fieldNum, List<int> bytes) {
    _writeTag(fieldNum, 2);
    _writeVarint(bytes.length);
    _buf.add(bytes);
  }

  void writeStringField(int fieldNum, String s) {
    writeBytesField(fieldNum, utf8.encode(s));
  }

  Uint8List take() => _buf.takeBytes();
}
