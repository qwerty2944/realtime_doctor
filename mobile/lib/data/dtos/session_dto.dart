/// Supabase `sessions` row.
class SessionDto {
  const SessionDto({
    required this.id,
    required this.startedAt,
    this.endedAt,
    this.transcribeProvider,
    this.title,
    this.color,
    this.pinned = false,
    this.audioPath,
  });

  final String id;
  final String startedAt;
  final String? endedAt;
  final String? transcribeProvider;
  final String? title;
  final String? color;
  final bool pinned;
  final String? audioPath;

  factory SessionDto.fromJson(Map<String, dynamic> j) => SessionDto(
        id: j['id'] as String,
        startedAt: j['started_at'] as String,
        endedAt: j['ended_at'] as String?,
        transcribeProvider: j['transcribe_provider'] as String?,
        title: j['title'] as String?,
        color: j['color'] as String?,
        pinned: (j['pinned'] as bool?) ?? false,
        audioPath: j['audio_path'] as String?,
      );
}
