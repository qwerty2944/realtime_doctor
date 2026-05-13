class TranscriptChunkDto {
  const TranscriptChunkDto({
    required this.chunkId,
    required this.text,
    required this.timestampMs,
    required this.speaker,
    this.audioPath,
  });

  final String chunkId;
  final String text;
  final int timestampMs;
  final String speaker;
  final String? audioPath;

  factory TranscriptChunkDto.fromJson(Map<String, dynamic> j) => TranscriptChunkDto(
        chunkId: j['chunk_id'] as String,
        text: j['text'] as String,
        timestampMs: (j['timestamp_ms'] as num).toInt(),
        speaker: (j['speaker'] as String?) ?? 'unknown',
        audioPath: j['audio_path'] as String?,
      );
}
