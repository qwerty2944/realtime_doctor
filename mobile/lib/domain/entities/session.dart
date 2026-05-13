import 'package:equatable/equatable.dart';

class Session extends Equatable {
  const Session({
    required this.id,
    required this.startedAt,
    this.endedAt,
    this.transcribeProvider,
    this.chunkCount = 0,
    this.preview,
    this.title,
    this.color,
    this.pinned = false,
    this.audioPath,
  });

  final String id;
  final DateTime startedAt;
  final DateTime? endedAt;
  final String? transcribeProvider;
  final int chunkCount;
  final String? preview;
  final String? title;
  final String? color;
  final bool pinned;
  final String? audioPath;

  @override
  List<Object?> get props => [
        id,
        startedAt,
        endedAt,
        transcribeProvider,
        chunkCount,
        preview,
        title,
        color,
        pinned,
        audioPath,
      ];
}
