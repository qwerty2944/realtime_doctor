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
        // 모델 출력 모양이 어긋나도 깨지지 않게 객체만 골라낸다.
        sections: (j['sections'] is List ? j['sections'] as List : const [])
            .whereType<Map>()
            .map((e) => e.cast<String, dynamic>())
            .toList(),
        generatedAt: (j['generated_at'] as String?) ??
            DateTime.now().toUtc().toIso8601String(),
      );
}
