import '../../domain/entities/session.dart';
import '../../domain/entities/speaker.dart';
import '../../domain/entities/transcript_chunk.dart';
import '../dtos/session_dto.dart';
import '../dtos/transcript_chunk_dto.dart';

extension SessionDtoX on SessionDto {
  Session toDomain({int chunkCount = 0, String? preview}) => Session(
        id: id,
        startedAt: DateTime.parse(startedAt),
        endedAt: endedAt == null ? null : DateTime.parse(endedAt!),
        transcribeProvider: transcribeProvider,
        chunkCount: chunkCount,
        preview: preview,
        title: title,
        color: color,
        pinned: pinned,
        audioPath: audioPath,
      );
}

extension TranscriptChunkDtoX on TranscriptChunkDto {
  TranscriptChunk toDomain() => TranscriptChunk(
        id: chunkId,
        text: text,
        timestampMs: timestampMs,
        speaker: Speaker.fromString(speaker),
        audioPath: audioPath,
      );
}
