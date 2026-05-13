import 'package:equatable/equatable.dart';

enum DictationTemplate {
  soap,
  apso,
  hp,
  narrative;

  static DictationTemplate fromString(String? v) => switch (v) {
        'apso' => DictationTemplate.apso,
        'hp' => DictationTemplate.hp,
        'narrative' => DictationTemplate.narrative,
        _ => DictationTemplate.soap,
      };

  String get wire => switch (this) {
        DictationTemplate.soap => 'soap',
        DictationTemplate.apso => 'apso',
        DictationTemplate.hp => 'hp',
        DictationTemplate.narrative => 'narrative',
      };
}

class DictationSection extends Equatable {
  const DictationSection({required this.heading, required this.body});
  final String heading;
  final String body;

  @override
  List<Object?> get props => [heading, body];
}

class Dictation extends Equatable {
  const Dictation({
    required this.template,
    required this.sections,
    required this.generatedAt,
  });

  final DictationTemplate template;
  final List<DictationSection> sections;
  final DateTime generatedAt;

  @override
  List<Object?> get props => [template, sections, generatedAt];
}
