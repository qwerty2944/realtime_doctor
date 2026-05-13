class DictationDto {
  const DictationDto({
    required this.template,
    required this.sections,
    required this.generatedAt,
  });

  final String template;
  final List<Map<String, dynamic>> sections;
  final String generatedAt;

  factory DictationDto.fromJson(Map<String, dynamic> j) => DictationDto(
        template: (j['template'] as String?) ?? 'soap',
        sections: (j['sections'] as List? ?? []).cast<Map<String, dynamic>>(),
        generatedAt: (j['generated_at'] as String?) ??
            DateTime.now().toUtc().toIso8601String(),
      );
}
