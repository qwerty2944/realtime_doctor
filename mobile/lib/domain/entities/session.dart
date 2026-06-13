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

  Session copyWith({bool? pinned, String? title, String? color}) => Session(
        id: id,
        startedAt: startedAt,
        endedAt: endedAt,
        transcribeProvider: transcribeProvider,
        chunkCount: chunkCount,
        preview: preview,
        title: title ?? this.title,
        color: color ?? this.color,
        pinned: pinned ?? this.pinned,
        audioPath: audioPath,
      );

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
