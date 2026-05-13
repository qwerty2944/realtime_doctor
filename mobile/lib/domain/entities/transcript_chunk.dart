import 'package:equatable/equatable.dart';

import 'speaker.dart';

class TranscriptChunk extends Equatable {
  const TranscriptChunk({
    required this.id,
    required this.text,
    required this.timestampMs,
    required this.speaker,
    this.audioPath,
    this.pending = false,
  });

  final String id;
  final String text;
  final int timestampMs;
  final Speaker speaker;
  final String? audioPath;
  final bool pending;

  DateTime get timestamp => DateTime.fromMillisecondsSinceEpoch(timestampMs);

  TranscriptChunk copyWith({
    String? id,
    String? text,
    int? timestampMs,
    Speaker? speaker,
    String? audioPath,
    bool? pending,
  }) =>
      TranscriptChunk(
        id: id ?? this.id,
        text: text ?? this.text,
        timestampMs: timestampMs ?? this.timestampMs,
        speaker: speaker ?? this.speaker,
        audioPath: audioPath ?? this.audioPath,
        pending: pending ?? this.pending,
      );

  @override
  List<Object?> get props => [id, text, timestampMs, speaker, audioPath, pending];
}
